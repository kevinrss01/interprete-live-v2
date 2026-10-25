import WebSocket from "ws";
import { credential, MODELS } from "./config";
import { AppError } from "./errors";
export async function speechSocket(
  voiceId: string,
  language: string,
  signal: AbortSignal,
  onAudio: (data: string) => void,
  speed = 1,
) {
  signal.throwIfAborted();
  const query = new URLSearchParams({
    model_id: MODELS.speech,
    output_format: "pcm_24000",
    language_code: language,
    inactivity_timeout: "30",
  });
  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?${query}`,
    {
      headers: { "xi-api-key": credential("eleven") },
      handshakeTimeout: 10000,
    },
  );
  let rejectDone: (e: Error) => void = () => {},
    resolveDone: () => void = () => {},
    settled = false,
    closing = false;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});
  const abort = () => {
    ws.terminate();
    rejectDone(new AppError("ABORTED", "Playback was stopped.", 499));
  };
  signal.addEventListener("abort", abort, { once: true });
  ws.on("message", (raw) => {
    try {
      const e = JSON.parse(raw.toString());
      if (e.error || e.detail) {
        rejectDone(
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
      rejectDone(new Error("VOICE_STREAM"));
    }
  });
  ws.on("error", () =>
    rejectDone(
      new AppError(
        "VOICE_NETWORK",
        "The connection to ElevenLabs was interrupted.",
        502,
      ),
    ),
  );
  ws.on("close", () => {
    if (!settled && !signal.aborted)
      rejectDone(
        new AppError(
          "VOICE_CLOSED",
          "Speech synthesis was interrupted. Try again.",
          502,
        ),
      );
  });
  await new Promise<void>((resolve, reject) => {
    const onError = () =>
      reject(
        new AppError("VOICE_NETWORK", "Can’t reach ElevenLabs.", 502),
      );
    ws.once("error", onError);
    ws.once("open", () => {
      ws.removeListener("error", onError);
      resolve();
    });
  });
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
      ws.send(JSON.stringify({ text: "" }));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
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
              20000,
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
