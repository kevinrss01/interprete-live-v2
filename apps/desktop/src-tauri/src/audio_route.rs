use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{
    HeapProd, HeapRb,
    traits::{Consumer, Observer, Producer, Split},
};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub name: String,
    pub virtual_mic: bool,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStatus {
    pub pending_seconds: f64,
    pub failed: bool,
}
fn is_virtual(name: &str) -> bool {
    name.to_lowercase().contains("blackhole")
}
// A participant's translated voice plays on the Mac's current output. Only this explicit
// name opens speakers: a missing BlackHole can never fall back to them.
pub const SYSTEM_OUTPUT: &str = "@system-output";
fn output_device(name: &str) -> Result<cpal::Device, String> {
    if name == SYSTEM_OUTPUT {
        return cpal::default_host()
            .default_output_device()
            .ok_or_else(|| "Aucune sortie audio n’est disponible sur ce Mac.".into());
    }
    if !is_virtual(name) {
        return Err("Choisissez BlackHole comme sortie virtuelle.".into());
    }
    cpal::default_host()
        .devices()
        .map_err(|e| e.to_string())?
        .find(|d| d.name().is_ok_and(|n| n == name))
        .ok_or_else(|| {
            "BlackHole est absent. Installez le pilote puis actualisez les périphériques.".into()
        })
}
fn devices() -> Result<Vec<OutputDevice>, String> {
    cpal::default_host()
        .devices()
        .map_err(|e| e.to_string())?
        .map(|d| {
            d.name()
                .map(|name| OutputDevice {
                    virtual_mic: is_virtual(&name),
                    name,
                })
                .map_err(|e| e.to_string())
        })
        .filter(|result| result.as_ref().is_ok_and(|device| device.virtual_mic))
        .collect()
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
            return Err("Impossible de vérifier les microphones physiques.".into());
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
}
impl Route {
    fn new(id: String, name: &str) -> Result<Self, String> {
        let device = output_device(name)?;
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        let mut config = supported.config();
        // Ask for a small native callback where supported. CoreAudio chooses its hardware period.
        if let cpal::SupportedBufferSize::Range { min, max } = supported.buffer_size() {
            config.buffer_size = cpal::BufferSize::Fixed(128_u32.clamp(*min, *max));
        }
        let rate = config.sample_rate.0;
        let channels = config.channels as usize;
        let (producer, mut consumer) = HeapRb::<f32>::new(rate as usize * 8).split();
        let failed = Arc::new(AtomicBool::new(false));
        let fail = failed.clone();
        let error = move |_| {
            fail.store(true, Ordering::Relaxed);
        };
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], _| {
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
                    for frame in data.chunks_mut(channels) {
                        let sample = consumer.try_pop().unwrap_or(0.0);
                        frame.fill((sample * 32767.0) as i16);
                    }
                },
                error,
                None,
            ),
            _ => return Err("Format de sortie audio non pris en charge.".into()),
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
        })
    }
    fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.failed.load(Ordering::Relaxed) {
            return Err(if self.name == SYSTEM_OUTPUT {
                "La sortie audio du Mac a été déconnectée. Relancez la traduction.".into()
            } else {
                "La sortie virtuelle a été déconnectée. Arrêtez puis reconnectez BlackHole.".into()
            });
        }
        let samples = self.resampler.convert(bytes, self.rate);
        if samples.len() > self.producer.vacant_len() {
            return Err("La traduction a trop de retard. Arrêtez puis relancez l’appel.".into());
        }
        self.producer.push_slice(&samples);
        Ok(())
    }
}
enum Command {
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
            for command in receiver {
                match command {
                    Command::Open { id, name, reply } => {
                        routes.retain(|r| r.id != id && r.name != name);
                        let result = if routes.len() >= 2 {
                            Err("Trop de sorties audio sont ouvertes.".into())
                        } else {
                            Route::new(id, &name).map(|r| routes.push(r))
                        };
                        let _ = reply.send(result);
                    }
                    Command::Push { id, bytes, reply } => {
                        let result = routes
                            .iter_mut()
                            .find(|r| r.id == id)
                            .ok_or("La sortie audio est arrêtée.".into())
                            .and_then(|r| r.push(&bytes));
                        let _ = reply.send(result);
                    }
                    Command::Close { id, reply } => {
                        routes.retain(|r| r.id != id);
                        let _ = reply.send(Ok(()));
                    }
                    Command::Status { id, reply } => {
                        let result = routes
                            .iter()
                            .find(|r| r.id == id)
                            .map(|r| RouteStatus {
                                pending_seconds: r.producer.occupied_len() as f64 / r.rate as f64,
                                failed: r.failed.load(Ordering::Relaxed),
                            })
                            .ok_or("La sortie audio est arrêtée.".into());
                        let _ = reply.send(result);
                    }
                }
            }
        });
        Self { sender }
    }
}
fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Action audio réservée à la fenêtre principale.".into())
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
            .map_err(|_| "La sortie audio est occupée. Arrêtez puis réessayez.".to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "La sortie audio ne répond plus.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn audio_outputs(window: tauri::WebviewWindow) -> Result<Vec<OutputDevice>, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(devices)
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
        return Err("Paquet audio trop volumineux.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|e| e.to_string())?;
    if bytes.len() % 2 != 0 {
        return Err("Paquet PCM incomplet.".into());
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
    fn output_is_restricted_to_loopback_or_explicit_speakers() {
        assert!(is_virtual("BlackHole 2ch"));
        assert!(!is_virtual("MacBook Pro Speakers"));
        assert!(output_device("MacBook Pro Speakers").is_err());
        assert!(!is_virtual(SYSTEM_OUTPUT));
    }
    #[test]
    fn enumerate_real_devices() {
        assert!(devices().is_ok());
        assert!(physical_inputs().is_ok());
    }
    #[test]
    #[ignore = "requires BlackHole 2ch installed; run pnpm test:virtual-mic"]
    fn virtual_microphone_loopback() {
        let device = cpal::default_host()
            .devices()
            .expect("CoreAudio devices")
            .find(|d| d.name().is_ok_and(|name| name == "BlackHole 2ch"))
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
            Route::new("loopback-test".into(), "BlackHole 2ch").expect("Open native output route");
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
        println!(
            "BlackHole output → receiving microphone verified: {} frames, 997 Hz amplitude {:.3}",
            samples.len(),
            amplitude
        );
    }
}
