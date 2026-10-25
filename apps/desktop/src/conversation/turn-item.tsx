import type { RefObject } from "react";
import { LoaderCircle, Play } from "lucide-react";
import type { Turn } from "@interprete/shared/contracts";
import { languageName } from "@interprete/shared/languages";
import { LiveText } from "../components/live-text";
import type { DiscussionMessage } from "../lib/discussion";
import { formatClock } from "../lib/discussion-display";

function firstAudioLabel(ms: number) {
  const seconds = (ms / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `First audio at ${seconds} s`;
}

export function TurnItem({
  message,
  current,
  onPlay,
  busy,
  tail,
}: {
  message: DiscussionMessage;
  current?: Turn;
  onPlay?: (id: string) => void;
  busy: boolean;
  tail?: RefObject<HTMLLIElement | null>;
}) {
  const speaker = message.role === "you" ? "a" : "b";
  const source = current?.source ?? message.source;
  const translation = current?.translation ?? message.translation;
  const status = current?.status ?? message.status;
  const revealing = !!current && (status === "draft" || status === "working");
  const error = current?.error ?? message.error;
  const demo = current?.demo ?? message.demo;
  const firstAudio = current?.metrics.firstAudioMs ?? current?.metrics.playbackMs;
  const showActions =
    status === "done" &&
    (current?.audioUrl ||
      current?.metrics.firstAudioMs !== undefined ||
      current?.metrics.playbackMs !== undefined);
  return (
    <li
      className="turn"
      data-speaker={speaker}
      data-speaking={status === "draft" ? "true" : undefined}
      ref={tail}
    >
      <div className="bubble">
        <p className="turn-meta">
          <span className="turn-name">{message.name}</span>
          <span className="turn-meta-aside">
            <time dateTime={new Date(message.at).toISOString()}>{formatClock(message.at)}</time>
            <span className="turn-lang">
              <span aria-hidden="true">
                {message.sourceLanguage.toUpperCase()} → {message.targetLanguage.toUpperCase()}
              </span>
              <span className="sr-only">
                {languageName(message.sourceLanguage)} to {languageName(message.targetLanguage)}
              </span>
            </span>
            {demo && <span className="tag">Sample</span>}
          </span>
        </p>
        {(source || status === "draft") && (
          <p className="turn-source">
            {source ? (
              <LiveText text={source} language={message.sourceLanguage} live={revealing} />
            ) : (
              <span className="pending">Listening…</span>
            )}
          </p>
        )}
        {(translation || (source && status !== "error")) && (
          <p className="turn-translation">
            {translation ? (
              <LiveText text={translation} language={message.targetLanguage} live={revealing} />
            ) : (
              <span className="pending">Translating…</span>
            )}
            {status === "working" && <LoaderCircle size={15} className="spin" aria-label="Translating" />}
          </p>
        )}
        {status === "error" && <p className="turn-error">{error}</p>}
      </div>
      {showActions && (
        <div className="turn-actions">
          {current?.audioUrl && onPlay && (
            <button
              type="button"
              className="btn-inline"
              disabled={busy}
              onClick={() => onPlay(message.id)}
            >
              <Play size={12} fill="currentColor" aria-hidden="true" />
              Replay
            </button>
          )}
          {firstAudio !== undefined && <span className="tabular">{firstAudioLabel(firstAudio)}</span>}
        </div>
      )}
    </li>
  );
}
