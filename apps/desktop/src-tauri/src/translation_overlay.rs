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
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub session: Update,
    pub stop_requested: bool,
    pub revision: u64,
}
impl Snapshot {
    fn active(&self) -> bool {
        self.session.session_id.is_some() && self.session.phase != Phase::Idle
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
                return Err("Session de traduction invalide.".into());
            }
            for language in [&update.source, &update.target] {
                if !(2..=12).contains(&language.len())
                    || !language
                        .bytes()
                        .all(|c| c.is_ascii_alphabetic() || c == b'-')
                {
                    return Err("Langue de traduction invalide.".into());
                }
            }
        }
        self.stop_requested =
            self.active() && self.session.session_id == update.session_id && self.stop_requested;
        self.session = update;
        self.revision += 1;
        Ok(())
    }
    fn request_stop(&mut self, session_id: &str) -> Result<bool, String> {
        if !self.active() || self.session.session_id.as_deref() != Some(session_id) {
            return Err("Cette traduction est déjà terminée.".into());
        }
        if self.stop_requested {
            return Ok(false);
        }
        self.stop_requested = true;
        self.revision += 1;
        Ok(true)
    }
}
#[derive(Default)]
pub struct State(pub Mutex<Snapshot>);
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
                if let Ok(Some(monitor)) = handle
                    .get_webview_window("main")
                    .map_or_else(|| handle.primary_monitor(), |main| main.current_monitor())
                {
                    let area = monitor.work_area();
                    let scale = monitor.scale_factor();
                    let _ = window.set_position(tauri::PhysicalPosition::new(
                        area.position.x + area.size.width as i32 - (264.0 * scale) as i32,
                        area.position.y + (area.size.height as f64 * 0.5) as i32
                            - (36.0 * scale) as i32,
                    ));
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
        Err("Action réservée à la traduction.".into())
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
#[cfg(test)]
mod tests {
    use super::*;
    fn live(id: &str) -> Update {
        Update {
            session_id: Some(id.into()),
            phase: Phase::Listening,
            source: "fr".into(),
            target: "en".into(),
            test: false,
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
