import { Play, SquarePen } from "lucide-react";

export function ConversationActions({
  busy,
  empty,
  onNewDiscussion,
  onSample,
}: {
  busy: boolean;
  empty: boolean;
  onNewDiscussion: () => void;
  onSample: () => void;
}) {
  return (
    <div className="conversation-float">
      <button
        type="button"
        className="float-action float-new"
        disabled={busy || empty}
        onClick={onNewDiscussion}
      >
        <SquarePen size={13} aria-hidden="true" />
        New discussion
      </button>
      <button type="button" className="float-action" disabled={busy} onClick={onSample}>
        <Play size={13} fill="currentColor" aria-hidden="true" />
        Audio sample
      </button>
    </div>
  );
}
