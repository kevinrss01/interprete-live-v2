import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { Phase } from "@interprete/shared/contracts";

export type OverlayUpdate = {
  sessionId: string | null;
  phase: Phase | "preview";
  source: string;
  target: string;
  test: boolean;
};
export type OverlaySnapshot = OverlayUpdate & {
  revision: number;
  stopRequested: boolean;
};
export const idleOverlay: OverlayUpdate = {
  sessionId: null,
  phase: "idle",
  source: "",
  target: "",
  test: false,
};
export type OverlayInvoke = <T>(
  command: string,
  args: Record<string, unknown>,
) => Promise<T>;

export class OverlayPublisher {
  private tail = Promise.resolve();
  constructor(private call: OverlayInvoke = invoke) {}
  publish(update: OverlayUpdate | null) {
    const pending = this.tail.then(() =>
      this.call<void>("set_translation_overlay", {
        update: update ?? idleOverlay,
      }),
    );
    this.tail = pending.catch(() => {});
    return pending;
  }
}
export const getOverlay = () =>
  invoke<OverlaySnapshot>("translation_overlay_snapshot");
export const stopOverlay = (sessionId: string) =>
  invoke<OverlaySnapshot>("stop_translation_overlay", { sessionId });
export const onOverlay = (listener: (state: OverlaySnapshot) => void) =>
  listen<OverlaySnapshot>("translation-overlay-state", (event) =>
    listener(event.payload),
  );
export function newestOverlay(
  current: OverlaySnapshot | null,
  incoming: OverlaySnapshot,
) {
  return current && current.revision > incoming.revision ? current : incoming;
}
// One publisher owns the global native window, regardless of which interpreter is active.
export function useTranslationOverlay(
  update: OverlayUpdate | null,
  onStop: (sessionId: string) => void,
  onError: (message: string | null) => void,
) {
  const [publisher] = useState(() => new OverlayPublisher());
  const native = isTauri();
  const latest = useRef({ sessionId: update?.sessionId, onStop });
  latest.current = { sessionId: update?.sessionId, onStop };
  const sessionId = update?.sessionId ?? null;
  const phase = update?.phase ?? "idle";
  const source = update?.source ?? "";
  const target = update?.target ?? "";
  const test = update?.test ?? false;
  useEffect(() => {
    if (!native) return;
    void publisher.publish({ sessionId, phase, source, target, test }).then(
      () => onError(null),
      (error: unknown) =>
        onError(`La pastille n’a pas pu être affichée : ${String(error)}`),
    );
  }, [native, publisher, sessionId, phase, source, target, test, onError]);
  useEffect(() => {
    if (!native) return;
    let active = true;
    const subscription = listen<string>("translation-overlay-stop", (event) => {
      if (active && event.payload === latest.current.sessionId)
        latest.current.onStop(event.payload);
    });
    return () => {
      active = false;
      void subscription.then(
        (off) => off(),
        () => {},
      );
    };
  }, [native]);
  useEffect(
    () => () => {
      if (native) void publisher.publish(null).catch(() => {});
    },
    [native, publisher],
  );
}
