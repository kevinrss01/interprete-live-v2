use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub id: String,
    pub name: String,
}
// The installed virtual camera that receives the composed video.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VirtualCamera {
    pub name: String,
    pub installed: bool,
    pub ready: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevices {
    pub authorization: String,
    pub cameras: Vec<Camera>,
    pub virtual_camera: VirtualCamera,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RelayStatus {
    pub running: bool,
    pub session_id: Option<String>,
    pub camera: Option<String>,
    pub sink: Option<String>,
    pub frames: u64,
    pub sent: u64,
    pub delivered: u64,
    pub error: Option<String>,
}

const MAX_CAPTION_BYTES: usize = 2000;
const SYNTHETIC_CAMERA: &str = "@synthetic";

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::{CStr, CString, c_char, c_void};
    unsafe extern "C" {
        fn interprete_camera_devices() -> *mut c_char;
        fn interprete_camera_access() -> i32;
        fn interprete_camera_relay_start(camera: *const c_char, connect_sink: bool) -> *mut c_char;
        fn interprete_camera_relay_caption(text: *const c_char);
        fn interprete_camera_relay_stop();
        fn interprete_camera_relay_status() -> *mut c_char;
        fn interprete_camera_relay_preview(length: *mut usize) -> *mut u8;
        fn free(ptr: *mut c_void);
    }
    // Copies an owned strdup buffer from the bridge, then frees it with the same allocator.
    fn take(ptr: *mut c_char) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { free(ptr.cast()) };
        Some(value)
    }
    pub fn devices() -> Result<String, String> {
        take(unsafe { interprete_camera_devices() })
            .ok_or_else(|| "Unable to list the cameras.".into())
    }
    pub fn access() -> bool {
        unsafe { interprete_camera_access() == 1 }
    }
    // Without the sink, frames are only composed; tests use it so nothing reaches a real call.
    pub fn start(camera: &str, connect_sink: bool) -> Result<(), String> {
        let camera = CString::new(camera).map_err(|_| "Invalid camera.".to_string())?;
        match take(unsafe { interprete_camera_relay_start(camera.as_ptr(), connect_sink) }) {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
    pub fn caption(text: &str) -> Result<(), String> {
        let text = CString::new(text).map_err(|_| "Invalid caption.".to_string())?;
        unsafe { interprete_camera_relay_caption(text.as_ptr()) };
        Ok(())
    }
    pub fn stop() {
        unsafe { interprete_camera_relay_stop() }
    }
    pub fn status() -> Result<String, String> {
        take(unsafe { interprete_camera_relay_status() })
            .ok_or_else(|| "Unable to read the camera.".into())
    }
    pub fn preview() -> Vec<u8> {
        let mut length = 0;
        let ptr = unsafe { interprete_camera_relay_preview(&mut length) };
        if ptr.is_null() {
            return Vec::new();
        }
        // The bridge allocates the JPEG with malloc; copy it, then release it.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, length) }.to_vec();
        unsafe { free(ptr.cast()) };
        bytes
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    const UNSUPPORTED: &str = "Captions on your video need the macOS app.";
    pub fn devices() -> Result<String, String> {
        Ok(r#"{"authorization":"restricted","cameras":[],"virtualCamera":{"name":"OBS Virtual Camera","installed":false,"ready":false}}"#.into())
    }
    pub fn access() -> bool {
        false
    }
    pub fn start(_camera: &str, _connect_sink: bool) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
    pub fn caption(_text: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn stop() {}
    pub fn status() -> Result<String, String> {
        Ok(r#"{"running":false}"#.into())
    }
    pub fn preview() -> Vec<u8> {
        Vec::new()
    }
}

// One relay at a time, owned by the session that started it. Requests from a replaced session
// are ignored, so a late stop or caption cannot reach the next one.
#[derive(Default)]
pub struct CameraRelay {
    owner: Mutex<Option<String>>,
    lifecycle: Mutex<()>,
    // Advances when the main page reloads; starts requested by the previous page are dropped.
    page: AtomicU64,
}
impl CameraRelay {
    fn page(&self) -> u64 {
        self.page.load(Ordering::SeqCst)
    }
    fn owns(&self, session_id: &str) -> bool {
        self.owner
            .lock()
            .is_ok_and(|owner| owner.as_deref() == Some(session_id))
    }
    fn start(&self, session_id: String, camera_id: &str, page: u64) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.page() != page {
            return Err("The page was reloaded.".into());
        }
        // The previous owner loses the relay even when this start fails.
        *self.owner.lock().map_err(|e| e.to_string())? = None;
        native::start(camera_id, true)?;
        *self.owner.lock().map_err(|e| e.to_string())? = Some(session_id);
        Ok(())
    }
    // The owner stays locked while the caption is handed over, so a start cannot replace the
    // relay between the check and the native call.
    fn caption(&self, session_id: &str, text: &str) -> Result<(), String> {
        let owner = self.owner.lock().map_err(|e| e.to_string())?;
        if owner.as_deref() == Some(session_id) {
            native::caption(text)?;
        }
        Ok(())
    }
    fn stop(&self, session_id: &str) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|e| e.to_string())?;
        if self.owns(session_id) {
            native::stop();
            *self.owner.lock().map_err(|e| e.to_string())? = None;
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        if let Ok(_lifecycle) = self.lifecycle.lock() {
            native::stop();
            if let Ok(mut owner) = self.owner.lock() {
                *owner = None;
            }
        }
    }
    // A reloaded page lost the session that would stop the camera, and shows no control for it.
    // A start still opening the camera finishes first, then is stopped here.
    pub fn release_all(&self) {
        self.page.fetch_add(1, Ordering::SeqCst);
        self.shutdown();
    }
}

fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("This camera action is reserved for the main window.".into())
    }
}
fn valid_session(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() || session_id.len() > 96 {
        return Err("Invalid camera session.".into());
    }
    Ok(())
}
// The synthetic pattern lets development builds run the whole relay without opening a camera.
fn valid_camera(camera_id: &str) -> Result<(), String> {
    if camera_id.is_empty()
        || camera_id.len() > 256
        || (camera_id == SYNTHETIC_CAMERA && !cfg!(debug_assertions))
    {
        return Err("Choose a camera.".into());
    }
    Ok(())
}
// Captions are a short tail of live speech; one line, without control characters.
fn caption_text(text: &str) -> Result<String, String> {
    if text.len() > MAX_CAPTION_BYTES {
        return Err("Caption too long.".into());
    }
    Ok(text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect())
}
fn parse_devices(json: &str) -> Result<CameraDevices, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn camera_devices(window: tauri::WebviewWindow) -> Result<CameraDevices, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(|| parse_devices(&native::devices()?))
        .await
        .map_err(|e| e.to_string())?
}
// Shows the macOS camera prompt the first time; later answers come from System Settings.
#[tauri::command]
pub async fn camera_access(window: tauri::WebviewWindow) -> Result<bool, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(native::access)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn camera_relay_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    camera_id: String,
) -> Result<(), String> {
    authorize(&window)?;
    valid_session(&session_id)?;
    valid_camera(&camera_id)?;
    use tauri::Manager;
    let page = app.state::<CameraRelay>().page();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<CameraRelay>()
            .start(session_id, &camera_id, page)
    })
    .await
    .map_err(|e| e.to_string())?
}
// Async commands run off the main thread; the frontend awaits each caption before the next.
#[tauri::command]
pub async fn camera_relay_caption(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CameraRelay>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    authorize(&window)?;
    state.caption(&session_id, &caption_text(&text)?)
}
#[tauri::command]
pub async fn camera_relay_stop(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<CameraRelay>().stop(&session_id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn camera_relay_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CameraRelay>,
) -> Result<RelayStatus, String> {
    authorize(&window)?;
    let session_id = state.owner.lock().map_err(|e| e.to_string())?.clone();
    let json = tauri::async_runtime::spawn_blocking(native::status)
        .await
        .map_err(|e| e.to_string())??;
    let mut status: RelayStatus = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    status.session_id = session_id;
    Ok(status)
}
// The latest composed frame as a small JPEG; empty before the first frame.
#[tauri::command]
pub async fn camera_relay_preview(
    window: tauri::WebviewWindow,
) -> Result<tauri::ipc::Response, String> {
    authorize(&window)?;
    let jpeg = tauri::async_runtime::spawn_blocking(native::preview)
        .await
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(jpeg))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captions_are_bounded_single_lines() {
        assert_eq!(
            caption_text("Bonjour\nà tous\t!").unwrap(),
            "Bonjour à tous !"
        );
        assert!(caption_text(&"a".repeat(MAX_CAPTION_BYTES + 1)).is_err());
    }
    #[test]
    fn sessions_and_cameras_are_validated() {
        assert!(valid_session("").is_err());
        assert!(valid_session(&"x".repeat(97)).is_err());
        assert!(valid_session("4f7c").is_ok());
        assert!(valid_camera("").is_err());
        assert_eq!(
            valid_camera(SYNTHETIC_CAMERA).is_ok(),
            cfg!(debug_assertions)
        );
        assert!(valid_camera("6C707041-05AC-0011-0006-000000000001").is_ok());
    }
    #[test]
    fn device_list_parses() {
        let devices = parse_devices(
            r#"{"authorization":"authorized","cameras":[{"id":"cam","name":"MacBook Pro Camera"}],"virtualCamera":{"name":"OBS Virtual Camera","installed":true,"ready":false}}"#,
        )
        .expect("devices");
        assert_eq!(devices.cameras[0].name, "MacBook Pro Camera");
        assert!(devices.virtual_camera.installed && !devices.virtual_camera.ready);
        let status: RelayStatus =
            serde_json::from_str(r#"{"running":false}"#).expect("idle status");
        assert!(!status.running && status.error.is_none());
    }
    #[test]
    fn enumerate_real_cameras_without_opening_them() {
        let devices = parse_devices(&native::devices().expect("camera list")).expect("parse");
        assert!(devices.cameras.iter().all(|camera| !camera.id.is_empty()));
        assert!(!devices.virtual_camera.name.is_empty());
    }
    #[test]
    fn a_page_reload_drops_starts_requested_before_it() {
        let relay = CameraRelay::default();
        let page = relay.page();
        relay.release_all();
        assert!(
            relay
                .start("previous".into(), SYNTHETIC_CAMERA, page)
                .is_err()
        );
        assert!(!relay.owns("previous"));
    }
    #[test]
    fn a_replaced_session_cannot_caption_or_stop_the_relay() {
        let relay = CameraRelay::default();
        *relay.owner.lock().unwrap() = Some("current".into());
        relay
            .caption("previous", "Late words")
            .expect("ignored caption");
        relay.stop("previous").expect("ignored stop");
        assert!(relay.owns("current"));
    }
    // The native relay is process-wide; its tests take turns.
    static NATIVE_RELAY: Mutex<()> = Mutex::new(());
    #[cfg(target_os = "macos")]
    #[test]
    fn synthetic_frames_are_composed_with_captions() {
        let _turn = NATIVE_RELAY.lock().unwrap_or_else(|e| e.into_inner());
        // Composition only: even with OBS installed, nothing reaches a call during tests.
        native::start(SYNTHETIC_CAMERA, false).expect("start the synthetic relay");
        native::caption("Hello everyone, thanks for joining.").expect("caption");
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let status: RelayStatus =
            serde_json::from_str(&native::status().expect("status")).expect("parse");
        let preview = native::preview();
        native::stop();
        let stopped: RelayStatus =
            serde_json::from_str(&native::status().expect("status")).expect("parse");
        assert!(status.running && status.error.is_none(), "{status:?}");
        assert!(status.frames >= 20, "composed {} frames", status.frames);
        assert!(status.sink.is_none() && status.sent == 0, "{status:?}");
        assert!(preview.starts_with(&[0xFF, 0xD8]), "preview is a JPEG");
        assert!(!stopped.running);
    }
    #[test]
    #[ignore = "needs OBS Virtual Camera enabled; sends a synthetic pattern, opens no camera"]
    fn synthetic_frames_reach_the_virtual_camera() {
        let _turn = NATIVE_RELAY.lock().unwrap_or_else(|e| e.into_inner());
        native::start(SYNTHETIC_CAMERA, true).expect("connect to OBS Virtual Camera");
        native::caption("Bonjour à tous, merci d’être là.").expect("caption");
        std::thread::sleep(std::time::Duration::from_secs(2));
        let status: RelayStatus =
            serde_json::from_str(&native::status().expect("status")).expect("parse");
        let preview = native::preview();
        native::stop();
        assert!(status.running && status.error.is_none(), "{status:?}");
        assert_eq!(status.sink.as_deref(), Some("OBS Virtual Camera"));
        assert!(status.frames >= 40, "composed {} frames", status.frames);
        assert!(status.sent >= 40, "sent {} frames", status.sent);
        assert!(
            status.delivered >= 40,
            "OBS took {} frames",
            status.delivered
        );
        assert!(preview.starts_with(&[0xFF, 0xD8]), "preview is a JPEG");
        println!(
            "Synthetic relay: {} composed, {} sent, {} taken by the extension; preview {} bytes.",
            status.frames,
            status.sent,
            status.delivered,
            preview.len()
        );
    }
}
