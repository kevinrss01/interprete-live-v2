import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  emptyCaptionText,
  getCaptions,
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
function Caption({ line, latest }: { line: CaptionLine; latest: boolean }) {
  return (
    <p className="caption-line" data-latest={latest} data-live={line.live}>
      <CaptionText text={line.text} />
    </p>
  );
}

const HIDE_AFTER_MS = 8000;
const READY_FOR_MS = 3500;
export function CaptionsView({ captions }: { captions: CaptionsUpdate }) {
  const [quiet, setQuiet] = useState(false);
  const [intro, setIntro] = useState(true);
  const live = captions.lines.some((line) => line.live);
  const signature = captions.lines.map((line) => line.text).join("\n");
  // Captions stay while someone speaks, then fade so the call stays unobstructed.
  useEffect(() => {
    setQuiet(false);
    if (live) return;
    const timer = setTimeout(() => setQuiet(true), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [signature, live]);
  useEffect(() => {
    setIntro(true);
    const timer = setTimeout(() => setIntro(false), READY_FOR_MS);
    return () => clearTimeout(timer);
  }, [captions.sessionId]);
  if (!captions.sessionId || captions.status === "idle") return null;
  const waiting = !captions.lines.length;
  const hidden = waiting ? !intro && captions.status !== "starting" : quiet;
  return (
    <div
      className="captions"
      data-hidden={hidden}
      role="region"
      aria-label="Call captions"
    >
      <div className="captions-meta" aria-hidden="true">
        <span className="captions-dot" data-live={live} />
        {captions.status === "preview" ? "Preview · " : ""}
        {captions.source.toUpperCase()}
        <ArrowRight size={11} />
        {captions.target.toUpperCase()}
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
            />
          ))
        )}
      </div>
    </div>
  );
}

// Native, click-through window at the bottom of the screen; the main window publishes its state.
export function CallCaptions() {
  const [snapshot, setSnapshot] = useState<CaptionsSnapshot | null>(null);
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
  return snapshot ? <CaptionsView captions={snapshot} /> : null;
}
