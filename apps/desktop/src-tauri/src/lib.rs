mod audio_route;
mod call_captions;
mod calls;
mod system_audio;
mod system_microphone;
mod translation_overlay;
mod virtual_camera;
mod virtual_microphone;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let exit_started = std::sync::atomic::AtomicBool::new(false);
    let restore_finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // Keeps the embedded desktop icon in sync with icons/. See build.rs.
    let _ = env!("INTERPRETE_ICON_STAMP");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(calls::CallState(std::sync::Mutex::new(
            calls::Monitor::default(),
        )))
        .manage(audio_route::AudioRoute::default())
        .manage(translation_overlay::State::default())
        .manage(call_captions::State::default())
        .manage(system_audio::SystemAudio::default())
        .manage(virtual_camera::CameraRelay::default())
        .invoke_handler(tauri::generate_handler![
            translation_overlay::set_translation_overlay,
            translation_overlay::translation_overlay_snapshot,
            translation_overlay::stop_translation_overlay,
            call_captions::set_call_captions,
            call_captions::call_captions_snapshot,
            call_captions::call_captions_position,
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
            audio_route::audio_route_activate,
            audio_route::audio_route_push,
            audio_route::audio_route_close,
            audio_route::audio_route_status,
            virtual_camera::camera_devices,
            virtual_camera::camera_access,
            virtual_camera::camera_relay_start,
            virtual_camera::camera_relay_caption,
            virtual_camera::camera_relay_stop,
            virtual_camera::camera_relay_status,
            virtual_camera::camera_relay_preview,
        ])
        .setup(|app| {
            app.state::<audio_route::AudioRoute>().configure(app.path().app_data_dir()?.join("microphone-restore.json"))?;
            #[cfg(unix)] {
                let handle = app.handle().clone();
                ctrlc::set_handler(move || handle.exit(0))?;
            }
            #[cfg(target_os = "macos")]
            if let Some(prompt) = app.get_webview_window("call-toast")
                && let Ok(window) = prompt.ns_window()
            {
                unsafe extern "C" {
                    fn interprete_configure_call_prompt(window: *mut std::ffi::c_void);
                }
                // Tauri setup runs on the UI thread and keeps this native window alive.
                unsafe {
                    interprete_configure_call_prompt(window);
                }
            }
            // Captions and the pill float above other apps, including a full-screen call or browser.
            #[cfg(target_os = "macos")]
            for label in ["translation-overlay", "call-captions"] {
                if let Some(overlay) = app.get_webview_window(label)
                    && let Ok(window) = overlay.ns_window()
                {
                    unsafe extern "C" {
                        fn interprete_configure_overlay(window: *mut std::ffi::c_void);
                    }
                    // Tauri setup runs on the UI thread and keeps this native window alive.
                    unsafe {
                        interprete_configure_overlay(window);
                    }
                }
            }
            calls::start(app.handle().clone());
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                webview.state::<system_audio::SystemAudio>().release_all();
                // Waits for a camera still opening, so off the main thread.
                let app = webview.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    app.state::<virtual_camera::CameraRelay>().release_all();
                });
            }
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
                    // Stopping a capture session blocks briefly; keep it off the main thread.
                    let camera = handle.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        camera.state::<virtual_camera::CameraRelay>().shutdown();
                    })
                    .await;
                    if handle.state::<audio_route::AudioRoute>().shutdown().await.is_err() {
                        eprintln!("Microphone restoration pending; recovery record retained for next launch.");
                    }
                    completed.store(true, std::sync::atomic::Ordering::SeqCst);
                    handle.exit(code.unwrap_or(0));
                });
            }
        });
}
