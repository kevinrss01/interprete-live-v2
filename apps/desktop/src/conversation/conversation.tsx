import { useEffect, useRef, type RefObject } from "react";
import { LoaderCircle, Play } from "lucide-react";
import type { Turn } from "@interprete/shared/contracts";
import { languageName } from "@interprete/shared/languages";
import type { DiscussionMessage } from "../lib/discussion";
import { readAuthToken } from "../lib/account";
import { LiveText } from "../components/live-text";
import { Button } from "@interprete/ui/components/button";

function TurnItem({
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
  return (
    <li className="turn" ref={tail}>
      <span className={`mark mark-${speaker}`} aria-hidden="true">
        {speaker.toUpperCase()}
      </span>
      <div className="turn-body">
        <p className="turn-meta">
          <span className="turn-name">{message.name}</span>
          <time dateTime={new Date(message.at).toISOString()}>
            {new Date(message.at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          <span className="turn-lang">
            <span aria-hidden="true">
              {message.sourceLanguage.toUpperCase()} → {message.targetLanguage.toUpperCase()}
            </span>
            <span className="sr-only">
              {languageName(message.sourceLanguage)} to {languageName(message.targetLanguage)}
            </span>
          </span>
          {demo && <span className="tag">Sample</span>}
        </p>
        {(source || status === "draft") && (
          <p className="turn-source">
            {source ? <LiveText text={source} language={message.sourceLanguage} live={revealing} /> : <span className="pending">Listening…</span>}
          </p>
        )}
        {(translation || (source && status !== "error")) && (
          <p className="turn-translation">
            {translation ? <LiveText text={translation} language={message.targetLanguage} live={revealing} /> : <span className="pending">Translating…</span>}
            {status === "working" && (
              <LoaderCircle size={15} className="spin" aria-label="Translating" />
            )}
          </p>
        )}
        {status === "error" && <p className="turn-error">{error}</p>}
        {status === "done" &&
          (current?.audioUrl ||
            current?.metrics.firstAudioMs !== undefined ||
            current?.metrics.playbackMs !== undefined) && (
          <div className="turn-actions">
            {current?.audioUrl && onPlay && (
              <Button
                variant="ghost"
                className="btn btn-quiet btn-inline"
                disabled={busy}
                onClick={() => onPlay(message.id)}
              >
                <Play size={12} fill="currentColor" aria-hidden="true" />
                Replay
              </Button>
            )}
            {(current?.metrics.firstAudioMs !== undefined ||
              current?.metrics.playbackMs !== undefined) && (
              <span className="tabular">
                First audio at{" "}
                {(
                  (current.metrics.firstAudioMs ?? current.metrics.playbackMs ?? 0) / 1000
                ).toLocaleString("en-US", { maximumFractionDigits: 1 })}{" "}
                s
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function DiscussionTurns({
  messages,
  live = [],
  onPlay,
  busy = false,
  polite = true,
  follow = false,
}: {
  messages: DiscussionMessage[];
  live?: Turn[];
  onPlay?: (id: string) => void;
  busy?: boolean;
  polite?: boolean;
  follow?: boolean;
}) {
  const tail = useRef<HTMLLIElement>(null);
  const last = messages.at(-1);
  const liveById = new Map(live.map((turn) => [turn.id, turn]));
  useEffect(() => {
    if (!follow) return;
    tail.current?.scrollIntoView({ block: "nearest" });
  }, [follow, messages.length, last?.id, last?.translation]);
  return (
    <ol
      className="turns"
      aria-live={polite ? "polite" : undefined}
      aria-relevant={polite ? "additions text" : undefined}
    >
      {messages.map((message, index) => (
        <TurnItem
          key={message.id}
          message={message}
          current={liveById.get(message.id)}
          onPlay={onPlay}
          busy={busy}
          tail={index === messages.length - 1 ? tail : undefined}
        />
      ))}
    </ol>
  );
}

export function Conversation({
  messages,
  live,
  onPlay,
  onDemo,
  busy,
}: {
  messages: DiscussionMessage[];
  live: Turn[];
  onPlay: (id: string) => void;
  onDemo: () => void;
  busy: boolean;
}) {
  // Keep the newest message in view while the reader is at the end of the page.
  const followRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      followRef.current =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 96;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const last = messages.at(-1);
  useEffect(() => {
    if (!messages.length || !followRef.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    followRef.current = true;
  }, [messages.length, last?.id, last?.translation, last?.source]);

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="sr-only">
        Discussion
      </h2>
      {messages.length === 0 ? (
        <div className="empty">
          <p className="empty-title">
            Turn on a microphone to start a new discussion.
          </p>
          <p className="empty-text">
            The translation appears here and is read aloud. Keep the sound on.{" "}
            {readAuthToken()
              ? "The text is saved with your account."
              : "The text is saved on this device."}
          </p>
          <Button className="btn" onClick={onDemo} disabled={busy}>
            <Play size={13} fill="currentColor" aria-hidden="true" />
            Try an audio sample
          </Button>
        </div>
      ) : (
        <DiscussionTurns
          messages={messages}
          live={live}
          onPlay={onPlay}
          busy={busy}
        />
      )}
    </section>
  );
}
