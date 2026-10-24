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
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    Small,
    #[default]
    Medium,
    Large,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    pub size: Size,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub monitor: Option<String>,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            x: 0.5,
            y: 1.0,
            size: Size::Medium,
            monitor: None,
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub session_id: Option<String>,
    pub status: Status,
    pub source: String,
    pub target: String,
    pub lines: Vec<Line>,
    #[serde(default)]
    pub layout: Layout,
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
            if !update.layout.x.is_finite()
                || !update.layout.y.is_finite()
                || !(0.0..=1.0).contains(&update.layout.x)
                || !(0.0..=1.0).contains(&update.layout.y)
                || update
                    .layout
                    .monitor
                    .as_ref()
                    .is_some_and(|name| name.is_empty() || name.len() > 256)
            {
                return Err("Invalid captions position.".into());
            }
            if !update
                .session_id
                .as_ref()
                .is_some_and(|id| !id.is_empty() && id.len() <= 96)
            {
                return Err("Invalid captions session.".into());
            }
            for language in [&update.source, &update.target] {
                if !(2..=12).contains(&language.len())
                    || !language
                        .bytes()
                        .all(|c| c.is_ascii_alphabetic() || c == b'-')
                {
                    return Err("Invalid captions language.".into());
                }
            }
            // The app sends the tail of recent lines; anything larger is a bug, not a caption.
            if update.lines.len() > 3
                || update
                    .lines
                    .iter()
                    .any(|line| line.id.len() > 96 || line.text.len() > 4000)
            {
                return Err("Captions are too long.".into());
            }
        }
        self.captions = update;
        self.revision += 1;
        Ok(())
    }
}
#[derive(Default)]
pub struct State(pub Mutex<Snapshot>);

