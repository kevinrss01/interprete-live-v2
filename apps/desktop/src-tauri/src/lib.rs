mod audio_route;
mod call_captions;
mod calls;
mod system_audio;
mod translation_overlay;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(calls::CallState(std::sync::Mutex::new(
            calls::Monitor::default(),
        )))
        .manage(audio_route::AudioRoute::default())
        .manage(translation_overlay::State::default())
        .manage(call_captions::State::default())
        .manage(system_audio::SystemAudio::default())
        .invoke_handler(tauri::generate_handler![
            translation_overlay::set_translation_overlay,
            translation_overlay::translation_overlay_snapshot,
            translation_overlay::stop_translation_overlay,
            call_captions::set_call_captions,
            call_captions::call_captions_snapshot,
            system_audio::system_audio_start,
            system_audio::system_audio_stop,
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
            for label in ["call-toast", "translation-overlay", "call-captions"] {
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
            if let Some(captions) = app.get_webview_window("call-captions") {
                let _ = captions.set_ignore_cursor_events(true);
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
