import type { InterpretationEvent } from "../contracts";
export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json"))
    throw new Error("La session a expiré. Recharge la page pour continuer.");
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error || "La demande a échoué.");
    Object.assign(error, { code: json.code });
    throw error;
  }
  return json as T;
}
export async function streamInterpretation(
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: InterpretationEvent) => void,
) {
  const response = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const value = await response
      .json()
      .catch(() => ({ error: "La traduction n’a pas abouti." }));
    throw new Error(value.error);
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("Recharge la page pour rétablir la connexion.");
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
          onEvent(event);
        }
      }
    }
    if (!completed && !signal.aborted)
      throw new Error(
        "La connexion a été interrompue avant la fin de la traduction. Réessaie.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
