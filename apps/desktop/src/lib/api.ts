import { hc, type ClientResponse, type InferRequestType } from "hono/client";
import type { AppType } from "@interprete/server";
import type { InterpretationEvent } from "@interprete/shared/contracts";
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
export async function streamInterpretation(
  body: InferRequestType<typeof api.api.interpret.$post>["json"],
  signal: AbortSignal,
  onEvent: (event: InterpretationEvent) => void | Promise<void>,
) {
  const response = await api.api.interpret.$post(
    { json: body },
    { init: { signal } },
  );
  if (!response.ok) {
    const value = (await response
      .json()
      .catch(() => ({
        error: "The translation did not complete.",
      }))) as ServerError;
    throw new Error(value.error);
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("Reload the page to restore the connection.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          const event = JSON.parse(line.slice(5)) as InterpretationEvent;
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done") completed = true;
          await onEvent(event);
        }
      }
    }
    if (!completed && !signal.aborted)
      throw new Error(
        "The connection was interrupted before the translation finished. Try again.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
