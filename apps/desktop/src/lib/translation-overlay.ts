import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { Phase } from "@interprete/shared/contracts";

export type OverlayUpdate = {
  sessionId: string | null;
  phase: Phase | "preview" | "paused";
  source: string;
  target: string;
  test: boolean;
  bidirectional?: boolean;
};
export type OverlaySnapshot = OverlayUpdate & {
  revision: number;
  stopRequested: boolean;
  expanded?: boolean;
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
export const expandOverlayOptions = (sessionId: string, expanded: boolean) =>
  invoke<OverlaySnapshot>("expand_translation_options", { sessionId, expanded });
export const openOverlaySettings = (sessionId: string) =>
  invoke<void>("open_translation_options", { sessionId });
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
  onOptions: (sessionId: string) => void,
) {
  const [publisher] = useState(() => new OverlayPublisher());
  const native = isTauri();
  const latest = useRef({ sessionId: update?.sessionId, onStop, onOptions });
  latest.current = { sessionId: update?.sessionId, onStop, onOptions };
  const sessionId = update?.sessionId ?? null;
  const phase = update?.phase ?? "idle";
  const source = update?.source ?? "";
  const target = update?.target ?? "";
  const test = update?.test ?? false;
  const bidirectional = update?.bidirectional ?? false;
  useEffect(() => {
    if (!native) return;
    void publisher.publish({ sessionId, phase, source, target, test, bidirectional }).then(
      () => onError(null),
      (error: unknown) =>
        onError(`The pill could not be shown: ${String(error)}`),
    );
  }, [native, publisher, sessionId, phase, source, target, test, bidirectional, onError]);
  useEffect(() => {
    if (!native) return;
    let active = true;
    const subscription = listen<string>("translation-overlay-stop", (event) => {
      if (active && event.payload === latest.current.sessionId)
        latest.current.onStop(event.payload);
    });
    const optionsSubscription = listen<string>("translation-overlay-options", (event) => {
      if (active && event.payload === latest.current.sessionId)
        latest.current.onOptions(event.payload);
    });
    return () => {
      active = false;
      void subscription.then(
        (off) => off(),
        () => {},
      );
      void optionsSubscription.then((off) => off(), () => {});
    };
  }, [native]);
  useEffect(
    () => () => {
      if (native) void publisher.publish(null).catch(() => {});
    },
    [native, publisher],
  );
}
