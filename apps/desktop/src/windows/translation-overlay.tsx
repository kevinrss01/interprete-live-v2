import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  LoaderCircle,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { languageName } from "@interprete/shared/languages";
import {
  getOverlay,
  newestOverlay,
  onOverlay,
  expandOverlayOptions,
  openOverlaySettings,
  stopOverlay,
  type OverlaySnapshot,
  type OverlayUpdate,
} from "../lib/translation-overlay";

export function TranslationPill({
  session,
  stopping = false,
  onStop,
  onOptions,
  opening = false,
  expanded = false,
  onExpand,
  error,
}: {
  session: OverlayUpdate;
  stopping?: boolean;
  onStop: () => void;
  onOptions: () => void;
  opening?: boolean;
  expanded?: boolean;
  onExpand: () => void;
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
        : session.phase === "paused"
          ? "Microphone paused"
        : session.test
          ? "Testing"
          : "Translation on";
  return (
    <div
      className="translation-pill"
      role="region"
      aria-label="Live translation"
    >
      <div className="translation-pill-content">
        <div className="translation-pill-status" role="status" aria-live="polite">
          {connecting || stopping ? (
            <LoaderCircle size={13} className="spin" aria-hidden="true" />
          ) : (
            <span className="translation-pill-dot" data-paused={session.phase === "paused"} aria-hidden="true" />
          )}
          <span>
            <strong>{label}</strong>
            <span className="translation-pill-languages">
              {languageName(session.source)}
              {session.bidirectional
                ? <ArrowLeftRight size={13} aria-label="to and from" />
                : <ArrowRight size={13} aria-label="to" />}
              {languageName(session.target)}
            </span>
          </span>
        </div>
        <button className="translation-pill-options" type="button" onClick={onExpand}
          aria-expanded={expanded} aria-label="Translation options">
          <SlidersHorizontal size={13} aria-hidden="true" />
          Options
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </div>
      <button
        className="translation-pill-stop"
        type="button"
        onClick={onStop}
        disabled={stopping}
        aria-label={preview ? "Close the pill preview" : "Stop live translation"}
        title={error || (preview ? "Close preview" : "Stop translation")}
      >
        <Square size={13} fill="currentColor" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="translation-pill-menu" role="group" aria-label="Translation options">
          <button type="button" onClick={onOptions} disabled={opening}>
            <SlidersHorizontal size={15} aria-hidden="true" />
            {opening ? "Opening…" : "All translation settings"}
          </button>
          <button type="button" onClick={onStop} disabled={stopping}>
            <Square size={13} aria-hidden="true" />
            {preview ? "Close preview" : stopping ? "Stopping…" : "Stop translation"}
          </button>
        </div>
      )}
      {error && (
        <span className="translation-pill-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function TranslationOverlay() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useRef(snapshot?.sessionId);
  currentSession.current = snapshot?.sessionId;
  useEffect(() => {
    setError(null);
    setPending(false);
    setOpening(false);
  }, [snapshot?.sessionId]);
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
    const requestedSession = snapshot.sessionId;
    setPending(true);
    setError(null);
    try {
      const stopped = await stopOverlay(requestedSession);
      setSnapshot((current) => newestOverlay(current, stopped));
    } catch (error) {
      if (currentSession.current === requestedSession) setError(String(error));
    } finally {
      if (currentSession.current === requestedSession) setPending(false);
    }
  }
  async function options() {
    if (!snapshot?.sessionId || opening) return;
    const requestedSession = snapshot.sessionId;
    setOpening(true);
    setError(null);
    try {
      await openOverlaySettings(requestedSession);
    } catch (error) {
      if (currentSession.current === requestedSession) setError(String(error));
    } finally {
      if (currentSession.current === requestedSession) setOpening(false);
    }
  }
  async function toggleOptions() {
    if (!snapshot?.sessionId) return;
    const requestedSession = snapshot.sessionId;
    setError(null);
    try {
      const next = await expandOverlayOptions(requestedSession, !snapshot.expanded);
      setSnapshot((current) => newestOverlay(current, next));
    } catch (error) {
      if (currentSession.current === requestedSession) setError(String(error));
    }
  }
  if (!snapshot?.sessionId || snapshot.phase === "idle") return null;
  return (
    <TranslationPill
      session={snapshot}
      stopping={pending || snapshot.stopRequested}
      onStop={() => void stop()}
      onOptions={() => void options()}
      onExpand={() => void toggleOptions()}
      expanded={snapshot.expanded}
      opening={opening}
      error={error}
    />
  );
}
