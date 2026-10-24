use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Idle,
    Starting,
    Listening,
    Preview,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub id: String,
    pub text: String,
    pub live: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub session_id: Option<String>,
    pub status: Status,
    pub source: String,
    pub target: String,
    pub lines: Vec<Line>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub captions: Update,
    pub revision: u64,
}
impl Snapshot {
    fn visible(&self) -> bool {
        self.captions.session_id.is_some() && self.captions.status != Status::Idle
    }
    fn update(&mut self, mut update: Update) -> Result<(), String> {
        if update.status == Status::Idle {
            update = Update::default();
        } else {
            if !update
                .session_id
                .as_ref()
                .is_some_and(|id| !id.is_empty() && id.len() <= 96)
            {
                return Err("Session de sous-titres invalide.".into());
            }
            for language in [&update.source, &update.target] {
                if !(2..=12).contains(&language.len())
                    || !language
                        .bytes()
                        .all(|c| c.is_ascii_alphabetic() || c == b'-')
                {
                    return Err("Langue des sous-titres invalide.".into());
                }
            }
            // The app sends the tail of recent lines; anything larger is a bug, not a caption.
            if update.lines.len() > 3
                || update
                    .lines
                    .iter()
                    .any(|line| line.id.len() > 96 || line.text.len() > 4000)
            {
                return Err("Sous-titres trop longs.".into());
            }
        }
        self.captions = update;
        self.revision += 1;
        Ok(())
    }
}
#[derive(Default)]
pub struct State(pub Mutex<Snapshot>);

fn refresh(app: &tauri::AppHandle, reposition: bool) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let snapshot = match handle.state::<State>().0.lock() {
            Ok(state) => state.clone(),
            Err(_) => return,
        };
        let _ = handle.emit_to("call-captions", "call-captions-state", &snapshot);
        let Some(window) = handle.get_webview_window("call-captions") else {
            return;
        };
        if !snapshot.visible() {
            let _ = window.hide();
            return;
        }
        if reposition || !window.is_visible().unwrap_or(false) {
            // Bottom centre of the screen, above the toolbars of Meet, Zoom and Teams.
            if let Ok(Some(monitor)) = handle
                .get_webview_window("main")
                .map_or_else(|| handle.primary_monitor(), |main| main.current_monitor())
            {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                let width = (980.0 * scale).min(area.size.width as f64 * 0.82);
                let height = 220.0 * scale;
                let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
                let _ = window.set_position(tauri::PhysicalPosition::new(
                    area.position.x + ((area.size.width as f64 - width) / 2.0) as i32,
                    area.position.y + area.size.height as i32 - (height + 84.0 * scale) as i32,
                ));
            }
            // Captions never intercept clicks meant for the call underneath.
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.set_visible_on_all_workspaces(true);
            let _ = window.show();
        }
    })
    .map_err(|error| error.to_string())
}
#[tauri::command]
pub fn set_call_captions(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<State>,
    update: Update,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Action réservée à la fenêtre principale.".into());
    }
    let reposition = {
        let mut snapshot = state.0.lock().map_err(|e| e.to_string())?;
        let previous = snapshot.captions.session_id.clone();
        snapshot.update(update)?;
        previous != snapshot.captions.session_id
    };
    refresh(&app, reposition)
}
#[tauri::command]
pub fn call_captions_snapshot(
    window: tauri::WebviewWindow,
    state: tauri::State<State>,
) -> Result<Snapshot, String> {
    if window.label() != "main" && window.label() != "call-captions" {
        return Err("Action réservée aux sous-titres.".into());
    }
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn live(id: &str) -> Update {
        Update {
            session_id: Some(id.into()),
            status: Status::Listening,
            source: "en".into(),
            target: "fr".into(),
            lines: vec![Line {
                id: "line".into(),
                text: "Bonjour à tous".into(),
                live: true,
            }],
        }
    }
    #[test]
    fn captions_follow_the_session_and_clear_when_idle() {
        let mut snapshot = Snapshot::default();
        assert!(!snapshot.visible());
        snapshot.update(live("one")).expect("live");
        assert!(snapshot.visible());
        assert_eq!(snapshot.revision, 1);
        snapshot
            .update(Update {
                lines: vec![Line::default()],
                ..Update::default()
            })
            .expect("idle");
        assert!(!snapshot.visible());
        assert!(snapshot.captions.lines.is_empty());
    }
    #[test]
    fn invalid_or_oversized_captions_are_rejected() {
        let mut snapshot = Snapshot::default();
        let mut bad = live("one");
        bad.target = "x".into();
        assert!(snapshot.update(bad).is_err());
        let mut long = live("one");
        long.lines = vec![Line::default(); 4];
        assert!(snapshot.update(long).is_err());
        let mut anonymous = live("one");
        anonymous.session_id = None;
        assert!(snapshot.update(anonymous).is_err());
        assert_eq!(snapshot.revision, 0);
    }
}
