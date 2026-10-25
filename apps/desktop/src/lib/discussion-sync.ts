import type { Discussion, DiscussionLog } from "./discussion";
import { readAuthToken, rpc } from "./account";
import { LANGUAGES } from "@interprete/shared/languages";

const BUDGET = 18_000;

export type DiscussionSave = {
  id: string;
  kind: Discussion["kind"];
  title: string;
  callId: string | null;
  startedAt: number;
  updatedAt: number;
  closedAt: number | null;
  messages: {
    id: string;
    role: Discussion["messages"][number]["role"];
    name: string;
    source: string;
    translation: string;
    sourceLanguage: Discussion["messages"][number]["sourceLanguage"];
    targetLanguage: Discussion["messages"][number]["targetLanguage"];
    status: Discussion["messages"][number]["status"];
    error: string | null;
    demo: boolean;
    spokenAt: number;
    updatedAt: number;
  }[];
};

// Splits a discussion into requests that stay under the RPC body limit.
export function discussionSaves(
  discussion: Discussion,
  messageIds?: ReadonlySet<string>,
): DiscussionSave[] {
  const header = {
    id: discussion.id,
    kind: discussion.kind,
    title: discussion.title,
    callId: discussion.callId,
    startedAt: discussion.startedAt,
    updatedAt: discussion.updatedAt,
    closedAt: discussion.closedAt,
  };
  const messages = discussion.messages
    .filter((message) => !messageIds || messageIds.has(message.id))
    .map((message) => ({
      id: message.id,
      role: message.role,
      name: message.name,
      source: message.source,
      translation: message.translation,
      sourceLanguage: message.sourceLanguage,
      targetLanguage: message.targetLanguage,
      status: message.status,
      error: message.error ?? null,
      demo: Boolean(message.demo),
      spokenAt: message.at,
      updatedAt: message.updatedAt,
    }));
  const batches: DiscussionSave[] = [];
  let current: DiscussionSave["messages"] = [];
  const emptySize = () => JSON.stringify({ ...header, messages: [] }).length;
  let size = emptySize();
  const push = () => {
    batches.push({ ...header, messages: current });
    current = [];
    size = emptySize();
  };
  for (const message of messages) {
    const next = JSON.stringify(message).length + 1;
    if (current.length && size + next > BUDGET) push();
    current.push(message);
    size += next;
  }
  if (current.length || !batches.length) push();
  return batches;
}

const headerKey = (discussion: Pick<Discussion, "title" | "updatedAt" | "closedAt" | "callId" | "kind">) =>
  JSON.stringify([discussion.kind, discussion.title, discussion.callId, discussion.updatedAt, discussion.closedAt]);

type DiscussionHeader = Awaited<ReturnType<typeof rpc.discussions.list>>[number];
type DiscussionWireMessage = Awaited<ReturnType<typeof rpc.discussions.messages>>[number];

function remoteMessages(messages: DiscussionWireMessage[]): Discussion["messages"] {
  return messages.flatMap((message) => {
    const sourceLanguage = LANGUAGES.find((language) => language.code === message.sourceLanguage)?.code;
    const targetLanguage = LANGUAGES.find((language) => language.code === message.targetLanguage)?.code;
    if (!sourceLanguage || !targetLanguage) return [];
    return [{
      id: message.id,
      at: message.spokenAt,
      updatedAt: message.updatedAt,
      role: message.role,
      name: message.name,
      source: message.source,
      translation: message.translation,
      sourceLanguage,
      targetLanguage,
      status: message.status,
      ...(message.error ? { error: message.error } : {}),
      ...(message.demo ? { demo: true } : {}),
    }];
  });
}
function remoteDiscussion(header: DiscussionHeader, messages: DiscussionWireMessage[]): Discussion {
  return {
    id: header.id,
    kind: header.kind,
    title: header.title,
    callId: header.callId,
    startedAt: header.startedAt,
    updatedAt: header.updatedAt,
    closedAt: header.closedAt,
    closed: header.closedAt !== null,
    messages: remoteMessages(messages),
  };
}

