import { useEffect, useRef, useState } from "react";
import { MicrophoneCapture } from "../lib/audio";
import { savedMicrophone } from "../lib/call-preferences";
import { ContinuousTranscription } from "../lib/transcription";

export type OnboardingSample = { blob: Blob; seconds: number };
type Session = {
  abort: AbortController;
  capture: MicrophoneCapture;
  samples: OnboardingSample[];
};
const BARS = 14;

// Microphone + live transcription for the voice sample. The capture keeps only
// clean speech for cloning; the transcription only drives the reading guide.
export function useOnboardingRecording(language: string) {
  const [status, setStatus] = useState<"idle" | "starting" | "recording">("idle");
  const [heard, setHeard] = useState("");
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [seconds, setSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  function reset() {
    const s = session.current;
    session.current = null;
    s?.abort.abort();
    void s?.capture.stop();
    setStatus("idle");
    setHeard("");
    setLevels(Array(BARS).fill(0));
    setSeconds(0);
    setWarning(null);
  }

  async function start() {
    reset();
    setError(null);
    const abort = new AbortController();
    const live = () => !abort.signal.aborted;
    const items = new Map<string, { sequence: number; text: string }>();
    const transcriber = new ContinuousTranscription({
      language,
      initialId: crypto.randomUUID(),
      signal: abort.signal,
      onTranscript: (item) => {
        if (!live()) return;
        items.set(item.id, item);
        setHeard(
          [...items.values()]
            .sort((a, b) => a.sequence - b.sequence)
            .map((i) => i.text)
            .join(" "),
        );
      },
      onConnection: () => {},
      onWarning: () => {},
    });
    const s: Session = {
      abort,
      samples: [],
      capture: new MicrophoneCapture({
        onAudio: (bytes) => live() && transcriber.append(bytes),
        onLevel: (level) => live() && setLevels((l) => [...l.slice(1), level]),
        onBoundary: () => live() && transcriber.checkpoint(),
        onEnded: () => {},
        onError: (message) => {
          if (!live()) return;
          reset();
          setError(message);
        },
        recordSample: true,
        preferredDeviceId: savedMicrophone(),
        onSample: (sample) => {
          if (!live()) return;
          s.samples.push(sample);
          setSeconds((n) => n + sample.seconds);
        },
      }),
    };
    session.current = s;
    setStatus("starting");
    // The guide is optional: without transcription, the person reads and presses stop.
    transcriber.start().catch(() => {
      if (live())
        setWarning("Live guide unavailable. Read the text, then press stop.");
    });
    try {
      await s.capture.start();
      if (!live()) return;
      setStartedAt(performance.now());
      setStatus("recording");
    } catch (e) {
      if (!live()) return;
      reset();
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in System Settings, then try again."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No microphone was found on this device."
            : "The microphone could not start. Try again.",
      );
    }
  }

  // Returns every clean-speech sample, including the part not yet flushed.
  async function stop() {
    const s = session.current;
    if (!s) return [];
    session.current = null;
    const last = await s.capture.stop();
    s.abort.abort();
    if (last && last.seconds >= 1) s.samples.push(last);
    setStatus("idle");
    return s.samples;
  }

  useEffect(() => () => {
    session.current?.abort.abort();
    void session.current?.capture.stop();
  }, []);

  return { status, heard, levels, seconds, startedAt, error, warning, start, stop, reset, setError };
}