// Normalized coordinates cover the available travel, keeping the entire window on screen.
fn geometry(
    area: &tauri::PhysicalRect<i32, u32>,
    scale: f64,
    layout: &Layout,
) -> (tauri::PhysicalSize<u32>, tauri::PhysicalPosition<i32>) {
    let (width, height) = match layout.size {
        Size::Small => (720.0_f64, 180.0_f64),
        Size::Medium => (980.0, 220.0),
        Size::Large => (1180.0, 260.0),
    };
    let margin = (16.0 * scale)
        .min(area.size.width as f64 / 4.0)
        .min(area.size.height as f64 / 4.0);
    let bottom = (84.0 * scale).min(area.size.height as f64 / 4.0);
    let available_width = (area.size.width as f64 - 2.0 * margin).max(1.0);
    let available_height = (area.size.height as f64 - margin - bottom).max(1.0);
    let width = (width * scale).min(available_width).floor();
    let height = (height * scale).min(available_height).floor();
    (
        tauri::PhysicalSize::new(width as u32, height as u32),
        tauri::PhysicalPosition::new(
            area.position.x + (margin + (available_width - width) * layout.x).round() as i32,
            area.position.y + (margin + (available_height - height) * layout.y).round() as i32,
        ),
    )
}

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
            let chosen = snapshot.captions.layout.monitor.as_ref().and_then(|name| {
                handle
                    .available_monitors()
                    .ok()?
                    .into_iter()
                    .find(|monitor| monitor.name() == Some(name))
            });
            // Restore the dragged-to screen when connected, otherwise use the main window's screen.
            if let Some(monitor) = chosen.or_else(|| {
                handle
                    .get_webview_window("main")
                    .map_or_else(|| handle.primary_monitor(), |main| main.current_monitor())
                    .ok()
                    .flatten()
            }) {
                let area = monitor.work_area();
                let (size, position) =
                    geometry(area, monitor.scale_factor(), &snapshot.captions.layout);
                let _ = window.set_size(size);
                let _ = window.set_position(position);
            }
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
        return Err("This action is reserved for the main window.".into());
    }
    let reposition = {
        let mut snapshot = state.0.lock().map_err(|e| e.to_string())?;
        let previous = snapshot.captions.session_id.clone();
        let previous_layout = snapshot.captions.layout.clone();
        snapshot.update(update)?;
        previous != snapshot.captions.session_id || previous_layout != snapshot.captions.layout
    };
    refresh(&app, reposition)
}
#[tauri::command]
pub fn call_captions_snapshot(
    window: tauri::WebviewWindow,
    state: tauri::State<State>,
) -> Result<Snapshot, String> {
    if window.label() != "main" && window.label() != "call-captions" {
        return Err("This action is reserved for the captions.".into());
    }
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

fn position_layout(
    area: &tauri::PhysicalRect<i32, u32>,
    scale: f64,
    mut layout: Layout,
    position: tauri::PhysicalPosition<i32>,
) -> Layout {
    let (_, expected) = geometry(area, scale, &layout);
    // Avoid a storage/reposition loop caused by rounding normalized coordinates to physical pixels.
    if (position.x as i64 - expected.x as i64).abs() <= 1
        && (position.y as i64 - expected.y as i64).abs() <= 1
    {
        return layout;
    }
    let (_, start) = geometry(
        area,
        scale,
        &Layout {
            x: 0.0,
            y: 0.0,
            ..layout.clone()
        },
    );
    let (_, end) = geometry(
        area,
        scale,
        &Layout {
            x: 1.0,
            y: 1.0,
            ..layout.clone()
        },
    );
    layout.x =
        ((position.x as f64 - start.x as f64) / (end.x - start.x).max(1) as f64).clamp(0.0, 1.0);
    layout.y =
        ((position.y as f64 - start.y as f64) / (end.y - start.y).max(1) as f64).clamp(0.0, 1.0);
    layout
}

#[tauri::command]
pub fn call_captions_position(
    window: tauri::WebviewWindow,
    state: tauri::State<State>,
    expected: Layout,
) -> Result<Option<Layout>, String> {
    if window.label() != "call-captions" {
        return Err("This action is reserved for the captions.".into());
    }
    let mut layout = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .captions
        .layout
        .clone();
    if layout != expected || !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("The captions screen is unavailable.")?;
    layout.monitor = monitor.name().cloned();
    let position = window.outer_position().map_err(|e| e.to_string())?;
    Ok(Some(position_layout(
        monitor.work_area(),
        monitor.scale_factor(),
        layout,
        position,
    )))
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
            layout: Layout::default(),
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
    #[test]
    fn positions_and_sizes_stay_inside_the_work_area_at_every_corner() {
        for scale in [1.0, 2.0] {
            for (width, height) in [(1920, 1080), (420, 300)] {
                let area = tauri::PhysicalRect {
                    position: tauri::PhysicalPosition::new(-1920, 40),
                    size: tauri::PhysicalSize::new(width, height),
                };
                for size in [Size::Small, Size::Medium, Size::Large] {
                    for (x, y) in [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0)] {
                        let (size, position) = geometry(
                            &area,
                            scale,
                            &Layout {
                                x,
                                y,
                                size,
                                monitor: None,
                            },
                        );
                        assert!(position.x >= area.position.x && position.y >= area.position.y);
                        assert!(position.x + size.width as i32 <= area.position.x + width as i32);
                        assert!(position.y + size.height as i32 <= area.position.y + height as i32);
                    }
                }
            }
        }
    }
    #[test]
    fn invalid_positions_cannot_replace_the_current_layout() {
        let mut snapshot = Snapshot::default();
        snapshot.update(live("one")).expect("live");
        for value in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
            let mut invalid = live("two");
            invalid.layout.x = value;
            assert!(snapshot.update(invalid).is_err());
            assert_eq!(snapshot.captions.session_id.as_deref(), Some("one"));
        }
    }
    #[test]
    fn older_caption_updates_keep_the_default_layout() {
        let update: Update = serde_json::from_value(serde_json::json!({
            "sessionId": "one", "status": "listening", "source": "en", "target": "fr", "lines": []
        }))
        .expect("legacy update");
        assert_eq!(update.layout, Layout::default());
    }
    #[test]
    fn dragged_positions_round_trip_without_drifting_on_retina_or_negative_screens() {
        for scale in [1.0, 2.0] {
            let area = tauri::PhysicalRect {
                position: tauri::PhysicalPosition::new(-1920, -200),
                size: tauri::PhysicalSize::new(1920, 1080),
            };
            let layout = Layout {
                x: 0.372,
                y: 0.814,
                monitor: Some("External display".into()),
                ..Layout::default()
            };
            let (_, original) = geometry(&area, scale, &layout);
            assert_eq!(
                position_layout(&area, scale, layout.clone(), original),
                layout
            );
            for (x, y) in [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0)] {
                let (_, position) = geometry(
                    &area,
                    scale,
                    &Layout {
                        x,
                        y,
                        ..layout.clone()
                    },
                );
                let saved = position_layout(&area, scale, layout.clone(), position);
                let (_, restored) = geometry(&area, scale, &saved);
                assert_eq!(restored, position);
                assert_eq!(saved.monitor, layout.monitor);
            }
            let outside = position_layout(
                &area,
                scale,
                layout,
                tauri::PhysicalPosition::new(-99999, 99999),
            );
            assert_eq!((outside.x, outside.y), (0.0, 1.0));
        }
    }
}
