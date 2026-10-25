import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@interprete/ui/components/button";
import { DiscussionTurns } from "./conversation";
import {
  DISCUSSION_KIND_LABEL,
  discussionCountLabel,
  discussionLanguagePair,
  formatDiscussionStamp,
} from "../lib/discussion-display";
import type { Discussion } from "../lib/discussion";

export function HistoryDetail({
  discussion,
  onBack,
  onDelete,
}: {
  discussion: Discussion;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="history-bar">
        <Button variant="ghost" className="btn btn-quiet" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          History
        </Button>
        <Button
          variant="ghost"
          className="icon-btn"
          aria-label="Delete this discussion"
          title="Delete this discussion"
          onClick={onDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      </div>
      <h1 id="history-title">{discussion.title}</h1>
      <p className="history-summary">
        <span>{DISCUSSION_KIND_LABEL[discussion.kind]}</span>
        <time dateTime={new Date(discussion.updatedAt).toISOString()}>
          {formatDiscussionStamp(discussion.updatedAt)}
        </time>
        <span>{discussionCountLabel(discussion.messages.length)}</span>
        <span>{discussionLanguagePair(discussion)}</span>
      </p>
      <DiscussionTurns messages={discussion.messages} polite={false} />
    </>
  );
}
