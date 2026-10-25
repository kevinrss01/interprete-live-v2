import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { captionAppearance, loadCaptionPreferences, saveCaptionPreferences, useCaptionPreferences, type CaptionPreferences } from "../lib/caption-preferences";
import {
  emptyCaptionText,
  getCaptions,
  getCaptionPosition,
  nextCaptionText,
  newestCaptions,
  onCaptions,
  type CaptionLine,
  type CaptionsSnapshot,
  type CaptionsUpdate,
} from "../lib/call-captions";

// Each newly translated fragment fades in; text already on screen never re-animates.
function CaptionText({ text }: { text: string }) {
  const state = useRef(emptyCaptionText);
  // Idempotent for an unchanged text, so a repeated render cannot add a fragment twice.
  state.current = nextCaptionText(state.current, text);
  const { version, settled, fresh } = state.current;
  return (
    <>
      {settled && <span key={`settled-${version}`}>{settled}</span>}
      {fresh.map((part) => (
        <span key={`fresh-${part.key}`} className="caption-fresh">
          {part.text}
        </span>
      ))}
    </>
  );
}
function Caption({ line, latest, language }: { line: CaptionLine; latest: boolean; language: string }) {
  return (
    <p className="caption-line" data-latest={latest} data-live={line.live} lang={language} dir="auto">
      <CaptionText text={line.text} />
    </p>
  );
}

const HIDE_AFTER_MS = 8000;
const READY_FOR_MS = 3500;
export function CaptionsView({ captions, preferences, onHidden }: { captions: CaptionsUpdate; preferences?: CaptionPreferences; onHidden?: (hidden: boolean) => void }) {
  const savedPreferences = useCaptionPreferences();
  const appearance = preferences ?? savedPreferences;
  const [quiet, setQuiet] = useState(false);
  const [intro, setIntro] = useState(true);
  const live = captions.lines.some((line) => line.live);
  const signature = captions.lines.map((line) => line.text).join("\n");
  // Captions stay while someone speaks, then fade so the call stays unobstructed.
  useEffect(() => {
    setQuiet(false);
    if (live || captions.status === "preview") return;
    const timer = setTimeout(() => setQuiet(true), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [signature, live, captions.status]);
  useEffect(() => {
    setIntro(true);
    const timer = setTimeout(() => setIntro(false), READY_FOR_MS);
    return () => clearTimeout(timer);
  }, [captions.sessionId]);
  const waiting = !captions.lines.length;
  const hidden = waiting ? !intro && captions.status !== "starting" : quiet;
  useEffect(() => onHidden?.(hidden), [hidden, onHidden]);
  if (!captions.sessionId || captions.status === "idle") return null;
  return (
    <div
      className="captions"
      data-hidden={hidden}
      role="region"
      aria-label="Call captions"
      data-theme={appearance.theme}
      style={captionAppearance(appearance)}
    >
      <div className="captions-meta" aria-hidden="true">
        <span className="captions-dot" data-live={live} />
        {onHidden && <span className="caption-drag-hint"><GripHorizontal size={14} />Drag to move</span>}
      </div>
      <div className="captions-lines" aria-live="polite">
        {waiting ? (
          <p className="caption-line caption-waiting">
            {captions.status === "starting"
              ? "Connecting to the call audio…"
              : "Captions ready. They will appear as soon as someone speaks."}
          </p>
        ) : (
          captions.lines.map((line, index) => (
            <Caption
              key={line.id}
              line={line}
              latest={index === captions.lines.length - 1}
              language={captions.target}
            />
          ))
        )}
      </div>
    </div>
  );
}

// The main window owns content; this window owns native dragging and saves its placement.
export function CallCaptions() {
  const [snapshot, setSnapshot] = useState<CaptionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showError = useCallback((error: unknown) => setError(String(error)), []);
  const onHidden = useCallback((hidden: boolean) => {
    void getCurrentWindow().setIgnoreCursorEvents(hidden).catch(showError);
  }, [showError]);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const moved = getCurrentWindow().onMoved(() => {
      clearTimeout(timer);
      // Save once the window settles; programmatic placement round-trips to the same layout.
      timer = setTimeout(() => {
        const before = loadCaptionPreferences();
        void getCaptionPosition(before).then((layout) => {
          if (!mounted || !layout) return;
          const current = loadCaptionPreferences();
          // A newer settings change wins over a position query already in flight.
          if (current.x !== before.x || current.y !== before.y || current.size !== before.size || current.monitor !== before.monitor) return;
          if (current.x === layout.x && current.y === layout.y && current.monitor === layout.monitor) return;
          saveCaptionPreferences({ ...current, x: layout.x, y: layout.y, monitor: layout.monitor });
        }).catch(showError);
      }, 150);
    });
    void moved.catch(showError);
    return () => {
      mounted = false;
      clearTimeout(timer);
      void moved.then((off) => off(), () => {});
    };
  }, [showError]);
  useEffect(() => {
    document.documentElement.classList.add("call-captions-window");
    document.body.classList.add("call-captions-window");
    let mounted = true;
    const accept = (incoming: CaptionsSnapshot) => {
      if (mounted) setSnapshot((current) => newestCaptions(current, incoming));
    };
    const subscription = onCaptions(accept);
    void subscription
      .then(() => getCaptions())
      .then(accept)
      .catch(() => {});
    return () => {
      mounted = false;
      void subscription.then(
        (off) => off(),
        () => {},
      );
    };
  }, []);
  return snapshot ? (
    <div className="caption-draggable" onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      setError(null);
      void getCurrentWindow().startDragging().catch(showError);
    }}>
      <CaptionsView captions={snapshot} onHidden={onHidden} />
      {error && <p className="caption-window-error" role="alert">{error}</p>}
    </div>
  ) : null;
}
