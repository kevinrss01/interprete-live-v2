import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { DiscussionTurns } from "./conversation";
import { discussionLog, type Discussion } from "../lib/discussion";
import { readAuthToken } from "../lib/account";
import { Button } from "@interprete/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@interprete/ui/components/alert-dialog";

const kindLabel = { conversation: "Conversation", call: "Online meeting" } as const;
const when = (at: number) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const discussionMeta = (discussion: Discussion) => {
  const count = discussion.messages.length === 1 ? "1 message" : `${discussion.messages.length} messages`;
  return `${kindLabel[discussion.kind]} · ${when(discussion.updatedAt)} · ${count}`;
};

export function HistoryPage() {
  const state = useSyncExternalStore(
    discussionLog.subscribe,
    discussionLog.getSnapshot,
    discussionLog.getServerSnapshot,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const discussions = [...state.discussions].sort((a, b) => b.updatedAt - a.updatedAt);
  const selected = discussions.find((discussion) => discussion.id === selectedId) ?? null;
  const inProgress = new Set(
    [state.open.conversation, state.open.call].filter((id): id is string => Boolean(id)),
  );
  return (
    <section className="history" aria-labelledby="history-title">
      {selected ? (
        <>
          <div className="history-bar">
            <Button
              variant="ghost"
              className="btn btn-quiet"
              onClick={() => setSelectedId(null)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              History
            </Button>
            <Button
              variant="ghost"
              className="icon-btn"
              aria-label="Delete this discussion"
              title="Delete this discussion"
              onClick={() => setPendingDelete(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          </div>
          <h1 id="history-title">{selected.title}</h1>
          <p className="note">{discussionMeta(selected)}</p>
          <DiscussionTurns messages={selected.messages} polite={false} />
        </>
      ) : (
        <>
          <h1 id="history-title">History</h1>
          <p className="empty-text">
            {readAuthToken() ? "Saved with your account." : "Saved on this device."}
          </p>
          {discussions.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No discussions yet.</p>
              <p className="empty-text">
                Messages are added here as a conversation or a call is translated.
              </p>
            </div>
          ) : (
            <ol className="history-list">
              {discussions.map((discussion) => (
                <li key={discussion.id}>
                  <button
                    type="button"
                    className="history-row"
                    onClick={() => setSelectedId(discussion.id)}
                  >
                    <span className="history-copy">
                      <span className="history-title">{discussion.title}</span>
                      <span className="history-meta">{discussionMeta(discussion)}</span>
                    </span>
                    {inProgress.has(discussion.id) && <span className="tag">In progress</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this discussion</AlertDialogTitle>
            <AlertDialogDescription>
              {readAuthToken()
                ? "Remove this discussion from your account? This cannot be undone."
                : "Remove this discussion from this device? This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 px-4">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 px-4"
              variant="destructive"
              onClick={() => {
                if (selected) discussionLog.remove(selected.id);
                setSelectedId(null);
                setPendingDelete(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
