import type { Turn } from "@interprete/shared/contracts";
import {
  MAX_DISCUSSIONS,
  MAX_DISCUSSION_MESSAGES,
  MAX_DISCUSSION_TEXT,
} from "@interprete/shared/discussions";
import { LANGUAGES, type Language } from "@interprete/shared/languages";

// The screen reads this cache immediately. The account copy in PostgreSQL is synced separately.
// Text only: playback audio is never stored.
const STORAGE_KEY = "interprete-discussions-v1";
const DEFAULT_TITLE = { conversation: "Conversation", call: "Online meeting" } as const;
const STATUSES = new Set<Turn["status"]>(["draft", "working", "done", "error"]);

export type DiscussionKind = "conversation" | "call";
export type DiscussionRole = "you" | "them";
export type DiscussionMessage = {
  id: string;
  at: number;
  updatedAt: number;
  role: DiscussionRole;
  name: string;
  source: string;
  translation: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  status: Turn["status"];
  error?: string;
  demo?: boolean;
};
export type Discussion = {
  id: string;
  kind: DiscussionKind;
  title: string;
  startedAt: number;
  updatedAt: number;
  closedAt: number | null;
  closed: boolean;
  callId: string | null;
  messages: DiscussionMessage[];
};
export type DiscussionChange =
  | { type: "save"; id: string }
  | { type: "remove"; id: string };
export type DiscussionState = {
  discussions: Discussion[];
  open: Record<DiscussionKind, string | null>;
};
export type DiscussionInput = Omit<DiscussionMessage, "at" | "updatedAt">;
export type DiscussionOptions = { title?: string; callId?: string | null };
type Names = { you: string; them: string };

const serverSnapshot: DiscussionState = {
  discussions: [],
  open: { conversation: null, call: null },
};

const isLanguage = (value: unknown): value is Language =>
  LANGUAGES.some((language) => language.code === value);
const clip = (value: string) => {
  const clean = value.replace(/\u0000/g, "");
  return clean.length > MAX_DISCUSSION_TEXT ? clean.slice(0, MAX_DISCUSSION_TEXT) : clean;
};
export const snippet = (text: string, limit = 72) => {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit).trimEnd() + "…";
};

export function discussionInput(turn: Turn, role: DiscussionRole, name: string): DiscussionInput {
  return {
    id: turn.id,
    role,
    name,
    source: turn.source,
    translation: turn.translation,
    sourceLanguage: turn.sourceLanguage,
    targetLanguage: turn.targetLanguage,
    status: turn.status,
    ...(turn.error ? { error: turn.error } : {}),
    ...(turn.demo ? { demo: true } : {}),
  };
}
export function discussionInputs(turns: Turn[], names: Names): DiscussionInput[] {
  return turns.map((turn) =>
    discussionInput(
      turn,
      turn.speaker === "a" ? "you" : "them",
      names[turn.speaker === "a" ? "you" : "them"],
    ),
  );
}
export function openDiscussion(state: DiscussionState, kind: DiscussionKind) {
  const id = state.open[kind];
  return state.discussions.find((discussion) => discussion.id === id) ?? null;
}
export function messageIds(state: DiscussionState) {
  return new Set(
    state.discussions.flatMap((discussion) => discussion.messages.map((message) => message.id)),
  );
}
// Shows the open discussion, with live text on top, and a turn that is not saved anywhere yet.
export function mergeMessages(
  saved: DiscussionMessage[],
  live: Turn[],
  names: Names,
  knownIds: ReadonlySet<string>,
): DiscussionMessage[] {
  const savedIds = new Set(saved.map((message) => message.id));
  const overlay = saved.map((message) => {
    const current = live.find((turn) => turn.id === message.id);
    if (!current) return message;
    return {
      ...message,
      name: names[message.role],
      source: current.source,
      translation: current.translation,
      status: current.status,
      error: current.error,
      demo: current.demo,
    };
  });
  const extras = live
    .filter(
      (turn) =>
        !savedIds.has(turn.id) &&
        !knownIds.has(turn.id) &&
        (turn.source.trim() || turn.translation.trim()),
    )
    .map((turn) => ({
      ...discussionInput(
        turn,
        turn.speaker === "a" ? "you" : "them",
        names[turn.speaker === "a" ? "you" : "them"],
      ),
      at: Date.now(),
      updatedAt: Date.now(),
    }));
  return [...overlay, ...extras];
}

