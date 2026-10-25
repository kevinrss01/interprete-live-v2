import { useState, useSyncExternalStore } from "react";
import { discussionLog, type Discussion } from "../lib/discussion";
import { discussionsByUpdate } from "../lib/discussion-display";
import { readAuthToken } from "../lib/account";
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
import { HistoryDetail } from "./history-detail";
import { HistoryRow } from "./history-row";

export function HistoryPage({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const state = useSyncExternalStore(
    discussionLog.subscribe,
    discussionLog.getSnapshot,
    discussionLog.getServerSnapshot,
  );
  const [pendingDelete, setPendingDelete] = useState(false);
  const discussions = discussionsByUpdate(state.discussions);
  const selected = discussions.find((discussion) => discussion.id === selectedId) ?? null;
  const inProgress = new Set(
    [state.open.conversation, state.open.call].filter((id): id is string => Boolean(id)),
  );
  return (
    <section
      className={selected ? "history history-detail" : "history"}
      aria-labelledby="history-title"
    >
      {selected ? (
        <HistoryDetail
          discussion={selected}
          onBack={() => onSelect(null)}
          onDelete={() => setPendingDelete(true)}
        />
      ) : (
        <HistoryList
          discussions={discussions}
          inProgress={inProgress}
          signedIn={Boolean(readAuthToken())}
          onSelect={onSelect}
        />
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
            <AlertDialogCancel className="h-9 px-4">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 px-4"
              variant="destructive"
              onClick={() => {
                if (selected) discussionLog.remove(selected.id);
                onSelect(null);
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

function HistoryList({
  discussions,
  inProgress,
  signedIn,
  onSelect,
}: {
  discussions: Discussion[];
  inProgress: Set<string>;
  signedIn: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <h1 id="history-title">History</h1>
      <p className="empty-text">{signedIn ? "Saved with your account." : "Saved on this device."}</p>
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
            <HistoryRow
              key={discussion.id}
              discussion={discussion}
              inProgress={inProgress.has(discussion.id)}
              onSelect={() => onSelect(discussion.id)}
            />
          ))}
        </ol>
      )}
    </>
  );
}
