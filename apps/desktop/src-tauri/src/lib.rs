mod audio_route;
mod calls;
mod system_microphone;
mod translation_overlay;
mod virtual_microphone;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let exit_started = std::sync::atomic::AtomicBool::new(false);
    let restore_finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
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
            audio_route::audio_route_activate,
            audio_route::audio_route_push,
            audio_route::audio_route_close,
            audio_route::audio_route_status,
        ])
        .setup(|app| {
            app.state::<audio_route::AudioRoute>().configure(app.path().app_data_dir()?.join("microphone-restore.json"))?;
            #[cfg(unix)] {
                let handle = app.handle().clone();
                ctrlc::set_handler(move || handle.exit(0))?;
            }
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event
                && !restore_finished.load(std::sync::atomic::Ordering::SeqCst) {
                api.prevent_exit();
                // Repeated signals/close requests must also wait for restoration.
                if exit_started.swap(true, std::sync::atomic::Ordering::SeqCst) { return; }
                let handle = app.clone();
                let completed = restore_finished.clone();
                tauri::async_runtime::spawn(async move {
                    if handle.state::<audio_route::AudioRoute>().shutdown().await.is_err() {
                        eprintln!("Microphone restoration pending; recovery record retained for next launch.");
                    }
                    completed.store(true, std::sync::atomic::Ordering::SeqCst);
                    handle.exit(code.unwrap_or(0));
                });
            }
        });
}
