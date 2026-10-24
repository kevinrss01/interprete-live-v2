use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCall {
    pub id: String,
    pub app: String,
    pub simulated: bool,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSnapshot {
    pub supported: bool,
    pub enabled: bool,
    pub call: Option<DetectedCall>,
    pub accepted: bool,
    pub dismissed: bool,
    pub error: Option<String>,
}
// What an accepted call translates: their speech as captions and/or voice, and the user's microphone.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CallOptions {
    pub captions: bool,
    pub voice: bool,
    pub microphone: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedCall {
    #[serde(flatten)]
    call: DetectedCall,
    options: CallOptions,
}
#[derive(Default)]
pub struct Monitor {
    pub snapshot: CallSnapshot,
    candidate: Option<String>,
    stable: u8,
    missing: u8,
}
pub struct CallState(pub Mutex<Monitor>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Process {
    bundle_id: String,
}
#[derive(Deserialize)]
struct Probe {
    supported: bool,
    processes: Vec<Process>,
    error: Option<String>,
    // Some camera is streaming, to an unknown process.
    #[serde(default)]
    camera: bool,
    // Bundle of the app in front, which owns the camera when it is a call app.
    #[serde(default)]
    frontmost: Option<String>,
}

const CALL_APPS: &[(&str, &str)] = &[
    ("us.zoom.", "Zoom"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.apple.facetime", "FaceTime"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.hnc.discord", "Discord"),
    ("com.cisco.webexmeetingsapp", "Webex"),
    ("com.webex.meetingmanager", "Webex"),
    ("cisco-systems.spark", "Webex"),
    ("com.skype.skype", "Skype"),
    ("com.logmein.gotomeeting", "GoTo Meeting"),
    ("net.whatsapp.whatsapp", "WhatsApp"),
    ("desktop.whatsapp", "WhatsApp"),
    ("ru.keepcoder.telegram", "Telegram"),
    ("org.telegram.desktop", "Telegram"),
    ("org.whispersystems.signal-desktop", "Signal"),
    ("com.facebook.archon", "Messenger"),
    ("com.google.chrome", "Chrome / Meet"),
    ("com.apple.safari", "Safari / appel web"),
    ("com.microsoft.edgemac", "Edge / appel web"),
    ("org.mozilla.firefox", "Firefox / appel web"),
    ("company.thebrowser.browser", "Arc / appel web"),
    ("company.thebrowser.dia", "Dia / appel web"),
    ("com.brave.browser", "Brave / appel web"),
    ("com.operasoftware.opera", "Opera / appel web"),
    ("com.vivaldi.vivaldi", "Vivaldi / appel web"),
    ("org.chromium.chromium", "Chromium / appel web"),
];
fn call_app(bundle: &str) -> Option<&'static str> {
    let bundle = bundle.to_lowercase();
    CALL_APPS
        .iter()
        .find_map(|&(prefix, name)| bundle.starts_with(prefix).then_some(name))
}
// Bundle prefixes whose audio output carries a detected call. Helpers share the app prefix.
// Safari plays through a WebKit process shared with other apps, and unknown or simulated
// calls have no app: an empty list captures all audio except Interprète.
pub fn tap_prefixes(app: &str) -> Vec<&'static str> {
    if app == "Safari / appel web" {
        return vec![];
    }
    let mut prefixes: Vec<&'static str> = CALL_APPS
        .iter()
        .filter_map(|&(prefix, name)| (name == app).then_some(prefix))
        .collect();
    // FaceTime audio is rendered by the conferencing daemon.
    if app == "FaceTime" {
        prefixes.push("com.apple.avconferenced");
    }
    prefixes
}
fn probe() -> Result<Probe, String> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn interprete_call_probe() -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        // The bridge returns a NUL-terminated strdup allocation, valid until free below.
        let ptr = unsafe { interprete_call_probe() };
        if ptr.is_null() {
            return Err("CoreAudio n’a pas répondu.".into());
        }
        let result = unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes();
        let parsed = serde_json::from_slice(result).map_err(|e| e.to_string());
        // Matching allocator: the Objective-C bridge uses strdup/malloc.
        unsafe {
            free(ptr.cast());
        }
        parsed
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Probe {
            supported: false,
            processes: vec![],
            error: None,
            camera: false,
            frontmost: None,
        })
    }
}
// Call apps active right now: those with a running microphone, then the call app in front
// while a camera streams. A meeting lobby or a muted call can show the camera without the mic.
// The camera's owner is unknown, so an app holding the microphone always comes first.
fn active_apps(probe: &Probe) -> Vec<String> {
    let mut apps: Vec<String> = probe
        .processes
        .iter()
        .filter_map(|p| call_app(&p.bundle_id).map(str::to_owned))
        .collect();
    apps.sort();
    apps.dedup();
    if probe.camera
        && let Some(app) = probe.frontmost.as_deref().and_then(call_app)
        && !apps.iter().any(|a| a == app)
    {
        apps.push(app.to_owned());
    }
    apps
}
impl Monitor {
    // Two positive polls avoid short mic probes; eight missing polls tolerate mute/device switches.
    fn tick(&mut self, apps: &[String]) -> bool {
        if !self.snapshot.enabled || self.snapshot.call.as_ref().is_some_and(|c| c.simulated) {
            return false;
        }
        if let Some(call) = &self.snapshot.call {
            if apps.contains(&call.app) {
                self.missing = 0;
                return false;
            }
            self.missing += 1;
            if self.missing < 8 {
                return false;
            }
            self.snapshot.call = None;
            self.snapshot.accepted = false;
            self.snapshot.dismissed = false;
            self.candidate = None;
            self.stable = 0;
            return true;
        }
        let next = apps.first().cloned();
        if next != self.candidate {
            self.candidate = next;
            self.stable = 0;
        }
        if self.candidate.is_none() {
            return false;
        }
        self.stable += 1;
        if self.stable < 2 {
            return false;
        }
        self.snapshot.call = self.candidate.clone().map(|app| DetectedCall {
            id: format!(
                "call-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ),
            app,
            simulated: false,
        });
        self.missing = 0;
        true
    }
}
fn publish(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // Read the latest state on the UI thread so an older poll cannot re-show an answered toast.
        let snapshot = match handle.state::<CallState>().0.lock() {
            Ok(monitor) => monitor.snapshot.clone(),
            Err(_) => return,
        };
        let _ = handle.emit("call-status", &snapshot);
        if let Some(window) = handle.get_webview_window("call-toast") {
            if snapshot.call.is_some() && !snapshot.dismissed && !snapshot.accepted {
                #[cfg(target_os = "macos")]
                if let Ok(native) = window.ns_window() {
                    unsafe extern "C" {
                        fn interprete_present_call_prompt(window: *mut std::ffi::c_void);
                    }
                    // Runs on the UI thread; Tauri keeps the native window alive with the app.
                    unsafe {
                        interprete_present_call_prompt(native);
                    }
                    return;
                }
                if let Ok(Some(screen)) = handle
                    .get_webview_window("main")
                    .map_or_else(|| handle.primary_monitor(), |w| w.current_monitor())
                {
                    let area = screen.work_area();
                    let scale = screen.scale_factor();
                    let _ = window.set_position(tauri::PhysicalPosition::new(
                        area.position.x + area.size.width as i32 - (400.0 * scale) as i32,
                        area.position.y + (16.0 * scale) as i32,
                    ));
                }
                let _ = window.set_visible_on_all_workspaces(true);
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
    });
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            let result = probe();
            let state = app.state::<CallState>();
            let changed = if let Ok(mut monitor) = state.0.lock() {
                let changed = match result {
                    Ok(probe) => {
                        let changed = monitor.snapshot.supported != probe.supported
                            || monitor.snapshot.error != probe.error;
                        monitor.snapshot.supported = probe.supported;
                        let apps = active_apps(&probe);
                        monitor.snapshot.error = probe.error;
                        monitor.tick(&apps) || changed
                    }
                    Err(error) => {
                        let changed = monitor.snapshot.error.as_ref() != Some(&error);
                        monitor.snapshot.error = Some(error);
                        changed
                    }
                };
                changed.then(|| monitor.snapshot.clone())
            } else {
                None
            };
            // Monitor queries can synchronously dispatch to the UI thread. Never hold CallState here.
            if changed.is_some() {
                publish(&app);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Action réservée à la fenêtre principale.".into())
    }
}
#[tauri::command]
pub fn call_snapshot(state: tauri::State<CallState>) -> Result<CallSnapshot, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.snapshot.clone())
}
#[tauri::command]
pub fn call_monitor_enabled(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<CallState>,
    enabled: bool,
) -> Result<(), String> {
    main_only(&window)?;
    let mut m = state.0.lock().map_err(|e| e.to_string())?;
    m.snapshot.enabled = enabled;
    if !enabled {
        m.snapshot.call = None;
        m.snapshot.accepted = false;
        m.candidate = None;
        m.stable = 0;
        m.snapshot.dismissed = false;
    }
    drop(m);
    publish(&app);
    Ok(())
}
#[tauri::command]
pub fn simulate_call(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<CallState>,
) -> Result<(), String> {
    main_only(&window)?;
    let mut m = state.0.lock().map_err(|e| e.to_string())?;
    if m.snapshot.call.is_some() {
        return Err("Terminez l’appel détecté avant de lancer la simulation.".into());
    }
    m.snapshot.call = Some(DetectedCall {
        id: format!(
            "test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ),
        app: "Google Meet · test".into(),
        simulated: true,
    });
    m.snapshot.accepted = false;
    m.snapshot.dismissed = false;
    drop(m);
    publish(&app);
    Ok(())
}
#[tauri::command]
pub fn answer_call(
    app: tauri::AppHandle,
    state: tauri::State<CallState>,
    call_id: String,
    accept: bool,
    options: CallOptions,
) -> Result<(), String> {
    if accept && !options.captions && !options.voice && !options.microphone {
        return Err("Choisissez au moins une traduction.".into());
    }
    let mut m = state.0.lock().map_err(|e| e.to_string())?;
    let call = m
        .snapshot
        .call
        .as_ref()
        .filter(|c| c.id == call_id)
        .ok_or("Cet appel est terminé.")?
        .clone();
    if m.snapshot.accepted || m.snapshot.dismissed {
        return Err("Cet appel a déjà reçu une réponse.".into());
    }
    m.snapshot.accepted = accept;
    m.snapshot.dismissed = !accept;
    drop(m);
    if accept {
        // Captions and voice run over the call; only the microphone route may need the setup window.
        if options.microphone
            && let Some(main) = app.get_webview_window("main")
        {
            let _ = main.show();
            let _ = main.set_focus();
        }
        let _ = app.emit_to("main", "call-accepted", &AcceptedCall { call, options });
    }
    publish(&app);
    Ok(())
}
#[tauri::command]
pub fn end_simulated_call(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<CallState>,
) -> Result<(), String> {
    main_only(&window)?;
    let mut m = state.0.lock().map_err(|e| e.to_string())?;
    if m.snapshot.call.as_ref().is_some_and(|c| c.simulated) {
        m.snapshot.call = None;
        m.snapshot.accepted = false;
        m.snapshot.dismissed = false;
        drop(m);
        publish(&app);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn monitor() -> Monitor {
        let mut m = Monitor::default();
        m.snapshot.enabled = true;
        m
    }
    #[test]
    fn debounce_and_end_grace() {
        let mut m = monitor();
        let apps = vec!["Zoom".into()];
        assert!(!m.tick(&apps));
        assert!(m.tick(&apps));
        m.snapshot.dismissed = true;
        for _ in 0..20 {
            assert!(!m.tick(&apps));
        }
        for _ in 0..7 {
            assert!(!m.tick(&[]));
        }
        assert!(m.tick(&[]));
        assert!(m.snapshot.call.is_none());
        assert!(!m.tick(&apps));
        assert!(m.tick(&apps));
        assert!(!m.snapshot.dismissed);
    }
    fn probe_with(bundles: &[&str], camera: bool, frontmost: Option<&str>) -> Probe {
        Probe {
            supported: true,
            processes: bundles
                .iter()
                .map(|b| Process {
                    bundle_id: (*b).into(),
                })
                .collect(),
            error: None,
            camera,
            frontmost: frontmost.map(str::to_owned),
        }
    }
    #[test]
    fn camera_in_a_call_app_in_front_counts_before_the_microphone() {
        // Meeting lobby: camera preview in Chrome, microphone still closed.
        assert_eq!(
            active_apps(&probe_with(&[], true, Some("com.google.Chrome"))),
            vec!["Chrome / Meet".to_string()]
        );
        // A camera used while another app is in front is not attributed to a call app.
        assert!(active_apps(&probe_with(&[], true, Some("com.apple.Photobooth"))).is_empty());
        assert!(active_apps(&probe_with(&[], false, Some("us.zoom.xos"))).is_empty());
        assert_eq!(
            active_apps(&probe_with(&["us.zoom.xos"], true, Some("us.zoom.xos"))),
            vec!["Zoom".to_string()]
        );
    }
    #[test]
    fn the_microphone_app_wins_over_the_app_in_front() {
        // Zoom holds the microphone and camera while Chrome is in front.
        let apps = active_apps(&probe_with(
            &["us.zoom.xos"],
            true,
            Some("com.google.Chrome"),
        ));
        assert_eq!(apps, vec!["Zoom".to_string(), "Chrome / Meet".to_string()]);
        let mut m = monitor();
        assert!(!m.tick(&apps));
        assert!(m.tick(&apps));
        assert_eq!(
            m.snapshot.call.as_ref().map(|c| c.app.as_str()),
            Some("Zoom")
        );
    }
    #[test]
    fn only_known_apps_and_no_self_detection() {
        assert_eq!(call_app("com.google.Chrome.helper"), Some("Chrome / Meet"));
        assert_eq!(call_app("us.zoom.xos"), Some("Zoom"));
        assert_eq!(call_app("ai.impulselab.interprete"), None);
        assert_eq!(call_app("com.apple.WebKit.GPU"), None);
        assert_eq!(call_app("com.apple.VoiceMemos"), None);
        assert_eq!(call_app("Cisco-Systems.Spark"), Some("Webex"));
        assert_eq!(call_app("net.whatsapp.WhatsApp"), Some("WhatsApp"));
        assert_eq!(call_app("com.microsoft.teams2"), Some("Microsoft Teams"));
    }
    #[test]
    fn taps_follow_the_detected_app() {
        assert_eq!(tap_prefixes("Zoom"), vec!["us.zoom."]);
        assert_eq!(tap_prefixes("Chrome / Meet"), vec!["com.google.chrome"]);
        assert!(call_app("com.google.Chrome.helper").is_some());
        assert_eq!(
            tap_prefixes("FaceTime"),
            vec!["com.apple.facetime", "com.apple.avconferenced"]
        );
        assert!(tap_prefixes("Safari / appel web").is_empty());
        assert!(tap_prefixes("Google Meet · test").is_empty());
    }
    #[test]
    fn accepted_calls_carry_their_options() {
        let accepted = AcceptedCall {
            call: DetectedCall {
                id: "call-1".into(),
                app: "Zoom".into(),
                simulated: false,
            },
            options: CallOptions {
                captions: true,
                voice: false,
                microphone: false,
            },
        };
        assert_eq!(
            serde_json::to_value(accepted).expect("json"),
            serde_json::json!({
                "id": "call-1", "app": "Zoom", "simulated": false,
                "options": { "captions": true, "voice": false, "microphone": false }
            })
        );
    }
    #[test]
    fn system_probe_is_readable() {
        assert!(probe().is_ok());
    }
    #[test]
    fn disabled_and_simulated_calls_ignore_polling() {
        let mut m = Monitor::default();
        assert!(!m.tick(&["Zoom".into()]));
        m.snapshot.call = Some(DetectedCall {
            id: "test".into(),
            app: "Test".into(),
            simulated: true,
        });
        for _ in 0..20 {
            assert!(!m.tick(&[]));
        }
        assert!(m.snapshot.call.is_some());
    }
}
