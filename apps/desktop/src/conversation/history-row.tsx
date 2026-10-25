import { ChevronRight } from "lucide-react";
import {
  DISCUSSION_KIND_LABEL,
  discussionCountLabel,
  discussionLanguagePair,
  discussionPreview,
  formatDiscussionListTime,
} from "../lib/discussion-display";
import type { Discussion } from "../lib/discussion";

export function HistoryRow({
  discussion,
  inProgress,
  onSelect,
}: {
  discussion: Discussion;
  inProgress: boolean;
  onSelect: () => void;
}) {
  const preview = discussionPreview(discussion);
  return (
    <li>
      <button type="button" className="history-row" onClick={onSelect}>
        <span className="history-copy">
          <span className="history-title-line">
            <span className="history-title">{discussion.title}</span>
            {inProgress && <span className="tag">In progress</span>}
          </span>
          {preview && <span className="history-preview">{preview}</span>}
          <span className="history-meta">
            <span>{DISCUSSION_KIND_LABEL[discussion.kind]}</span>
            <span>{discussionCountLabel(discussion.messages.length)}</span>
            <span>{discussionLanguagePair(discussion)}</span>
          </span>
        </span>
        <span className="history-aside">
          <time dateTime={new Date(discussion.updatedAt).toISOString()}>
            {formatDiscussionListTime(discussion.updatedAt)}
          </time>
          <ChevronRight className="history-chevron" size={16} aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}
