import type { z } from "zod";
import type { InterpretationEvent } from "@interprete/shared/contracts";
import { usablePrefix } from "@interprete/shared/live-segments";
import { translateText, evaluateReadiness } from "./openai";
import { speechSocket } from "./eleven";
import { AppError } from "./errors";
import { SilenceTrimmer } from "./pcm";
import type { interpretSchema } from "./validation";
type Interpretation = z.infer<typeof interpretSchema>;
// Jev is only asked when its answer can change the decision: a final remainder is always
// spoken, an unusable prefix never is, and a finished sentence needs no estimate.
function localDecision(data: Interpretation) {
  if (data.isFinal) return "final";
  if (!usablePrefix(data.text, data.followingText, data.sourceLanguage)) return "wait";
  if (/[.!?。！？]$/u.test(data.text)) return "ready";
  return null;
}
// Translated speech still queued when the next fragment is requested is voiced a little
// faster, so the delay behind the speaker shrinks instead of accumulating. Speech that has
// caught up keeps the voice's natural pace; 1.2 is the voice provider's maximum.
export function catchUpPace(queuedSeconds: number) {
  return Math.round(100 * Math.min(1.2, 1 + Math.max(0, queuedSeconds - 0.5) * 0.1)) / 100;
}
// Streams translation text and synthesized audio as SSE while the speaker is still talking.
// A null voice streams text only, for captions.
export function interpretResponse(
  data: Interpretation,
  voiceId: string | null,
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
        firstAudio: number | undefined,
        rejected = false;
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
      // A held-back fragment stops its translation and synthesis at once, so the
      // client can offer the next, longer fragment without waiting for wasted work.
      const work = new AbortController();
      const workSignal = AbortSignal.any([signal, work.signal]);
      const local = localDecision(data);
      const gatePromise = local
        ? Promise.resolve({ probability: null, elapsedMs: 0, unavailable: false })
        : evaluateReadiness(
            data.text,
            signal,
            data.followingText,
            data.context.at(-1)?.source || "",
          );
      const permission = gatePromise.then((g) => {
        const ready = local
          ? local !== "wait"
          : !g.unavailable && g.probability !== null && g.probability >= 0.6;
        emit({
          type: "gate",
          decision: data.isFinal ? "final" : ready ? "ready" : "wait",
          ...g,
        });
        if (!ready) {
          rejected = true;
          work.abort();
        }
        return ready;
      });
      // Final turns don't await this derived promise; cancellation must still be handled.
      void permission.catch(() => {});
      const queued = data.queued ?? 0;
      const trimmer = new SilenceTrimmer({ playhead: start + queued * 1000 });
      const sendAudio = (audio: Buffer) => {
        if (!audio.length) return;
        firstAudio ??= performance.now() - start;
        emit({ type: "audio", audio: audio.toString("base64"), sampleRate: 24000 });
      };
      // Establish the idle TTS socket while the LLM and readiness check run.
      const socketPromise =
        voiceId === null || local === "wait"
          ? Promise.resolve(null)
          : speechSocket(voiceId, data.targetLanguage, workSignal, (audio) =>
              sendAudio(trimmer.push(Buffer.from(audio, "base64"))), catchUpPace(queued),
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
          socket?.close();
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
        if (local !== "wait")
          for await (const delta of translateText(
            data.text,
            data.sourceLanguage,
            data.targetLanguage,
            data.context,
            workSignal,
          )) {
            firstToken ??= performance.now() - start;
            text += delta;
            emit({ type: "text", delta });
            if (output === undefined) pending.push(delta);
            else output?.send(delta);
          }
        const ready = await permission;
        const speech = ready ? await delivery : null;
        if (speech) {
          await speech.finish();
          sendAudio(trimmer.end());
        }
        const gate = await gatePromise;
        emit({
          type: "done",
          text: ready ? text : "",
          spoken: Boolean(speech),
          metrics: {
            translationMs: firstToken,
            gateMs: gate.elapsedMs,
            ttsFirstMs: firstAudio,
            readyMs: performance.now() - start,
          },
        });
      } catch (e) {
        if (rejected && !requestSignal.aborted && !abort.signal.aborted)
          emit({
            type: "done",
            text: "",
            spoken: false,
            metrics: {
              translationMs: firstToken,
              gateMs: (await gatePromise.catch(() => null))?.elapsedMs,
              readyMs: performance.now() - start,
            },
          });
        else if (!requestSignal.aborted && !abort.signal.aborted)
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