const errorCode = (error: unknown) =>
  typeof error === "object" && error && "code" in error ? String(error.code) : "";

// Keeps PostgreSQL aligned with the local discussion. The screen never waits on this.
export function startDiscussionSync(log: DiscussionLog) {
  let stopped = false;
  const pending = new Set<string>();
  const removed = new Set<string>();
  const forbidden = new Set<string>();
  let forbiddenToken = readAuthToken();
  const currentToken = () => {
    const token = readAuthToken();
    if (token !== forbiddenToken) {
      forbidden.clear();
      forbiddenToken = token;
    }
    return token;
  };
  const syncedMessages = new Map<string, number>();
  const syncedHeaders = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let again = false;

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  };
  const queue = (id: string) => {
    currentToken();
    if (forbidden.has(id)) return;
    pending.add(id);
    schedule(600);
  };

  async function flush() {
    if (stopped || !currentToken()) return;
    if (flushing) {
      again = true;
      return;
    }
    flushing = true;
    const saves = [...pending];
    const deletions = [...removed];
    pending.clear();
    removed.clear();
    try {
      for (const id of deletions) await rpc.discussions.remove({ id });
      for (const id of saves) {
        if (forbidden.has(id)) continue;
        const discussion = log.getSnapshot().discussions.find((item) => item.id === id);
        if (!discussion) continue;
        const dirty = new Set(
          discussion.messages
            .filter((message) => (syncedMessages.get(message.id) ?? -1) < message.updatedAt)
            .map((message) => message.id),
        );
        if (!dirty.size && syncedHeaders.get(id) === headerKey(discussion)) continue;
        try {
          for (const batch of discussionSaves(discussion, dirty))
            await rpc.discussions.save(batch);
        } catch (error) {
          // A local discussion from another account must remain local. Retrying
          // cannot change ownership and must not block the other discussions.
          if (errorCode(error) !== "FORBIDDEN") throw error;
          forbidden.add(id);
          continue;
        }
        for (const message of discussion.messages) syncedMessages.set(message.id, message.updatedAt);
        syncedHeaders.set(id, headerKey(discussion));
      }
    } catch (error) {
      for (const id of deletions) removed.add(id);
      for (const id of saves) if (!forbidden.has(id)) pending.add(id);
      if (!stopped && errorCode(error) !== "UNAUTHORIZED") schedule(5000);
    } finally {
      flushing = false;
      if (again) {
        again = false;
        void flush();
      }
    }
  }

  async function pull() {
    if (!readAuthToken()) return;
    const headers = await rpc.discussions.list();
    const remote: Discussion[] = [];
    for (const header of headers) {
      if (stopped) return;
      const messages = await rpc.discussions.messages({ id: header.id });
      remote.push(remoteDiscussion(header, messages));
      for (const message of messages) syncedMessages.set(message.id, message.updatedAt);
      syncedHeaders.set(header.id, headerKey(header));
    }
    if (!stopped) log.ingest(remote);
    if (!stopped) for (const discussion of log.getSnapshot().discussions) queue(discussion.id);
  }

  const stopWatch = log.watch((change) => {
    if (change.type === "remove") {
      pending.delete(change.id);
      syncedHeaders.delete(change.id);
      removed.add(change.id);
      schedule(0);
      return;
    }
    queue(change.id);
  });
  void pull().catch(() => {
    if (!stopped) for (const discussion of log.getSnapshot().discussions) queue(discussion.id);
  });
  const onHide = () => void flush();
  globalThis.window?.addEventListener("pagehide", onHide);
  return () => {
    stopped = true;
    stopWatch();
    if (timer) clearTimeout(timer);
    globalThis.window?.removeEventListener("pagehide", onHide);
  };
}
