use serde::{Deserialize, Serialize};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};

// 20 ms at 24 kHz: the same PCM frame the microphone capture sends to transcription.
const FRAME_SAMPLES: usize = 480;
const STALL_MS: u64 = 3000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub scope: String,
    pub processes: u32,
}
#[derive(Deserialize)]
struct Reply {
    scope: Option<String>,
    processes: Option<u32>,
    error: Option<String>,
}

// Averaging each output period is a cheap anti-alias filter for 48 or 44.1 kHz → 24 kHz.
#[derive(Default)]
struct Downsampler {
    sum: f64,
    filled: f64,
}
impl Downsampler {
    fn push(&mut self, input: &[f32], rate: f64, output: &mut Vec<i16>) {
        let ratio = rate / 24000.0;
        for &sample in input {
            let mut remaining: f64 = 1.0;
            while remaining > 1e-9 {
                let take = remaining.min(ratio - self.filled);
                self.sum += sample as f64 * take;
                self.filled += take;
                remaining -= take;
                if self.filled >= ratio - 1e-9 {
                    output.push(((self.sum / ratio).clamp(-1.0, 1.0) * 32767.0).round() as i16);
                    self.sum = 0.0;
                    self.filled = 0.0;
                }
            }
        }
    }
}

struct Sink {
    channel: Channel<InvokeResponseBody>,
    resampler: Downsampler,
    pending: Vec<i16>,
    started: Instant,
    last: Arc<AtomicU64>,
}
impl Sink {
    fn receive(&mut self, samples: &[f32], rate: f64) {
        self.last
            .store(self.started.elapsed().as_millis() as u64, Ordering::Relaxed);
        self.resampler.push(samples, rate, &mut self.pending);
        let mut sent = 0;
        while self.pending.len() - sent >= FRAME_SAMPLES {
            let frame: Vec<u8> = self.pending[sent..sent + FRAME_SAMPLES]
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect();
            // A closed webview only drops frames; the stop command releases the tap.
            let _ = self.channel.send(InvokeResponseBody::Raw(frame));
            sent += FRAME_SAMPLES;
        }
        self.pending.drain(..sent);
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn interprete_tap_start(
        prefixes: *const std::ffi::c_char,
        callback: extern "C" fn(*mut std::ffi::c_void, *const f32, u32, f64),
        context: *mut std::ffi::c_void,
        handle: *mut *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_char;
    fn interprete_tap_stop(handle: *mut std::ffi::c_void);
    fn free(ptr: *mut std::ffi::c_void);
}
#[cfg(target_os = "macos")]
extern "C" fn on_samples(context: *mut std::ffi::c_void, samples: *const f32, frames: u32, rate: f64) {
    if context.is_null() || samples.is_null() || frames == 0 {
        return;
    }
    // The bridge calls this on one serial queue, only between start and stop, while the Sink is alive.
    let sink = unsafe { &mut *context.cast::<Sink>() };
    let samples = unsafe { std::slice::from_raw_parts(samples, frames as usize) };
    sink.receive(samples, rate);
}

struct Capture {
    started: Started,
    handle: *mut std::ffi::c_void,
    sink: *mut Sink,
    stopped: Arc<AtomicBool>,
}
// The handle and sink are only touched by start, the serial tap queue and Drop.
unsafe impl Send for Capture {}
impl Drop for Capture {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        unsafe {
            // Synchronous: no callback can use the sink after this returns.
            interprete_tap_stop(self.handle);
            drop(Box::from_raw(self.sink));
        }
    }
}

#[cfg(target_os = "macos")]
fn start(
    prefixes: Vec<&'static str>,
    channel: Channel<InvokeResponseBody>,
) -> Result<Capture, String> {
    let prefixes = std::ffi::CString::new(serde_json::to_string(&prefixes).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let last = Arc::new(AtomicU64::new(0));
    let started_at = Instant::now();
    let sink = Box::into_raw(Box::new(Sink {
        channel: channel.clone(),
        resampler: Downsampler::default(),
        pending: Vec::with_capacity(FRAME_SAMPLES * 4),
        started: started_at,
        last: last.clone(),
    }));
    let mut handle = std::ptr::null_mut();
    let ptr = unsafe { interprete_tap_start(prefixes.as_ptr(), on_samples, sink.cast(), &mut handle) };
    let reply = if ptr.is_null() {
        Err("CoreAudio n’a pas répondu.".to_string())
    } else {
        let parsed = serde_json::from_slice::<Reply>(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes())
            .map_err(|e| e.to_string());
        // The bridge allocates with strdup.
        unsafe { free(ptr.cast()) };
        parsed
    };
    let started = match reply {
        Ok(Reply {
            scope: Some(scope),
            processes,
            error: None,
        }) if !handle.is_null() => Started {
            scope,
            processes: processes.unwrap_or(0),
        },
        other => {
            unsafe {
                if !handle.is_null() {
                    interprete_tap_stop(handle);
                }
                drop(Box::from_raw(sink));
            }
            return Err(match other {
                Ok(Reply { error: Some(error), .. }) => error,
                Err(error) => error,
                _ => "La capture de l’appel n’a pas démarré.".into(),
            });
        }
    };
    // Creating the tap can take seconds (permission check); the stall clock starts now.
    last.fetch_max(started_at.elapsed().as_millis() as u64, Ordering::Relaxed);
    let stopped = Arc::new(AtomicBool::new(false));
    let watch = stopped.clone();
    // Report a silent failure (permission revoked, device lost) instead of transcribing nothing forever.
    std::thread::spawn(move || {
        while !watch.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(500));
            let elapsed = started_at.elapsed().as_millis() as u64;
            if elapsed.saturating_sub(last.load(Ordering::Relaxed)) > STALL_MS {
                if !watch.load(Ordering::Relaxed) {
                    let _ = channel.send(InvokeResponseBody::Json(r#"{"type":"stalled"}"#.into()));
                }
                return;
            }
        }
    });
    Ok(Capture {
        started,
        handle,
        sink,
        stopped,
    })
}
#[cfg(not(target_os = "macos"))]
fn start(
    _prefixes: Vec<&'static str>,
    _channel: Channel<InvokeResponseBody>,
) -> Result<Capture, String> {
    Err("La capture du son d’un appel nécessite macOS.".into())
}

// Creating a tap happens outside the lock. Only the most recent request may install its capture:
// a start that was stopped or superseded meanwhile discards its own tap, never a newer one.
struct Slot<T> {
    current: Option<(String, T)>,
    latest: Option<String>,
}
impl<T> Default for Slot<T> {
    fn default() -> Self {
        Self {
            current: None,
            latest: None,
        }
    }
}
impl<T> Slot<T> {
    fn reserve(&mut self, id: &str) -> Option<T> {
        self.latest = Some(id.into());
        self.current.take().map(|(_, value)| value)
    }
    fn install(&mut self, id: &str, value: T) -> Result<(), T> {
        if self.latest.as_deref() != Some(id) {
            return Err(value);
        }
        self.current = Some((id.into(), value));
        Ok(())
    }
    fn release(&mut self, id: &str) -> Option<T> {
        if self.latest.as_deref() == Some(id) {
            self.latest = None;
        }
        if self.current.as_ref().is_some_and(|(current, _)| current == id) {
            self.current.take().map(|(_, value)| value)
        } else {
            None
        }
    }
}
#[derive(Default)]
pub struct SystemAudio(Mutex<Slot<Capture>>);

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Capture réservée à la fenêtre principale.".into())
    }
}
#[tauri::command]
pub async fn system_audio_start(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SystemAudio>,
    id: String,
    source: Option<String>,
    on_audio: Channel<InvokeResponseBody>,
) -> Result<Started, String> {
    main_only(&window)?;
    if id.is_empty() || id.len() > 96 {
        return Err("Capture invalide.".into());
    }
    let prefixes = source
        .as_deref()
        .map(crate::calls::tap_prefixes)
        .unwrap_or_default();
    // One tap at a time: a new session releases the previous capture before it starts.
    let previous = state.0.lock().map_err(|e| e.to_string())?.reserve(&id);
    let capture = tauri::async_runtime::spawn_blocking(move || {
        drop(previous);
        start(prefixes, on_audio)
    })
    .await
    .map_err(|e| e.to_string())??;
    let started = capture.started.clone();
    let installed = state.0.lock().map_err(|e| e.to_string())?.install(&id, capture);
    if let Err(stale) = installed {
        tauri::async_runtime::spawn_blocking(move || drop(stale));
        return Err("Cette capture a été arrêtée.".into());
    }
    Ok(started)
}
#[tauri::command]
pub async fn system_audio_stop(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SystemAudio>,
    id: String,
) -> Result<(), String> {
    main_only(&window)?;
    let capture = state.0.lock().map_err(|e| e.to_string())?.release(&id);
    if let Some(capture) = capture {
        tauri::async_runtime::spawn_blocking(move || drop(capture))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downsampling_averages_and_is_packet_invariant() {
        let input: Vec<f32> = (0..4800).map(|i| ((i % 96) as f32 / 48.0) - 1.0).collect();
        for rate in [48000.0, 44100.0, 96000.0, 16000.0] {
            let mut all = Vec::new();
            Downsampler::default().push(&input, rate, &mut all);
            let mut split = Vec::new();
            let mut resampler = Downsampler::default();
            for part in input.chunks(127) {
                resampler.push(part, rate, &mut split);
            }
            assert_eq!(all, split);
            let expected = input.len() as f64 * 24000.0 / rate;
            assert!((all.len() as f64 - expected).abs() <= 1.0, "{rate}: {}", all.len());
        }
        let mut pairs = Vec::new();
        Downsampler::default().push(&[0.5, -0.5, 1.0, 1.0, 2.0, 2.0], 48000.0, &mut pairs);
        assert_eq!(pairs, vec![0, 32767, 32767]);
    }
    #[test]
    fn a_stopped_or_superseded_start_cannot_replace_the_live_capture() {
        let mut slot = Slot::<&str>::default();
        assert!(slot.reserve("a").is_none());
        // A is still being created when it is stopped, then B starts and installs first.
        assert!(slot.release("a").is_none());
        assert!(slot.reserve("b").is_none());
        assert_eq!(slot.install("b", "tap b"), Ok(()));
        assert_eq!(slot.install("a", "tap a"), Err("tap a"));
        assert!(slot.release("a").is_none(), "a stale stop keeps B running");
        // C supersedes B, and B's capture is handed back to be released.
        assert_eq!(slot.reserve("c"), Some("tap b"));
        assert_eq!(slot.install("c", "tap c"), Ok(()));
        assert_eq!(slot.release("c"), Some("tap c"));
        assert_eq!(slot.install("c", "late"), Err("late"));
    }
    #[test]
    #[ignore = "captures system audio for one second; run pnpm test:system-audio"]
    fn system_audio_tap_delivers_frames() {
        let frames = Arc::new(AtomicU64::new(0));
        let count = frames.clone();
        let channel: Channel<InvokeResponseBody> = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                assert_eq!(bytes.len(), FRAME_SAMPLES * 2);
                count.fetch_add(1, Ordering::Relaxed);
            }
            Ok(())
        });
        let opening = Instant::now();
        let capture = start(vec![], channel).expect("Start the process tap");
        let opened = opening.elapsed();
        std::thread::sleep(Duration::from_millis(1200));
        let started = capture.started.clone();
        let closing = Instant::now();
        drop(capture);
        let delivered = frames.load(Ordering::Relaxed);
        println!(
            "System audio tap: scope {}, {delivered} frames of 20 ms, opened in {opened:?}, closed in {:?}",
            started.scope,
            closing.elapsed()
        );
        assert_eq!(started.scope, "system");
        assert!(delivered >= 40, "The tap delivered only {delivered} frames");
    }
}
