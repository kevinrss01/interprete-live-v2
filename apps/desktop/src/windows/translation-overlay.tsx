import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, Square } from "lucide-react";
import {
  getOverlay,
  newestOverlay,
  onOverlay,
  stopOverlay,
  type OverlaySnapshot,
  type OverlayUpdate,
} from "../lib/translation-overlay";

export function TranslationPill({
  session,
  stopping = false,
  onStop,
  error,
}: {
  session: OverlayUpdate;
  stopping?: boolean;
  onStop: () => void;
  error?: string | null;
}) {
  const preview = session.phase === "preview";
  const connecting = session.phase === "connecting";
  const label = stopping
    ? "Stopping…"
    : preview
      ? "Preview"
      : connecting
        ? "Connecting…"
        : session.test
          ? "Testing"
          : "Translation on";
  return (
    <div
      className="translation-pill"
      role="region"
      aria-label="Live translation"
    >
      <div className="translation-pill-status" role="status" aria-live="polite">
        {connecting || stopping ? (
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
        ) : (
          <span className="translation-pill-dot" aria-hidden="true" />
        )}
        <span>
          <strong>{label}</strong>
          <span className="translation-pill-languages">
            {session.source.toUpperCase()}
            <ArrowRight size={11} aria-hidden="true" />
            {session.target.toUpperCase()}
          </span>
        </span>
      </div>
      <button
        className="translation-pill-stop"
        type="button"
        onClick={onStop}
        disabled={stopping}
        aria-label={
          preview
            ? "Close the pill preview"
            : "Stop live translation"
        }
        title={error || (preview ? "Close preview" : "Stop translation")}
      >
        <Square size={13} fill="currentColor" aria-hidden="true" />
      </button>
      {error && (
        <span className="sr-only" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function TranslationOverlay() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.classList.add("translation-overlay-window");
    document.body.classList.add("translation-overlay-window");
    let mounted = true;
    const accept = (incoming: OverlaySnapshot) => {
      if (mounted) setSnapshot((current) => newestOverlay(current, incoming));
    };
    const subscription = onOverlay(accept);
    void subscription
      .then(() => getOverlay())
      .then(accept)
      .catch((error: unknown) => {
        if (mounted) setError(String(error));
      });
    return () => {
      mounted = false;
      void subscription.then(
        (off) => off(),
        () => {},
      );
    };
  }, []);
  async function stop() {
    if (!snapshot?.sessionId || pending) return;
    setPending(true);
    setError(null);
    try {
      const stopped = await stopOverlay(snapshot.sessionId);
      setSnapshot((current) => newestOverlay(current, stopped));
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }
  if (!snapshot?.sessionId || snapshot.phase === "idle") return null;
  return (
    <TranslationPill
      session={snapshot}
      stopping={pending || snapshot.stopRequested}
      onStop={() => void stop()}
      error={error}
    />
  );
}
