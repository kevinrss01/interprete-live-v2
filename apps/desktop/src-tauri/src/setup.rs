use serde::{Deserialize, Serialize};
use tauri::Manager;

// Pinned official installer, independently published with the same checksum by Homebrew.
const INSTALLER_URL: &str = "https://existential.audio/downloads/BlackHole2ch-0.7.1.pkg";
const INSTALLER_SHA256: &str = "57b540f27a3e29c37e310e01bee0fdfab76733087e47f997ef9dccf851400dcf";

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    supported: bool,
    microphone: String,
    accessibility: bool,
    bundled: bool,
    #[serde(default)]
    driver_installed: bool,
    #[serde(default)]
    driver_ready: bool,
    #[serde(default)]
    virtual_microphone: bool,
}

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Setup is reserved for the main window.".into());
    }
    Ok(())
}

fn status() -> Result<SetupStatus, String> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn interprete_setup_status() -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        // Owned strdup data; copy/parse it before matching free.
        let ptr = unsafe { interprete_setup_status() };
        if ptr.is_null() {
            return Err("Unable to check Mac permissions.".into());
        }
        let parsed = serde_json::from_slice::<SetupStatus>(
            unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes(),
        );
        unsafe { free(ptr.cast()) };
        let mut status = parsed.map_err(|_| "Unable to read Mac permissions.".to_string())?;
        let outputs = crate::virtual_microphone::outputs(false)?;
        status.driver_ready = outputs
            .iter()
            .any(|device| device.uid == "BlackHole2ch_UID");
        status.driver_installed = status.driver_ready
            || std::path::Path::new("/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver").exists();
        status.virtual_microphone = outputs.iter().any(|device| device.app_mic);
        Ok(status)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(SetupStatus {
            microphone: "unknown".into(),
            ..SetupStatus::default()
        })
    }
}

#[tauri::command]
pub async fn mac_setup_status(window: tauri::WebviewWindow) -> Result<SetupStatus, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetupAction {
    Microphone,
    Audio,
    VirtualMicrophone,
    InstallDriver,
    RevealAccessibilityApp,
}

fn install_driver(directory: std::path::PathBuf) -> Result<(), String> {
    static INSTALLER: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _download = INSTALLER
        .try_lock()
        .map_err(|_| "The installer is already downloading.".to_string())?;
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Unable to prepare the installer download.".to_string())?;
    let path = directory.join("BlackHole2ch-0.7.1.pkg");
    // Download to a unique file so concurrent clicks or app instances cannot open partial data.
    let partial = directory.join(format!("BlackHole2ch-{}.download", std::process::id()));
    let result = (|| {
        let downloaded = std::process::Command::new("/usr/bin/curl")
            .args([
                "--disable",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--connect-timeout",
                "10",
                "--max-time",
                "90",
                "--user-agent",
                "agent-local",
                "--output",
            ])
            .arg(&partial)
            .arg(INSTALLER_URL)
            .output()
            .map_err(|_| "Unable to download the virtual microphone installer.".to_string())?;
        if !downloaded.status.success() {
            return Err(
                "The installer download failed. Check your connection and try again.".into(),
            );
        }
        let checksum = std::process::Command::new("/usr/bin/shasum")
            .args(["-a", "256"])
            .arg(&partial)
            .output()
            .map_err(|_| "Unable to verify the downloaded installer.".to_string())?;
        if !checksum.status.success() || !checksum_matches(&checksum.stdout) {
            return Err(
                "The installer could not be verified. It was not opened. Try again.".into(),
            );
        }
        std::fs::rename(&partial, &path)
            .map_err(|_| "Unable to save the verified installer.".to_string())?;
        let opened = std::process::Command::new("/usr/bin/open")
            .arg(&path)
            .status()
            .map_err(|_| "Unable to open macOS Installer.".to_string())?;
        if !opened.success() {
            return Err("Unable to open macOS Installer.".into());
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(partial);
    result
}
fn checksum_matches(output: &[u8]) -> bool {
    std::str::from_utf8(output)
        .ok()
        .and_then(|text| text.split_whitespace().next())
        == Some(INSTALLER_SHA256)
}

#[tauri::command]
pub async fn mac_setup_action(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: SetupAction,
) -> Result<(), String> {
    main_only(&window)?;
    #[cfg(target_os = "macos")]
    {
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|_| "Unable to find the installer folder.".to_string())?
            .join("setup");
        tauri::async_runtime::spawn_blocking(move || match action {
            SetupAction::Microphone => {
                unsafe extern "C" {
                    fn interprete_request_setup_microphone();
                }
                // Requests permission only; AVFoundation never opens a recording session here.
                unsafe { interprete_request_setup_microphone() };
                Ok(())
            }
            SetupAction::Audio => crate::system_audio::request_setup_permission(),
            SetupAction::VirtualMicrophone => {
                crate::virtual_microphone::outputs(true).and_then(|devices| {
                    if devices.iter().any(|device| device.app_mic) {
                        Ok(())
                    } else {
                        Err("Install BlackHole 2ch and restart your Mac, then check again.".into())
                    }
                })
            }
            SetupAction::InstallDriver => install_driver(directory),
            SetupAction::RevealAccessibilityApp => {
                // Reveal this process, never a similarly named installed or previous build.
                let executable = std::env::current_exe()
                    .map_err(|_| "Unable to locate the running app.".to_string())?;
                let target = executable
                    .ancestors()
                    .find(|path| path.extension().is_some_and(|extension| extension == "app"))
                    .unwrap_or(&executable);
                let result = std::process::Command::new("/usr/bin/open")
                    .arg("-R")
                    .arg(target)
                    .status()
                    .map_err(|_| "Unable to show the running app in Finder.".to_string())?;
                if result.success() {
                    Ok(())
                } else {
                    Err("Unable to show the running app in Finder.".into())
                }
            }
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, action);
        Err("Meeting setup requires macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_pinned_installer_checksum_is_accepted() {
        assert!(checksum_matches(
            format!("{INSTALLER_SHA256}  installer.pkg\n").as_bytes()
        ));
        assert!(!checksum_matches(b"unexpected  installer.pkg"));
        assert!(!checksum_matches(b""));
        assert!(!checksum_matches(&[255]));
    }
    #[test]
    fn reading_permission_metadata_never_requests_access() {
        let snapshot = status().expect("read-only setup state");
        assert!(
            [
                "unknown",
                "granted",
                "not-determined",
                "denied",
                "restricted"
            ]
            .contains(&snapshot.microphone.as_str())
        );
        assert!(!snapshot.virtual_microphone || snapshot.driver_ready);
    }
}
