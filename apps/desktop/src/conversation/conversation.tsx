import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import type { Turn } from "@interprete/shared/contracts";
import type { DiscussionMessage } from "../lib/discussion";
import { readAuthToken } from "../lib/account";
import { Button } from "@interprete/ui/components/button";
import { TurnItem } from "./turn-item";

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