const empty = (): DiscussionState => ({
  discussions: [],
  open: { conversation: null, call: null },
});

function storedMessage(
  turn: (DiscussionInput & { at?: number; updatedAt?: number }) | null | undefined,
  at: number,
): DiscussionMessage | null {
  if (!turn?.id || !STATUSES.has(turn.status)) return null;
  if (!isLanguage(turn.sourceLanguage) || !isLanguage(turn.targetLanguage)) return null;
  if (turn.role !== "you" && turn.role !== "them") return null;
  if (!turn.source.trim() && !turn.translation.trim() && turn.status !== "error") return null;
  const spokenAt = typeof turn.at === "number" ? turn.at : at;
  return {
    id: turn.id,
    at: spokenAt,
    updatedAt: typeof turn.updatedAt === "number" ? turn.updatedAt : spokenAt,
    role: turn.role,
    name: clip(turn.name).trim() || (turn.role === "them" ? "Other person" : "You"),
    source: clip(turn.source),
    translation: clip(turn.translation),
    sourceLanguage: turn.sourceLanguage,
    targetLanguage: turn.targetLanguage,
    status: turn.status,
    ...(turn.error ? { error: clip(turn.error) } : {}),
    ...(turn.demo ? { demo: true } : {}),
  };
}
function same(a: DiscussionMessage, b: DiscussionMessage) {
  return (
    a.role === b.role &&
    a.name === b.name &&
    a.source === b.source &&
    a.translation === b.translation &&
    a.sourceLanguage === b.sourceLanguage &&
    a.targetLanguage === b.targetLanguage &&
    a.status === b.status &&
    (a.error ?? "") === (b.error ?? "") &&
    Boolean(a.demo) === Boolean(b.demo)
  );
}
function titleFor(kind: DiscussionKind, options: DiscussionOptions | undefined, source: string) {
  const named = snippet(options?.title ?? "");
  const spoken = snippet(source);
  if (kind === "call") return named || spoken || DEFAULT_TITLE.call;
  return spoken || named || DEFAULT_TITLE.conversation;
}
// A draft transcript can save "bon" before the rest of the sentence arrives.
function isPartialTitle(title: string, source: string) {
  const head = title.replace(/…$/u, "").trim().toLocaleLowerCase();
  const body = source.replace(/…$/u, "").trim().toLocaleLowerCase();
  return head.length > 0 && head.length < body.length && body.startsWith(head);
}
// The title follows the opening line only while it still is that line.
// Once retention drops the opening, the title no longer matches the first
// stored line, so a later sentence cannot replace it. A call app name is kept
// even when the utterance starts with the same word.
function titleAfterOpeningChange(
  discussion: Pick<Discussion, "kind" | "title">,
  previousSource: string,
  nextSource: string,
  options: DiscussionOptions | undefined,
) {
  const named = discussion.kind === "call" ? namedTitle(options) : "";
  if (named && (discussion.title === named || discussion.title === DEFAULT_TITLE.call)) return named;
  const ownsOpening =
    discussion.title === snippet(previousSource) || discussion.title === DEFAULT_TITLE[discussion.kind];
  if (!ownsOpening) return discussion.title;
  return snippet(nextSource) || discussion.title;
}
function storedOpeningTitle(discussion: Pick<Discussion, "kind" | "title" | "messages">) {
  const spoken = snippet(discussion.messages[0]?.source ?? "");
  const fallback = DEFAULT_TITLE[discussion.kind];
  const openingStillStored = discussion.messages.length < MAX_DISCUSSION_MESSAGES;
  if (
    discussion.kind === "conversation" &&
    openingStillStored &&
    spoken &&
    isPartialTitle(discussion.title, spoken)
  ) {
    return spoken;
  }
  if ((discussion.title === fallback || !discussion.title) && spoken) return spoken;
  return discussion.title || spoken || fallback;
}
function cloneDiscussion(discussion: Discussion): Discussion {
  return { ...discussion, messages: discussion.messages.map((message) => ({ ...message })) };
}
function storedDiscussion(item: unknown): Discussion | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Partial<Discussion>;
  if (record.kind !== "conversation" && record.kind !== "call") return null;
  if (typeof record.id !== "string" || typeof record.title !== "string") return null;
  const messages = (Array.isArray(record.messages) ? record.messages : []).flatMap((message) => {
    const spokenAt = typeof message?.at === "number" ? message.at : Date.now();
    const stored = storedMessage(message, spokenAt);
    return stored ? [stored] : [];
  });
  if (!messages.length) return null;
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : messages.at(-1)!.at;
  const closedAt =
    typeof record.closedAt === "number" ? record.closedAt : record.closed === true ? updatedAt : null;
  return {
    id: record.id,
    kind: record.kind,
    title: storedOpeningTitle({
      kind: record.kind,
      title: snippet(record.title) || DEFAULT_TITLE[record.kind],
      messages,
    }),
    startedAt: typeof record.startedAt === "number" ? record.startedAt : messages[0].at,
    updatedAt,
    closedAt,
    closed: closedAt !== null,
    callId: typeof record.callId === "string" ? record.callId : null,
    messages,
  };
}
function storedOpen(discussions: Discussion[], open: DiscussionState["open"] | undefined) {
  const known = (id: unknown): id is string =>
    typeof id === "string" && discussions.some((discussion) => discussion.id === id);
  const conversation = open?.conversation;
  const call = open?.call;
  return {
    conversation: known(conversation) ? conversation : null,
    call: known(call) ? call : null,
  };
}
function load(storage: Storage | null): DiscussionState {
  if (!storage) return empty();
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) || "null") as Partial<DiscussionState> | null;
    if (!raw || !Array.isArray(raw.discussions)) return empty();
    let healed = false;
    const discussions = raw.discussions.flatMap((item) => {
      const stored = storedDiscussion(item);
      if (!stored) return [];
      const savedTitle = snippet((item as Partial<Discussion>).title ?? "");
      if (stored.title !== savedTitle) healed = true;
      return [stored];
    });
    const state = { discussions, open: storedOpen(discussions, raw.open) };
    if (healed) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // The repaired title still shows for this session.
      }
    }
    return state;
  } catch {
    return empty();
  }
}
// Newest updatedAt first. Equal times keep the later entry in the cache.
function byNewest(discussions: Discussion[], include: (discussion: Discussion) => boolean) {
  return discussions
    .map((discussion, index) => ({ discussion, index }))
    .filter(({ discussion }) => include(discussion))
    .sort((a, b) => b.discussion.updatedAt - a.discussion.updatedAt || b.index - a.index)
    .map(({ discussion }) => discussion);
}

