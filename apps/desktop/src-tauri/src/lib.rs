mod audio_route;
mod calls;
mod translation_overlay;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Keeps the embedded desktop icon in sync with icons/. See build.rs.
    let _ = env!("INTERPRETE_ICON_STAMP");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(calls::CallState(std::sync::Mutex::new(
            calls::Monitor::default(),
        )))
        .manage(audio_route::AudioRoute::default())
        .manage(translation_overlay::State::default())
        .invoke_handler(tauri::generate_handler![
            translation_overlay::set_translation_overlay,
            translation_overlay::translation_overlay_snapshot,
            translation_overlay::stop_translation_overlay,
            calls::call_snapshot,
            calls::call_monitor_enabled,
            calls::simulate_call,
            calls::answer_call,
            calls::end_simulated_call,
            audio_route::audio_outputs,
            audio_route::audio_physical_inputs,
            audio_route::audio_route_open,
            audio_route::audio_route_push,
            audio_route::audio_route_close,
            audio_route::audio_route_status,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            for label in ["call-toast", "translation-overlay"] {
                if let Some(toast) = app.get_webview_window(label)
                    && let Ok(window) = toast.ns_window()
                {
                    unsafe extern "C" {
                        fn interprete_configure_toast(window: *mut std::ffi::c_void);
                    }
                    // Tauri setup runs on the UI thread and keeps this native window alive.
                    unsafe {
                        interprete_configure_toast(window);
                    }
                }
            }
            calls::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
