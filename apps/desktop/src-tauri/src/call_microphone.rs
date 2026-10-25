use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneState {
    pub supported: bool,
    pub muted: Option<bool>,
    pub permission_required: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionSettings {
    Audio,
    Accessibility,
    Microphone,
}

#[tauri::command]
pub async fn open_call_permissions(
    window: tauri::WebviewWindow,
    kind: PermissionSettings,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Permissions settings are reserved for the main window.".into());
    }
    #[cfg(target_os = "macos")]
    {
        if matches!(kind, PermissionSettings::Accessibility) {
            unsafe extern "C" {
                fn interprete_request_call_accessibility();
            }
            // This command is invoked only by the permissions button; the OS owns the grant.
            unsafe { interprete_request_call_accessibility() };
        }
        let pane = match kind {
            PermissionSettings::Audio => "Privacy_ScreenCapture",
            PermissionSettings::Accessibility => "Privacy_Accessibility",
            PermissionSettings::Microphone => "Privacy_Microphone",
        };
        let result = std::process::Command::new("/usr/bin/open")
            .arg(format!(
                "x-apple.systempreferences:com.apple.preference.security?{pane}"
            ))
            .status()
            .map_err(|error| error.to_string())?;
        if !result.success() {
            return Err("Unable to open System Settings.".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Err("Call permissions require macOS.".into())
    }
}

#[tauri::command]
pub async fn call_microphone_state(
    window: tauri::WebviewWindow,
    source: String,
) -> Result<MicrophoneState, String> {
    if window.label() != "main" {
        return Err("Microphone synchronization is reserved for the main window.".into());
    }
    // Meet's own microphone action is currently recognized in English and French.
    if source != "@meet" && source != "Chrome / Meet" && !source.ends_with("/ web call") {
        return Ok(MicrophoneState::default());
    }
    let prefixes = if source == "@meet" {
        crate::calls::browser_prefixes()
    } else if source == "Safari / web call" {
        vec!["com.apple.safari"]
    } else {
        crate::calls::tap_prefixes(&source)
    };
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        unsafe extern "C" {
            fn interprete_meet_microphone(
                prefixes: *const std::ffi::c_char,
            ) -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        let prefixes = std::ffi::CString::new(
            serde_json::to_string(&prefixes).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        // The bridge returns an owned strdup allocation, freed after parsing.
        let ptr = unsafe { interprete_meet_microphone(prefixes.as_ptr()) };
        if ptr.is_null() {
            return Err("Unable to read the call microphone state.".into());
        }
        let parsed = serde_json::from_slice(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes())
            .map_err(|error| error.to_string());
        unsafe { free(ptr.cast()) };
        parsed
    })
    .await
    .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prefixes;
        Ok(MicrophoneState::default())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    #[ignore = "requires Accessibility and an open Meet call; read-only, no capture or UI actions"]
    fn read_meet_microphone_without_recording() {
        unsafe extern "C" {
            fn interprete_meet_microphone(
                prefixes: *const std::ffi::c_char,
            ) -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        let prefixes = std::ffi::CString::new(r#"["com.google.chrome"]"#).unwrap();
        let ptr = unsafe { interprete_meet_microphone(prefixes.as_ptr()) };
        assert!(!ptr.is_null());
        let state: super::MicrophoneState =
            serde_json::from_slice(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes()).unwrap();
        unsafe { free(ptr.cast()) };
        println!("Meet mute inspection: {state:?}");
        assert!(state.supported);
        assert!(
            !state.permission_required,
            "Accessibility is required for this live check"
        );
        assert!(
            state.muted.is_some(),
            "No unique Meet microphone control found"
        );
    }
    #[test]
    fn own_microphone_controls_are_distinct_from_other_mute_buttons() {
        unsafe extern "C" {
            fn interprete_microphone_action(label: *const std::ffi::c_char) -> i32;
        }
        for (label, expected) in [
            ("Activer le micro", 1),
            ("Turn on microphone (⌘ + d)", 1),
            ("Désactiver le micro", 0),
            ("Turn off microphone", 0),
            ("Mute tab", -1),
            ("Mute participant", -1),
            ("Microphone settings", -1),
            ("Activer les sous-titres", -1),
        ] {
            let label = std::ffi::CString::new(label).unwrap();
            assert_eq!(
                unsafe { interprete_microphone_action(label.as_ptr()) },
                expected
            );
        }
    }
}