function trim(state: DiscussionState): DiscussionState {
  const discussions = state.discussions.map((discussion) =>
    discussion.messages.length > MAX_DISCUSSION_MESSAGES
      ? { ...discussion, messages: discussion.messages.slice(-MAX_DISCUSSION_MESSAGES) }
      : discussion,
  );
  // Open discussions stay. The one on screen stays even if the account already closed it.
  const pinned = new Set(
    discussions.filter((discussion) => discussion.closedAt === null).map((discussion) => discussion.id),
  );
  if (state.open.conversation) pinned.add(state.open.conversation);
  if (state.open.call) pinned.add(state.open.call);
  const room = Math.max(0, MAX_DISCUSSIONS - pinned.size);
  const keptClosed = new Set(
    byNewest(discussions, (discussion) => !pinned.has(discussion.id))
      .slice(0, room)
      .map((discussion) => discussion.id),
  );
  return {
    discussions: discussions.filter(
      (discussion) => pinned.has(discussion.id) || keptClosed.has(discussion.id),
    ),
    open: state.open,
  };
}

type RecordDraft = {
  discussions: Discussion[];
  open: DiscussionState["open"];
  touched: Set<string>;
  changed: boolean;
};
type MessageIndex = Map<string, { discussion: Discussion; messageIndex: number }>;

