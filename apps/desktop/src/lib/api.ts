import { hc, type ClientResponse, type InferRequestType } from "hono/client";
import type { AppType } from "@interprete/server";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { abortable } from "./abortable";
// ponytail: empty in tests, where fetch is mocked on bare paths.
const API_URL = import.meta.env?.VITE_API_URL ?? "";
const SESSION_KEY = "interprete-session";
// The server signs the session; it is kept here because the app has no cookies.
export function saveSession(token: unknown) {
  if (typeof token === "string")
    globalThis.localStorage?.setItem(SESSION_KEY, token);
}
export const readSession = () => globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
function authorization(): Record<string, string> {
  const token = readSession();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
// Shape of errorResponse() on the server; not part of the route types.
type ServerError = { error?: string; code?: string };
// Typed client generated from the server routes: a route change breaks this build, not the app.
export const api = hc<AppType>(API_URL, {
  headers: authorization,
  // Resolved per call so tests can swap globalThis.fetch.
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});
// Unwraps an RPC call; server errors become an Error carrying the server's code.
export async function call<T>(request: Promise<ClientResponse<T>>): Promise<T> {
  const response = await request;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json"))
    throw new Error("The session expired. Reload the page to continue.");
  const json = await response.json();
  if (!response.ok) {
    const { error: message, code } = json as ServerError;
    throw Object.assign(new Error(message || "The request failed."), { code });
  }
  return json as T;
}
export type InterpretationTimeouts = { firstEventMs: number; idleMs: number; requestMs: number };
export const interpretationTimeouts: InterpretationTimeouts = { firstEventMs: 8000, idleMs: 8000, requestMs: 20_000 };
export async function streamInterpretation(
  body: InferRequestType<typeof api.api.interpret.$post>["json"],
  signal: AbortSignal,
  onEvent: (event: InterpretationEvent) => void | Promise<void>,
  timeouts: InterpretationTimeouts = interpretationTimeouts,
) {
  const deadline = new AbortController();
  const current = AbortSignal.any([signal, deadline.signal]);
  const timeout = () => deadline.abort(Object.assign(new Error("The translation stopped responding. This passage timed out."), { code: "TRANSLATION_TIMEOUT" }));
  const totalTimer = setTimeout(timeout, timeouts.requestMs);
  let idleTimer = setTimeout(timeout, timeouts.firstEventMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    current.throwIfAborted();
    const response = await abortable(api.api.interpret.$post(
      { json: body },
      { init: { signal: current } },
    ), current);
    if (!response.ok) {
      const value = (await abortable(response
        .json()
        .catch(() => ({
          error: "The translation did not complete.",
        })), current)) as ServerError;
      throw Object.assign(new Error(value.error), { code: value.code, status: response.status });
    }
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw new Error("Reload the page to restore the connection.");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await abortable(reader.read(), current);
      if (done) break;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(timeout, timeouts.idleMs);
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          const event = JSON.parse(line.slice(5)) as InterpretationEvent;
          if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
          // Native playback intentionally applies backpressure. Only the total
          // deadline runs while an audio callback owns a packet.
          clearTimeout(idleTimer);
          await abortable(Promise.resolve(onEvent(event)), current);
          current.throwIfAborted();
          // The protocol's terminal event is authoritative; a proxy/socket may
          // leave the HTTP body open indefinitely after delivering it.
          if (event.type === "done") return;
          idleTimer = setTimeout(timeout, timeouts.idleMs);
        }
      }
    }
    if (!current.aborted)
      throw new Error(
        "The connection was interrupted before the translation finished. Try again.",
      );
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    deadline.abort();
    // Cleanup must not introduce another unbounded wait on an upstream stream.
    if (reader) {
      void reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* A pending read is being cancelled. */ }
    }
  }
}
