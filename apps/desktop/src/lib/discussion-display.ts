import { languageName } from "@interprete/shared/languages";
import { snippet, type Discussion, type DiscussionKind } from "./discussion";

export const DISCUSSION_KIND_LABEL: Record<DiscussionKind, string> = {
  conversation: "Conversation",
  call: "Online meeting",
};

export const RECENT_DISCUSSION_LIMIT = 5;

const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export function formatClock(at: number) {
  return new Date(at).toLocaleTimeString("en-US", CLOCK);
}

export function formatDiscussionStamp(at: number) {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayKey(date: Date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// Today shows the time, yesterday keeps the day word, older rows show the date.
export function formatDiscussionListTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const time = formatClock(at);
  const today = new Date(now);
  if (dayKey(date) === dayKey(today)) return time;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return `Yesterday, ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function discussionCountLabel(count: number) {
  return count === 1 ? "1 message" : `${count} messages`;
}

export function discussionsByUpdate(discussions: Discussion[]) {
  return [...discussions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function recentDiscussions(discussions: Discussion[], limit = RECENT_DISCUSSION_LIMIT) {
  return discussionsByUpdate(discussions).slice(0, limit);
}

export function discussionLanguagePair(discussion: Discussion) {
  const first = discussion.messages[0];
  if (!first) return "";
  const codes: string[] = [];
  for (const message of discussion.messages) {
    for (const code of [message.sourceLanguage, message.targetLanguage]) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  if (codes.length > 2) return codes.map((code) => languageName(code)).join(" · ");
  const pairs = new Set(
    discussion.messages.map((message) => `${message.sourceLanguage}>${message.targetLanguage}`),
  );
  const swapped = pairs.has(`${first.targetLanguage}>${first.sourceLanguage}`);
  const arrow = pairs.size > 1 && swapped ? "↔" : "→";
  return `${languageName(first.sourceLanguage)} ${arrow} ${languageName(first.targetLanguage)}`;
}

export function discussionPreview(discussion: Discussion) {
  for (let index = discussion.messages.length - 1; index >= 0; index -= 1) {
    const message = discussion.messages[index];
    const text = snippet(message.translation || message.source, 96);
    if (text && text !== discussion.title) return text;
  }
  return "";
}