function closeSplitCall(draft: RecordDraft, current: Discussion, now: number) {
  current.closed = true;
  current.closedAt = current.closedAt ?? now;
  current.updatedAt = now;
  draft.open.call = null;
  draft.touched.add(current.id);
  draft.changed = true;
}
function attachCallId(draft: RecordDraft, current: Discussion, nextCall: string | null, now: number) {
  if (!nextCall || current.callId) return;
  current.callId = nextCall;
  current.updatedAt = now;
  draft.touched.add(current.id);
  draft.changed = true;
}
function startDiscussion(
  draft: RecordDraft,
  kind: DiscussionKind,
  nextCall: string | null,
  options: DiscussionOptions | undefined,
  turn: DiscussionMessage,
  now: number,
) {
  const created: Discussion = {
    id: crypto.randomUUID(),
    kind,
    title: titleFor(kind, options, turn.source),
    startedAt: now,
    updatedAt: now,
    closed: false,
    closedAt: null,
    callId: nextCall,
    messages: [],
  };
  draft.discussions.push(created);
  draft.open[kind] = created.id;
  return created;
}
function namedTitle(options: DiscussionOptions | undefined) {
  return snippet(options?.title ?? "");
}
function retitleCall(discussion: Discussion, options: DiscussionOptions | undefined) {
  const titled = namedTitle(options);
  if (discussion.kind === "call" && titled && discussion.title === DEFAULT_TITLE.call) discussion.title = titled;
}
function retitleDefault(discussion: Discussion, options: DiscussionOptions | undefined) {
  const titled = namedTitle(options);
  if (titled && discussion.title === DEFAULT_TITLE[discussion.kind]) discussion.title = titled;
}
function placeTurn(
  draft: RecordDraft,
  index: MessageIndex,
  current: Discussion | undefined,
  turn: DiscussionMessage,
  kind: DiscussionKind,
  nextCall: string | null,
  options: DiscussionOptions | undefined,
  now: number,
) {
  const found = index.get(turn.id);
  if (found) {
    const previous = found.discussion.messages[found.messageIndex];
    const next = { ...turn, at: previous.at, updatedAt: now };
    if (same(previous, next)) return current;
    found.discussion.messages[found.messageIndex] = next;
    found.discussion.updatedAt = now;
    if (found.messageIndex === 0) {
      found.discussion.title = titleAfterOpeningChange(
        found.discussion,
        previous.source,
        next.source,
        options,
      );
    }
    retitleCall(found.discussion, options);
    draft.touched.add(found.discussion.id);
    draft.changed = true;
    return current;
  }
  const target = current ?? startDiscussion(draft, kind, nextCall, options, turn, now);
  target.messages.push(turn);
  target.updatedAt = now;
  retitleDefault(target, options);
  index.set(turn.id, { discussion: target, messageIndex: target.messages.length - 1 });
  draft.touched.add(target.id);
  draft.changed = true;
  return target;
}
// Applies one local edit to a copy of the cache. Returns nothing when the text is unchanged.
function applyRecord(
  state: DiscussionState,
  kind: DiscussionKind,
  turns: DiscussionInput[],
  options: DiscussionOptions | undefined,
) {
  const now = Date.now();
  const fresh = turns.flatMap((turn) => {
    const stored = storedMessage(turn, now);
    return stored ? [stored] : [];
  });
  const nextCall = options?.callId ?? null;
  const existing = state.discussions.find(
    (discussion) => discussion.id === state.open[kind] && discussion.kind === kind && !discussion.closed,
  );
  const split = kind === "call" && Boolean(existing?.callId && nextCall && existing.callId !== nextCall);
  if (!fresh.length && !split) return null;
  const draft: RecordDraft = {
    discussions: state.discussions.map(cloneDiscussion),
    open: { ...state.open },
    touched: new Set(),
    changed: false,
  };
  let current = draft.discussions.find((discussion) => discussion.id === existing?.id);
  if (split && current) {
    closeSplitCall(draft, current, now);
    current = undefined;
  }
  if (fresh.length) {
    if (current && kind === "call") attachCallId(draft, current, nextCall, now);
    const index: MessageIndex = new Map();
    for (const discussion of draft.discussions)
      discussion.messages.forEach((message, messageIndex) =>
        index.set(message.id, { discussion, messageIndex }),
      );
    for (const turn of fresh)
      current = placeTurn(draft, index, current, turn, kind, nextCall, options, now);
  }
  if (!draft.changed) return null;
  return { state: { discussions: draft.discussions, open: draft.open }, touched: draft.touched };
}
function mergeRemote(current: Discussion, item: Discussion) {
  const messages = new Map(current.messages.map((message) => [message.id, message]));
  for (const message of item.messages) {
    const existing = messages.get(message.id);
    if (!existing || message.updatedAt >= existing.updatedAt) messages.set(message.id, { ...message });
  }
  current.messages = [...messages.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  if (item.updatedAt < current.updatedAt) {
    current.title = storedOpeningTitle(current);
    return;
  }
  current.title = item.title;
  current.closed = item.closed;
  current.closedAt = item.closedAt;
  current.callId = item.callId;
  current.updatedAt = item.updatedAt;
  current.kind = item.kind;
  current.title = storedOpeningTitle(current);
}
function reopen(discussions: Discussion[], open: DiscussionState["open"]) {
  const next = { ...open };
  for (const kind of ["conversation", "call"] as const) {
    if (next[kind]) continue;
    const newest = discussions
      .filter((discussion) => discussion.kind === kind && !discussion.closed)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (newest) next[kind] = newest.id;
  }
  return next;
}

export class DiscussionLog {
  private state: DiscussionState;
  private listeners = new Set<() => void>();
  private watchers = new Set<(change: DiscussionChange) => void>();
  constructor(private storage: Storage | null) {
    this.state = load(storage);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  watch = (listener: (change: DiscussionChange) => void) => {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => serverSnapshot;
  record(kind: DiscussionKind, turns: DiscussionInput[], options?: DiscussionOptions) {
    const next = applyRecord(this.state, kind, turns, options);
    if (!next) return;
    this.commit(next.state, next.touched);
  }
  close(kind: DiscussionKind) {
    const id = this.state.open[kind];
    if (!id) return;
    const now = Date.now();
    this.commit({
      discussions: this.state.discussions.map((discussion) =>
        discussion.id === id
          ? { ...discussion, closed: true, closedAt: discussion.closedAt ?? now, updatedAt: now }
          : discussion,
      ),
      open: { ...this.state.open, [kind]: null },
    }, new Set([id]));
  }
  remove(id: string) {
    const open = { ...this.state.open };
    if (open.conversation === id) open.conversation = null;
    if (open.call === id) open.call = null;
    this.commit({
      discussions: this.state.discussions.filter((discussion) => discussion.id !== id),
      open,
    });
    for (const watch of this.watchers) watch({ type: "remove", id });
  }
  // Folds the account copy in without treating it as a new local edit.
  ingest(remote: Discussion[]) {
    const discussions = this.state.discussions.map(cloneDiscussion);
    const byId = new Map(discussions.map((discussion) => [discussion.id, discussion]));
    for (const item of remote) {
      const current = byId.get(item.id);
      if (!current) {
        const added = cloneDiscussion(item);
        added.title = storedOpeningTitle(added);
        discussions.push(added);
        byId.set(item.id, added);
        continue;
      }
      mergeRemote(current, item);
    }
    this.state = trim({ discussions, open: reopen(discussions, this.state.open) });
    this.persist();
    for (const listener of this.listeners) listener();
  }
  private commit(next: DiscussionState, changed = new Set<string>()) {
    this.state = trim(next);
    this.persist();
    for (const listener of this.listeners) listener();
    const present = new Set(this.state.discussions.map((discussion) => discussion.id));
    for (const id of changed) {
      if (!present.has(id)) continue;
      for (const watch of this.watchers) watch({ type: "save", id });
    }
  }
  private persist() {
    if (!this.storage) return;
    const write = () => this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    try {
      write();
    } catch {
      const pinned = new Set([this.state.open.conversation, this.state.open.call]);
      const oldestClosed = byNewest(
        this.state.discussions,
        (discussion) => discussion.closedAt !== null && !pinned.has(discussion.id),
      ).reverse();
      const pool = oldestClosed.length
        ? oldestClosed
        : this.state.discussions.filter((discussion) => !pinned.has(discussion.id));
      if (!pool.length) return;
      const drop = new Set(pool.slice(0, Math.max(1, Math.ceil(pool.length / 2))).map((discussion) => discussion.id));
      this.state = {
        ...this.state,
        discussions: this.state.discussions.filter((discussion) => !drop.has(discussion.id)),
      };
      try {
        write();
      } catch {
        // The newest discussion stays available for this session.
      }
    }
  }
}

const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
export const discussionLog = new DiscussionLog(browserStorage());
