use crate::{
    system_microphone::{InputLease, NativeInput},
    virtual_microphone::{self, OutputDevice},
};
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{
    HeapProd, HeapRb,
    traits::{Consumer, Observer, Producer, Split},
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc,
};
use std::time::Duration;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStatus {
    pub pending_seconds: f64,
    pub failed: bool,
}
pub const SYSTEM_OUTPUT: &str = "@system-output";
fn devices(create: bool) -> Result<Vec<OutputDevice>, String> {
    virtual_microphone::outputs(create)
}
fn physical_inputs() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn interprete_physical_inputs() -> *mut std::ffi::c_char;
            fn free(ptr: *mut std::ffi::c_void);
        }
        // The bridge returns an owned strdup buffer; free with the same C allocator after parsing.
        let ptr = unsafe { interprete_physical_inputs() };
        if ptr.is_null() {
            return Err("Unable to check the physical microphones.".into());
        }
        let parsed = serde_json::from_slice(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_bytes())
            .map_err(|e| e.to_string());
        unsafe {
            free(ptr.cast());
        }
        parsed
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(vec![])
    }
}
#[tauri::command]
pub async fn audio_physical_inputs(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(physical_inputs)
        .await
        .map_err(|e| e.to_string())?
}
// Retain interpolation state across packets so packet boundaries cannot insert gaps.
#[derive(Default)]
struct Resampler {
    previous: Option<f32>,
    position: f64,
}
impl Resampler {
    fn convert(&mut self, bytes: &[u8], rate: u32) -> Vec<f32> {
        let mut output = Vec::with_capacity(bytes.len() / 2 * (rate as usize / 24000 + 1));
        let step = 24000.0 / rate as f64;
        for pair in bytes.as_chunks::<2>().0 {
            let next = i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0;
            if let Some(previous) = self.previous {
                while self.position < 1.0 {
                    output.push(previous + (next - previous) * self.position as f32);
                    self.position += step;
                }
                self.position -= 1.0;
            }
            self.previous = Some(next);
        }
        output
    }
}
struct Route {
    id: String,
    name: String,
    _stream: cpal::Stream,
    producer: HeapProd<f32>,
    rate: u32,
    failed: Arc<AtomicBool>,
    resampler: Resampler,
    device_uid: String,
    input_lease: Option<InputLease>,
    reset: Arc<PlaybackReset>,
}
#[derive(Default)]
struct PlaybackReset {
    requested: AtomicU64,
    applied: AtomicU64,
}
impl PlaybackReset {
    fn apply(&self, consumer: &mut impl Consumer<Item = f32>) {
        let requested = self.requested.load(Ordering::Acquire);
        if self.applied.load(Ordering::Relaxed) != requested {
            consumer.clear();
            self.applied.store(requested, Ordering::Release);
        }
    }
}
impl Route {
    fn new(id: String, name: &str) -> Result<Self, String> {
        let (device, device_uid, app_mic) = if name == SYSTEM_OUTPUT {
            (
                cpal::default_host()
                    .default_output_device()
                    .ok_or("No audio output is available on this Mac.")?,
                String::new(),
                false,
            )
        } else {
            let available = devices(false)?;
            let approved = available
                .iter()
                .find(|device| device.name == name)
                .ok_or("Choose the app’s virtual microphone as the output.")?;
            // Publish the aggregate as the microphone, but feed its sole loopback driver directly.
            let playback = if approved.app_mic {
                available
                    .iter()
                    .find(|device| device.uid == "BlackHole2ch_UID")
                    .ok_or("The virtual microphone driver is no longer available.")?
            } else {
                approved
            };
            let device = cpal::default_host()
                .devices()
                .map_err(|e| e.to_string())?
                .find(|device| device.name().is_ok_and(|n| n == playback.name))
                .ok_or("The virtual microphone is missing. Refresh the devices.")?;
            (device, approved.uid.clone(), approved.app_mic)
        };
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let mut config = supported.config();
        // Ask for a small native callback where supported. CoreAudio chooses its hardware period.
        if !app_mic && let cpal::SupportedBufferSize::Range { min, max } = supported.buffer_size() {
            config.buffer_size = cpal::BufferSize::Fixed(128_u32.clamp(*min, *max));
        }
        let rate = config.sample_rate.0;
        let channels = config.channels as usize;
        let (producer, mut consumer) = HeapRb::<f32>::new(rate as usize * 8).split();
        let reset = Arc::new(PlaybackReset::default());
        let callback_reset = reset.clone();
        let failed = Arc::new(AtomicBool::new(false));
        let fail = failed.clone();
        let error = move |_| {
            fail.store(true, Ordering::Relaxed);
        };
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    callback_reset.apply(&mut consumer);
                    for frame in data.chunks_mut(channels) {
                        let sample = consumer.try_pop().unwrap_or(0.0);
                        frame.fill(sample);
                    }
                },
                error,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    callback_reset.apply(&mut consumer);
                    for frame in data.chunks_mut(channels) {
                        let sample = consumer.try_pop().unwrap_or(0.0);
                        frame.fill((sample * 32767.0) as i16);
                    }
                },
                error,
                None,
            ),
            _ => return Err("Unsupported audio output format.".into()),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self {
            id,
            name: name.into(),
            _stream: stream,
            producer,
            rate,
            failed,
            resampler: Resampler::default(),
            device_uid,
            input_lease: None,
            reset,
        })
    }
    fn activate_input(&mut self, path: PathBuf) -> Result<(), String> {
        if self.device_uid != virtual_microphone::UID {
            return Err("Select the app microphone for automatic switching.".into());
        }
        if self.input_lease.is_none() {
            self.input_lease =
                InputLease::activate(NativeInput, path, self.id.clone(), self.device_uid.clone())?;
        }
        Ok(())
    }
    fn close(mut self) -> Result<(), String> {
        drop(self._stream);
        if let Some(mut lease) = self.input_lease.take() {
            lease.restore()?;
        }
        Ok(())
    }
    fn clear(&mut self) -> Result<(), String> {
        let revision = self.reset.requested.fetch_add(1, Ordering::Release) + 1;
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        // The callback owns the consumer. Wait for its acknowledgement before accepting new PCM,
        // so an unmute cannot replay speech that was queued before the mute.
        while self.reset.applied.load(Ordering::Acquire) != revision {
            if self.failed.load(Ordering::Relaxed) || std::time::Instant::now() > deadline {
                return Err("The audio output did not clear. Restart the translation.".into());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        self.resampler = Resampler::default();
        Ok(())
    }
    fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.failed.load(Ordering::Relaxed) {
            return Err(if self.name == SYSTEM_OUTPUT {
                "The Mac audio output was disconnected. Restart the translation.".into()
            } else {
                "The virtual output was disconnected. Refresh, then restart the translation.".into()
            });
        }
        let samples = self.resampler.convert(bytes, self.rate);
        if samples.len() > self.producer.vacant_len() {
            return Err("The translation is too far behind. Stop, then restart the call.".into());
        }
        self.producer.push_slice(&samples);
        Ok(())
    }
}
// Close every matching route even when one restoration fails; preserve the first error.
fn close_routes(routes: &mut Vec<Route>, matches: impl Fn(&Route) -> bool) -> Result<(), String> {
    let mut result = Ok(());
    let mut index = 0;
    while index < routes.len() {
        if matches(&routes[index]) {
            let closed = routes.remove(index).close();
            if result.is_ok() {
                result = closed;
            }
        } else {
            index += 1;
        }
    }
    result
}
enum Command {
    Clear {
        id: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Configure(PathBuf),
    Activate {
        id: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Shutdown {
        reply: mpsc::Sender<Result<(), String>>,
    },
    Open {
        id: String,
        name: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Push {
        id: String,
        bytes: Vec<u8>,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Close {
        id: String,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Status {
        id: String,
        reply: mpsc::Sender<Result<RouteStatus, String>>,
    },
}
pub struct AudioRoute {
    sender: mpsc::SyncSender<Command>,
}
impl Default for AudioRoute {
    fn default() -> Self {
        let (sender, receiver) = mpsc::sync_channel(32);
        // CPAL streams stay on their owner thread. The audio callback only accesses a lock-free ring.
        // One route per device: the user's microphone into BlackHole and the call's translation on the Mac.
        std::thread::spawn(move || {
            let mut routes: Vec<Route> = Vec::new();
            let mut journal: Option<PathBuf> = None;
            for command in receiver {
                match command {
                    Command::Clear { id, reply } => {
                        let result = routes
                            .iter_mut()
                            .find(|r| r.id == id)
                            .ok_or("The audio output is stopped.".into())
                            .and_then(Route::clear);
                        let _ = reply.send(result);
                    }
                    Command::Configure(path) => {
                        if crate::system_microphone::recover(&NativeInput, &path).is_err() {
                            eprintln!(
                                "Microphone recovery will be retried before automatic switching."
                            );
                        }
                        journal = Some(path);
                    }
                    Command::Activate { id, reply } => {
                        let result = routes
                            .iter_mut()
                            .find(|r| r.id == id)
                            .ok_or("The translation is stopped.".into())
                            .and_then(|r| {
                                r.activate_input(
                                    journal
                                        .clone()
                                        .ok_or("Microphone restore is not configured.")?,
                                )
                            });
                        let _ = reply.send(result);
                    }
                    Command::Shutdown { reply } => {
                        let result = close_routes(&mut routes, |_| true);
                        let _ = reply.send(result);
                        break;
                    }
                    Command::Open { id, name, reply } => {
                        let result = close_routes(&mut routes, |r| r.id == id || r.name == name)
                            .and_then(|()| {
                                if routes.len() >= 2 {
                                    return Err("Too many audio outputs are open.".into());
                                }
                                Route::new(id, &name).map(|route| routes.push(route))
                            });
                        let _ = reply.send(result);
                    }
                    Command::Push { id, bytes, reply } => {
                        let result = routes
                            .iter_mut()
                            .find(|r| r.id == id)
                            .ok_or("The audio output is stopped.".into())
                            .and_then(|r| r.push(&bytes));
                        let _ = reply.send(result);
                    }
                    Command::Close { id, reply } => {
                        let result = close_routes(&mut routes, |r| r.id == id);
                        let _ = reply.send(result);
                    }
                    Command::Status { id, reply } => {
                        let result = routes
                            .iter()
                            .find(|r| r.id == id)
                            .map(|r| RouteStatus {
                                pending_seconds: r.producer.occupied_len() as f64 / r.rate as f64,
                                failed: r.failed.load(Ordering::Relaxed),
                            })
                            .ok_or("The audio output is stopped.".into());
                        let _ = reply.send(result);
                    }
                }
            }
        });
        Self { sender }
    }
}
impl AudioRoute {
    pub fn configure(&self, journal: PathBuf) -> Result<(), String> {
        self.sender
            .try_send(Command::Configure(journal))
            .map_err(|e| e.to_string())
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        request(self.sender.clone(), |reply| Command::Shutdown { reply }).await
    }
}
#[tauri::command]
pub async fn audio_route_clear(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    request(state.sender.clone(), move |reply| Command::Clear {
        id,
        reply,
    })
    .await
}
#[tauri::command]
pub async fn audio_route_activate(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    request(state.sender.clone(), move |reply| Command::Activate {
        id,
        reply,
    })
    .await
}
fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("This audio action is reserved for the main window.".into())
    }
}
async fn request<T: Send + 'static>(
    sender: mpsc::SyncSender<Command>,
    make: impl FnOnce(mpsc::Sender<Result<T, String>>) -> Command + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (reply, receiver) = mpsc::channel();
        sender
            .try_send(make(reply))
            .map_err(|_| "The audio output is busy. Stop, then try again.".to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "The audio output is not responding.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn audio_outputs(window: tauri::WebviewWindow) -> Result<Vec<OutputDevice>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(|| devices(true))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn audio_route_open(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
    name: String,
) -> Result<(), String> {
    authorize(&window)?;
    request(state.sender.clone(), move |reply| Command::Open {
        id,
        name,
        reply,
    })
    .await
}
#[tauri::command]
pub async fn audio_route_push(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
    audio: String,
) -> Result<(), String> {
    authorize(&window)?;
    if audio.len() > 256_000 {
        return Err("Audio packet too large.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|e| e.to_string())?;
    if bytes.len() % 2 != 0 {
        return Err("Incomplete PCM packet.".into());
    }
    request(state.sender.clone(), move |reply| Command::Push {
        id,
        bytes,
        reply,
    })
    .await
}
#[tauri::command]
pub async fn audio_route_close(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    request(state.sender.clone(), move |reply| Command::Close {
        id,
        reply,
    })
    .await
}
#[tauri::command]
pub async fn audio_route_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AudioRoute>,
    id: String,
) -> Result<RouteStatus, String> {
    authorize(&window)?;
    request(state.sender.clone(), move |reply| Command::Status {
        id,
        reply,
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn playback_reset_discards_old_samples_before_acknowledging_resume() {
        let (mut producer, mut consumer) = HeapRb::<f32>::new(16).split();
        let reset = PlaybackReset::default();
        producer.push_slice(&[0.2, 0.3]);
        reset.requested.store(1, Ordering::Release);
        reset.apply(&mut consumer);
        assert_eq!(reset.applied.load(Ordering::Acquire), 1);
        assert!(consumer.try_pop().is_none());
        producer.push_slice(&[0.7]);
        reset.apply(&mut consumer);
        assert_eq!(consumer.try_pop(), Some(0.7));
    }
    #[test]
    fn resampling_is_packet_invariant() {
        let bytes: Vec<u8> = (0..2400_i16).flat_map(i16::to_le_bytes).collect();
        for rate in [24000, 44100, 48000] {
            let all = Resampler::default().convert(&bytes, rate);
            let mut split = Resampler::default();
            let parts: Vec<f32> = bytes
                .chunks(254)
                .flat_map(|p| split.convert(p, rate))
                .collect();
            assert_eq!(all, parts);
            assert!((all.len() as f64 - 2399.0 * rate as f64 / 24000.0).abs() < 2.0);
        }
    }
    #[test]
    fn output_is_restricted_to_loopback() {
        let outputs = devices(false).expect("read-only device enumeration");
        assert!(outputs.iter().all(
            |output| output.uid == virtual_microphone::UID || output.uid == "BlackHole2ch_UID"
        ));
    }
    #[test]
    fn enumerate_real_devices() {
        assert!(devices(false).is_ok());
        assert!(physical_inputs().is_ok());
    }
    #[test]
    #[ignore = "requires installed BlackHole; silent virtual-only setup validation"]
    fn branded_microphone_silent_io() {
        use crate::system_microphone::InputDevice;
        use std::sync::atomic::AtomicUsize;
        let input_before = NativeInput.current().expect("read original system input");
        #[cfg(target_os = "macos")]
        fn output_defaults() -> [u32; 2] {
            unsafe extern "C" {
                fn interprete_default_outputs(output: *mut u32, system: *mut u32) -> i32;
            }
            let mut output = 0;
            let mut system = 0;
            // Read only: live output references are valid for this synchronous call.
            assert_eq!(
                unsafe { interprete_default_outputs(&mut output, &mut system) },
                0
            );
            [output, system]
        }
        #[cfg(target_os = "macos")]
        let outputs_before = output_defaults();

        let expected = devices(true)
            .expect("create branded virtual microphone")
            .into_iter()
            .find(|device| device.app_mic)
            .expect("BlackHole 2ch must be installed");
        assert_eq!(expected.name, virtual_microphone::NAME);
        let device = cpal::default_host()
            .devices()
            .expect("devices")
            .find(|device| device.name().is_ok_and(|name| name == expected.name))
            .expect("branded input exists");
        let supported = device.default_input_config().expect("branded input format");
        let config = supported.config();
        assert_eq!(config.channels, 2);
        let frames = Arc::new(AtomicUsize::new(0));
        let received = frames.clone();
        // Count frames only; never retain or inspect anyone's audio samples.
        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _| {
                    received.fetch_add(data.len() / 2, Ordering::Relaxed);
                },
                |error| eprintln!("Virtual input error: {error}"),
                None,
            )
            .expect("open branded input");
        stream.play().expect("start branded input");
        let mut route =
            Route::new("silent-setup-test".into(), &expected.name).expect("open app output");
        route
            .push(&vec![0; 48000])
            .expect("enqueue digital silence");
        std::thread::sleep(Duration::from_millis(350));
        route
            .clear()
            .expect("clear queued silence without closing the route");
        assert_eq!(route.producer.occupied_len(), 0);
        route.close().expect("close app output");
        drop(stream);
        assert!(
            frames.load(Ordering::Relaxed) > 0,
            "branded input delivered no frames"
        );
        assert!(
            NativeInput
                .current()
                .is_ok_and(|current| current == input_before),
            "system input was changed"
        );
        #[cfg(target_os = "macos")]
        assert_eq!(outputs_before, output_defaults(), "system outputs changed");
        println!(
            "App-named virtual microphone: input/output open and frames delivered; only digital silence sent; system input unchanged."
        );
    }
    #[test]
    #[ignore = "requires BlackHole 2ch installed; run pnpm test:virtual-mic"]
    fn virtual_microphone_loopback() {
        use crate::system_microphone::InputDevice;
        let original_input = NativeInput.current().expect("read original system input");
        #[cfg(target_os = "macos")]
        fn output_defaults() -> [u32; 2] {
            unsafe extern "C" {
                fn interprete_default_outputs(output: *mut u32, system_output: *mut u32) -> i32;
            }
            let mut output = 0;
            let mut system = 0;
            // The bridge writes two UInt32 device IDs into these live references.
            assert_eq!(
                unsafe { interprete_default_outputs(&mut output, &mut system) },
                0
            );
            [output, system]
        }
        #[cfg(target_os = "macos")]
        let original_outputs = output_defaults();
        let expected = devices(true)
            .expect("prepare app microphone")
            .into_iter()
            .find(|device| device.app_mic)
            .expect("Install BlackHole 2ch and refresh the app microphone");
        let device = cpal::default_host()
            .devices()
            .expect("CoreAudio devices")
            .find(|d| d.name().is_ok_and(|name| name == expected.name))
            .expect("Install BlackHole 2ch, restart this app, then rerun pnpm test:virtual-mic");
        let supported = device
            .default_input_config()
            .expect("BlackHole input format");
        let config = supported.config();
        let channels = config.channels as usize;
        let rate = config.sample_rate.0 as f64;
        let recorded = Arc::new(std::sync::Mutex::new(Vec::<f32>::new()));
        let samples = recorded.clone();
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    if let Ok(mut out) = samples.lock()
                        && out.len() < 192000
                    {
                        out.extend(data.chunks(channels).map(|frame| frame[0]));
                    }
                },
                |error| eprintln!("Input error: {error}"),
                None,
            ),
            _ => panic!("BlackHole's test input must support Float32"),
        }
        .expect("Open the BlackHole receiving microphone");
        stream
            .play()
            .expect("Start receiving the virtual microphone");
        let mut route =
            Route::new("loopback-test".into(), &expected.name).expect("Open native output route");
        let tone: Vec<u8> = (0..48000)
            .flat_map(|index| {
                let sample = ((index as f64 * std::f64::consts::TAU * 997.0 / 24000.0).sin()
                    * 6553.0) as i16;
                sample.to_le_bytes()
            })
            .collect();
        route
            .push(&tone)
            .expect("Write two seconds of synthetic PCM");
        std::thread::sleep(Duration::from_secs(3));
        drop(stream);
        let samples = recorded.lock().expect("Recorded signal");
        assert!(
            !samples.is_empty(),
            "The receiving virtual microphone delivered no frames"
        );
        let (mut sine, mut cosine) = (0.0, 0.0);
        for (index, sample) in samples.iter().enumerate() {
            let phase = index as f64 * std::f64::consts::TAU * 997.0 / rate;
            sine += *sample as f64 * phase.sin();
            cosine += *sample as f64 * phase.cos();
        }
        let amplitude = 2.0 * sine.hypot(cosine) / samples.len() as f64;
        assert!(
            amplitude > 0.03,
            "The receiving microphone did not receive the synthetic 997 Hz signal (amplitude {amplitude})"
        );
        assert!(
            NativeInput
                .current()
                .is_ok_and(|input| input == original_input),
            "system input changed during virtual-only test"
        );
        #[cfg(target_os = "macos")]
        assert_eq!(
            output_defaults(),
            original_outputs,
            "system outputs changed during virtual-only test"
        );
        println!("System input and output defaults remained unchanged.");
        println!(
            "App output → branded receiving microphone verified: {} frames, 997 Hz amplitude {:.3}",
            samples.len(),
            amplitude
        );
    }
}
