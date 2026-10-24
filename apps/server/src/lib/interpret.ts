import type { z } from "zod";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { usablePrefix } from "@interprete/shared/live-segments";
import { translateText, evaluateReadiness } from "./openai";
import { speechSocket } from "./eleven";
import { AppError } from "./errors";
import type { interpretSchema } from "./validation";
// Streams translation text and synthesized audio as SSE while the speaker is still talking.
export function interpretResponse(
  data: z.infer<typeof interpretSchema>,
  voiceId: string,
  requestSignal: AbortSignal,
) {
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(45000);
  const signal = AbortSignal.any([requestSignal, abort.signal, deadline]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false,
        text = "",
        firstToken: number | undefined,
        firstAudio: number | undefined;
      const voice: {
        current: Awaited<ReturnType<typeof speechSocket>> | null;
      } = { current: null };
      const start = performance.now();
      const emit = (event: InterpretationEvent) => {
        if (!closed && !requestSignal.aborted && !abort.signal.aborted)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      const gatePromise = evaluateReadiness(
        data.text,
        signal,
        data.followingText,
        data.context.at(-1)?.source || "",
      );
      const permission = gatePromise.then((g) => {
        const ready =
          data.isFinal ||
          (usablePrefix(data.text, data.followingText, data.sourceLanguage) &&
            ((!g.unavailable &&
              g.probability !== null &&
              g.probability >= 0.6) ||
              /[.!?。！？]$/u.test(data.text)));
        emit({
          type: "gate",
          decision: data.isFinal ? "final" : ready ? "ready" : "wait",
          ...g,
        });
        return ready;
      });
      // Final turns don't await this derived promise; cancellation must still be handled.
      void permission.catch(() => {});
      // Establish the idle TTS socket while the LLM and readiness check run.
      const socketPromise = speechSocket(
        voiceId,
        data.targetLanguage,
        signal,
        (audio) => {
          firstAudio ??= performance.now() - start;
          emit({ type: "audio", audio, sampleRate: 24000 });
        },
      ).then((socket) => {
        voice.current = socket;
        return socket;
      });
      void socketPromise.catch(() => {});
      const speechPromise = (
        data.isFinal ? Promise.resolve(true) : permission
      ).then(async (ready) => {
        const socket = await socketPromise;
        if (!ready) {
          socket.close();
          return null;
        }
        return socket;
      });
      speechPromise.catch(() => {});
      let output: Awaited<ReturnType<typeof speechSocket>> | null | undefined;
      const pending: string[] = [];
      const delivery = speechPromise.then((socket) => {
        output = socket;
        for (const delta of pending) socket?.send(delta);
        pending.length = 0;
        return socket;
      });
      void delivery.catch(() => {});
      try {
        for await (const delta of translateText(
          data.text,
          data.sourceLanguage,
          data.targetLanguage,
          data.context,
          signal,
          data.followingText,
        )) {
          firstToken ??= performance.now() - start;
          text += delta;
          emit({ type: "text", delta });
          if (output === undefined) pending.push(delta);
          else output?.send(delta);
        }
        const speech = await delivery;
        if (speech) await speech.finish();
        const gate = await gatePromise;
        emit({
          type: "done",
          text,
          spoken: Boolean(speech),
          metrics: {
            translationMs: firstToken,
            gateMs: gate.elapsedMs,
            ttsFirstMs: firstAudio,
            readyMs: performance.now() - start,
          },
        });
      } catch (e) {
        if (!requestSignal.aborted && !abort.signal.aborted)
          emit({
            type: "error",
            message: deadline.aborted
              ? "La traduction met trop de temps à répondre. Réessaie."
              : e instanceof AppError
                ? e.message
                : "La traduction a été interrompue. Réessaie.",
            code: deadline.aborted
              ? "TIMEOUT"
              : e instanceof AppError
                ? e.code
                : "INTERPRETATION",
          });
      } finally {
        abort.abort();
        voice.current?.close();
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
