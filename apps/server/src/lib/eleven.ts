import WebSocket, { type ClientOptions } from "ws";
import { credential, MODELS } from "./config";
import { AppError } from "./errors";
type SocketOptions = {
  connectTimeoutMs?: number;
  finishTimeoutMs?: number;
  connect?: (url: string, options: ClientOptions) => WebSocket;
};
export async function speechSocket(
  voiceId: string,
  language: string,
  signal: AbortSignal,
  onAudio: (data: string) => void,
  speed = 1,
  options: SocketOptions = {},
) {
  signal.throwIfAborted();
  const query = new URLSearchParams({
    model_id: MODELS.speech,
    output_format: "pcm_24000",
    language_code: language,
    inactivity_timeout: "30",
  });
  const ws = (options.connect ?? ((url, settings) => new WebSocket(url, settings)))(
    `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?${query}`,
    {
      headers: { "xi-api-key": credential("eleven") },
      handshakeTimeout: options.connectTimeoutMs ?? 8000,
    },
  );
  let rejectDone: (e: Error) => void = () => {},
    resolveDone: () => void = () => {},
    settled = false,
    closing = false;
  let failure: Error | null = null;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    failure = error;
    rejectDone(error);
  };
  const abort = () => {
    fail(new AppError("ABORTED", "Playback was stopped.", 499));
    ws.terminate();
  };
  signal.addEventListener("abort", abort, { once: true });
  ws.on("message", (raw) => {
    if (signal.aborted || settled) return;
    try {
      const e = JSON.parse(raw.toString());
      if (e.error || e.detail) {
        fail(
          new AppError(
            "VOICE_ERROR",
            "The voice could not be generated. Try again with a standard voice.",
            502,
          ),
        );
        ws.close();
        return;
      }
      if (e.audio) onAudio(e.audio);
      if (closing && (e.isFinal || e.is_final)) {
        settled = true;
        resolveDone();
      }
    } catch {
      fail(new AppError("VOICE_STREAM", "The voice stream was interrupted.", 502));
    }
  });
  ws.on("error", () =>
    fail(
      new AppError(
        "VOICE_NETWORK",
        "The connection to ElevenLabs was interrupted.",
        502,
      ),
    ),
  );
  ws.on("close", () => {
    if (!settled && !signal.aborted)
      fail(
        new AppError(
          "VOICE_CLOSED",
          "Speech synthesis was interrupted. Try again.",
          502,
        ),
      );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener("open", opened);
        ws.removeListener("error", stopped);
        ws.removeListener("close", stopped);
        signal.removeEventListener("abort", stopped);
      };
      const stopped = () => {
        cleanup();
        reject(failure ?? new AppError("VOICE_NETWORK", "Can’t reach ElevenLabs.", 502));
      };
      const opened = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => {
        fail(new AppError("VOICE_TIMEOUT", "The voice connection timed out.", 504));
        stopped();
      }, options.connectTimeoutMs ?? 8000);
      ws.once("error", stopped);
      ws.once("close", stopped);
      ws.once("open", opened);
      signal.addEventListener("abort", stopped, { once: true });
      if (signal.aborted) stopped();
    });
  } catch (error) {
    signal.removeEventListener("abort", abort);
    ws.terminate();
    throw error;
  }
  if (signal.aborted) {
    abort();
    throw signal.reason;
  }
  ws.send(
    JSON.stringify({
      text: " ",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        use_speaker_boost: false,
        speed,
      },
      generation_config: { chunk_length_schedule: [50, 80, 120, 160] },
    }),
  );
  return {
    send(text: string) {
      if (failure) throw failure;
      if (ws.readyState !== WebSocket.OPEN)
        throw new AppError(
          "VOICE_CLOSED",
          "The voice connection is closed.",
          502,
        );
      ws.send(JSON.stringify({ text, try_trigger_generation: true }));
    },
    async finish() {
      closing = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (failure) throw failure;
        ws.send(JSON.stringify({ text: "" }));
        await Promise.race([
          done,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new AppError(
                    "VOICE_TIMEOUT",
                    "The voice is taking too long to respond.",
                    504,
                  ),
                ),
              options.finishTimeoutMs ?? 10_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        ws.terminate();
      }
    },
    close() {
      signal.removeEventListener("abort", abort);
      ws.terminate();
    },
  };
}
