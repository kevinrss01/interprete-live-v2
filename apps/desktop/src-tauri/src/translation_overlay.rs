use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Idle,
    Connecting,
    Listening,
    Finishing,
    Translating,
    Playing,
    Preview,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub session_id: Option<String>,
    pub phase: Phase,
    pub source: String,
    pub target: String,
    pub test: bool,
    #[serde(default)]
    pub bidirectional: bool,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub session: Update,
    pub stop_requested: bool,
    pub revision: u64,
    pub expanded: bool,
}
impl Snapshot {
    fn active(&self) -> bool {
        self.session.session_id.is_some() && self.session.phase != Phase::Idle
    }
    fn require_session(&self, session_id: &str) -> Result<(), String> {
        if self.active() && self.session.session_id.as_deref() == Some(session_id) {
            Ok(())
        } else {
            Err("This translation has already ended.".into())
        }
    }
    fn update(&mut self, mut update: Update) -> Result<(), String> {
        if update.phase == Phase::Idle {
            update = Update::default();
        } else {
            if !update
                .session_id
                .as_ref()
                .is_some_and(|id| !id.is_empty() && id.len() <= 96)
            {
                return Err("Invalid translation session.".into());
            }
            for language in [&update.source, &update.target] {
                if !(2..=12).contains(&language.len())
                    || !language
                        .bytes()
                        .all(|c| c.is_ascii_alphabetic() || c == b'-')
                {
                    return Err("Invalid translation language.".into());
                }
            }
        }
        if self.session.session_id != update.session_id {
            self.expanded = false;
        }
        self.stop_requested =
            self.active() && self.session.session_id == update.session_id && self.stop_requested;
        self.session = update;
        self.revision += 1;
        Ok(())
    }
    fn request_stop(&mut self, session_id: &str) -> Result<bool, String> {
        self.require_session(session_id)?;
        if self.stop_requested {
            return Ok(false);
        }
        self.stop_requested = true;
        self.revision += 1;
        Ok(true)
    }
    fn expand(&mut self, session_id: &str, expanded: bool) -> Result<(), String> {
        self.require_session(session_id)?;
        self.expanded = expanded;
        self.revision += 1;
        Ok(())
    }
}
#[derive(Default)]
pub struct State(pub Mutex<Snapshot>);
fn bottom_right(
    area: &tauri::PhysicalRect<i32, u32>,
    scale: f64,
    height: f64,
) -> tauri::PhysicalPosition<i32> {
    // Keep the window, including its transparent inset, above the Dock/taskbar.
    tauri::PhysicalPosition::new(
        area.position.x + (area.size.width as i32 - (392.0 * scale) as i32).max(0),
        area.position.y + (area.size.height as i32 - ((height + 16.0) * scale) as i32).max(0),
    )
}
fn refresh(app: &tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let snapshot = match handle.state::<State>().0.lock() {
            Ok(state) => state.clone(),
            Err(_) => return,
        };
        // Never hold the state lock across native window calls. Read the latest state here,
        // so a delayed show cannot resurrect an overlay after its session stopped.
        let _ = handle.emit_to(
            "translation-overlay",
            "translation-overlay-state",
            &snapshot,
        );
        if let Some(window) = handle.get_webview_window("translation-overlay") {
            if snapshot.active() {
                let height = if snapshot.expanded { 204.0 } else { 116.0 };
                let _ = window.set_size(tauri::LogicalSize::new(376.0, height));
                if let Ok(Some(monitor)) = handle
                    .get_webview_window("main")
                    .map_or_else(|| handle.primary_monitor(), |main| main.current_monitor())
                {
                    let area = monitor.work_area();
                    let scale = monitor.scale_factor();
                    let _ = window.set_position(bottom_right(area, scale, height));
                }
                let _ = window.set_visible_on_all_workspaces(true);
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.show();
                }
            } else {
                let _ = window.hide();
            }
        }
    })
    .map_err(|error| error.to_string())
}
fn authorize(window: &tauri::WebviewWindow, main_only: bool) -> Result<(), String> {
    if window.label() == "main" || (!main_only && window.label() == "translation-overlay") {
        Ok(())
    } else {
        Err("This action is reserved for the translation.".into())
    }
}
#[tauri::command]
pub fn set_translation_overlay(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<State>,
    update: Update,
) -> Result<(), String> {
    authorize(&window, true)?;
    state.0.lock().map_err(|e| e.to_string())?.update(update)?;
    refresh(&app)
}
#[tauri::command]
pub fn translation_overlay_snapshot(
    window: tauri::WebviewWindow,
    state: tauri::State<State>,
) -> Result<Snapshot, String> {
    authorize(&window, false)?;
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}
#[tauri::command]
pub fn stop_translation_overlay(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<State>,
    session_id: String,
) -> Result<Snapshot, String> {
    authorize(&window, false)?;
    let (notify, snapshot) = {
        let mut snapshot = state.0.lock().map_err(|e| e.to_string())?;
        let notify = snapshot.request_stop(&session_id)?;
        (notify, snapshot.clone())
    };
    if notify {
        app.emit_to("main", "translation-overlay-stop", &session_id)
            .map_err(|e| e.to_string())?;
    }
    refresh(&app)?;
    Ok(snapshot)
}
#[tauri::command]
pub fn expand_translation_options(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<State>,
    session_id: String,
    expanded: bool,
) -> Result<Snapshot, String> {
    authorize(&window, false)?;
    let snapshot = {
        let mut snapshot = state.0.lock().map_err(|e| e.to_string())?;
        snapshot.expand(&session_id, expanded)?;
        snapshot.clone()
    };
    refresh(&app)?;
    Ok(snapshot)
}
#[tauri::command]
pub fn open_translation_options(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<State>,
    session_id: String,
) -> Result<(), String> {
    authorize(&window, false)?;
    {
        let snapshot = state.0.lock().map_err(|e| e.to_string())?;
        snapshot.require_session(&session_id)?;
    }
    let main = app
        .get_webview_window("main")
        .ok_or("The translation options are unavailable.")?;
    app.emit_to("main", "translation-overlay-options", &session_id)
        .map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn card_stays_at_the_bottom_right_of_each_scaled_monitor() {
        for scale in [1.0, 2.0] {
            let area = tauri::PhysicalRect {
                position: tauri::PhysicalPosition::new(-2560, 40),
                size: tauri::PhysicalSize::new(2560, 1440),
            };
            let position = bottom_right(&area, scale, 116.0);
            assert_eq!(position.x + (376.0 * scale) as i32, -(16.0 * scale) as i32);
            assert_eq!(
                position.y + (116.0 * scale) as i32,
                1480 - (16.0 * scale) as i32
            );
        }
    }
    #[test]
    fn options_only_accept_the_current_session_without_changing_it() {
        let mut snapshot = Snapshot::default();
        assert!(snapshot.require_session("one").is_err());
        snapshot.update(live("one")).expect("live");
        let revision = snapshot.revision;
        assert!(snapshot.require_session("one").is_ok());
        assert!(!snapshot.stop_requested);
        assert_eq!(snapshot.revision, revision);
        snapshot.update(live("two")).expect("new");
        assert!(snapshot.require_session("one").is_err());
    }
    #[test]
    fn options_expand_without_stopping_and_reset_for_a_new_session() {
        let mut snapshot = Snapshot::default();
        snapshot.update(live("one")).expect("live");
        snapshot.expand("one", true).expect("expand");
        assert!(snapshot.expanded && snapshot.active() && !snapshot.stop_requested);
        snapshot.update(live("one")).expect("status update");
        assert!(snapshot.expanded);
        assert!(snapshot.expand("old", false).is_err());
        assert!(snapshot.expanded);
        snapshot.update(live("two")).expect("new");
        assert!(!snapshot.expanded);
    }
    fn live(id: &str) -> Update {
        Update {
            session_id: Some(id.into()),
            phase: Phase::Listening,
            source: "fr".into(),
            target: "en".into(),
            test: false,
            bidirectional: false,
        }
    }
    #[test]
    fn visibility_follows_the_actual_session() {
        let mut snapshot = Snapshot::default();
        assert!(!snapshot.active());
        snapshot.update(live("one")).expect("live");
        assert!(snapshot.active());
        snapshot.update(Update::default()).expect("idle");
        assert!(!snapshot.active());
        assert!(!snapshot.stop_requested);
    }
    #[test]
    fn stale_stop_cannot_cancel_a_new_session() {
        let mut snapshot = Snapshot::default();
        snapshot.update(live("old")).expect("old");
        snapshot.update(live("new")).expect("new");
        assert!(snapshot.request_stop("old").is_err());
        assert!(!snapshot.stop_requested);
        assert!(snapshot.request_stop("new").expect("stop"));
        assert!(!snapshot.request_stop("new").expect("duplicate"));
    }
    #[test]
    fn status_updates_cannot_clear_a_pending_stop() {
        let mut snapshot = Snapshot::default();
        snapshot.update(live("one")).expect("live");
        snapshot.request_stop("one").expect("stop");
        snapshot.update(live("one")).expect("update");
        assert!(snapshot.stop_requested);
        snapshot.update(live("two")).expect("new session");
        assert!(!snapshot.stop_requested);
    }
    #[test]
    fn preview_is_explicit_and_invalid_state_is_rejected() {
        let mut snapshot = Snapshot::default();
        let mut preview = live("preview");
        preview.phase = Phase::Preview;
        snapshot.update(preview).expect("preview");
        assert!(snapshot.active());
        assert_eq!(snapshot.session.phase, Phase::Preview);
        let revision = snapshot.revision;
        let mut invalid = live("bad");
        invalid.source = "x".into();
        assert!(snapshot.update(invalid).is_err());
        assert_eq!(snapshot.revision, revision);
        snapshot.update(Update::default()).expect("closed");
        assert!(snapshot.request_stop("preview").is_err());
    }
}
