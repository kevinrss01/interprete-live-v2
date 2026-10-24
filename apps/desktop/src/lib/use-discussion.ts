import { useEffect, useSyncExternalStore } from "react";
import type { Turn } from "@interprete/shared/contracts";
import {
  discussionInputs,
  discussionLog,
  mergeMessages,
  messageIds,
  openDiscussion,
  type DiscussionKind,
} from "./discussion";

type Names = { you: string; them: string };

// Subscribes to the local discussion and records the live turns for one screen.
export function useDiscussion({
  kind,
  turns,
  names,
  title,
  callId,
}: {
  kind: DiscussionKind;
  turns: Turn[];
  names: Names;
  title?: string;
  callId?: string | null;
}) {
  const state = useSyncExternalStore(
    discussionLog.subscribe,
    discussionLog.getSnapshot,
    discussionLog.getServerSnapshot,
  );
  const you = names.you;
  const them = names.them;
  useEffect(() => {
    const options = title !== undefined || callId !== undefined ? { title, callId } : undefined;
    discussionLog.record(kind, discussionInputs(turns, { you, them }), options);
  }, [callId, kind, them, title, turns, you]);
  return {
    state,
    messages: mergeMessages(
      openDiscussion(state, kind)?.messages ?? [],
      turns,
      { you, them },
      messageIds(state),
    ),
  };
}
