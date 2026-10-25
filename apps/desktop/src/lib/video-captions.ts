import { invoke } from "@tauri-apps/api/core";
import type { Turn } from "@interprete/shared/contracts";
import type { NativeInvoke } from "./calls";

export type CameraAuthorization = "authorized" | "denied" | "restricted" | "notDetermined";
// The cameras that can feed the video, and the virtual camera the call app reads.
export type CameraDevices = {
  authorization: CameraAuthorization;
  cameras: { id: string; name: string }[];
  virtualCamera: { name: string; installed: boolean; ready: boolean };
};
export type RelayStatus = {
  running: boolean;
  sessionId: string | null;
  camera: string | null;
  sink: string | null;
  frames: number;
  sent: number;
  delivered: number;
  error: string | null;
};
// Development builds can send a moving pattern instead of opening a camera.
export const TEST_PATTERN = "@synthetic";
export const VIRTUAL_CAMERA_NAME = "OBS Virtual Camera";
export const cameraDevices = () => invoke<CameraDevices>("camera_devices");
// Shows the macOS prompt the first time; afterwards answers from System Settings.
export const requestCameraAccess = () => invoke<boolean>("camera_access");
export const relayPreview = () => invoke<ArrayBuffer>("camera_relay_preview");

// Keeps the saved camera while it is connected, otherwise the first one.
export function chooseCamera(devices: CameraDevices, saved: string, testPattern = false) {
  if (testPattern && saved === TEST_PATTERN) return saved;
  return devices.cameras.some((camera) => camera.id === saved)
    ? saved
    : (devices.cameras[0]?.id ?? (testPattern ? TEST_PATTERN : ""));
}

// A pause this long clears the caption; the next words start a fresh one.
export const VIDEO_CAPTION_HOLD_MS = 5000;
// At most 1,800 UTF-8 bytes, under the native limit, and far more than the two lines on screen.
const MAX_CAPTION_LENGTH = 600;
type Passage = Pick<Turn, "id" | "translation">;

// Rolling captions: the unread words of the latest passages. The native side draws the last two
// lines; text only grows at the end and old passages leave whole, so lines do not re-wrap per word.
export function videoCaption(passages: readonly Passage[], read: ReadonlyMap<string, number>) {
  const unread = passages
    .map((passage) =>
      passage.translation
        .slice(read.get(passage.id) ?? 0)
        .replace(/^[\uDC00-\uDFFF]/, "")
        .replace(/\s+/g, " ")
        // Words resumed after a cleared caption do not start on the previous punctuation.
        .replace(read.has(passage.id) ? /^[\s,;:.!?、。，；：！？]+/ : /^\s+/, "")
        .trim(),
    )
    .filter(Boolean);
  while (unread.length > 1 && unread.join(" ").length > MAX_CAPTION_LENGTH) unread.shift();
  let text = unread.join(" ");
  if (text.length > MAX_CAPTION_LENGTH) {
    // One very long passage drops its start in large steps, on a word, so it rarely re-wraps.
    const step = 200;
    text = text
      .slice(Math.ceil((text.length - MAX_CAPTION_LENGTH) / step) * step)
      .replace(/^[\uDC00-\uDFFF]/, "");
    const space = text.indexOf(" ");
    if (space >= 0 && space < 40) text = text.slice(space + 1);
  }
  return text;
}

// Turns the user's translated passages into the caption drawn on their video.
export class VideoCaptionFeed {
  private read = new Map<string, number>();
  private passages: readonly Passage[] = [];
  private shown = "";
  private attached = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private send: (text: string) => void,
    private holdMs = VIDEO_CAPTION_HOLD_MS,
  ) {}
  get text() {
    return this.shown;
  }
  // A new session never shows passages from an earlier one.
  attach(passages: readonly Passage[]) {
    this.attached = true;
    this.markRead(passages);
    this.show("");
  }
  // The last words stay for the hold, then fade.
  detach() {
    this.attached = false;
  }
  update(passages: readonly Passage[]) {
    if (!this.attached) return;
    this.passages = passages;
    const text = videoCaption(passages, this.read);
    if (text !== this.shown) this.show(text);
  }
  clear() {
    this.attached = false;
    this.show("");
  }
  dispose() {
    this.attached = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private show(text: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = text ? setTimeout(() => this.expire(), this.holdMs) : null;
    if (text === this.shown) return;
    this.shown = text;
    this.send(text);
  }
  private expire() {
    this.timer = null;
    this.markRead(this.passages);
    this.show("");
  }
  private markRead(passages: readonly Passage[]) {
    this.passages = passages;
    this.read = new Map(passages.map((passage) => [passage.id, passage.translation.length]));
  }
}

export type VideoState = {
  // The relay session this window owns, from the first request until it stops.
  sessionId: string | null;
  starting: boolean;
  camera: string | null;
  // The detected call this video follows; it stops when that call ends.
  callId: string | null;
  error: string | null;
};
export const idleVideo: VideoState = {
  sessionId: null,
  starting: false,
  camera: null,
  callId: null,
  error: null,
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The camera relay for the call: the camera, with captions, sent to the virtual camera.
// Start and stop reach the native side in order, so a stop requested while the camera opens
// still releases it. Captions collapse to the newest text.
export class VideoRelay {
  private state: VideoState = idleVideo;
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  // The session the native relay runs for, read and written only by queued work.
  private owner: string | null = null;
  private live: string | null = null;
  private stops = 0;
  private latest = "";
  private pending: string | null = null;
  private sending = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  constructor(
    private call: NativeInvoke = invoke,
    private pollMs = 1000,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => idleVideo;
  private update(patch: Partial<VideoState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  // Starts the video unless it already runs. Resolves false when a stop, or `current` turning
  // false, cancels it while the camera or its permission is resolved: leaving call mode during
  // the macOS prompt must not open the camera afterwards.
  async ensure({
    callId = null,
    caption = () => "",
    camera,
    allow,
    current = () => true,
  }: {
    callId?: string | null;
    caption?: () => string;
    camera: () => Promise<string>;
    allow: (cameraId: string) => Promise<boolean>;
    current?: () => boolean;
  }) {
    const stops = this.stops;
    const cancelled = () => this.stops !== stops || !current();
    try {
      if (!this.state.sessionId) {
        const cameraId = await camera();
        if (cancelled()) return false;
        if (!cameraId) throw new Error("No camera found. Connect a camera, then refresh.");
        const allowed = await allow(cameraId);
        if (cancelled()) return false;
        if (!allowed)
          throw new Error(
            "Camera access is off. Allow Interprète in System Settings › Privacy & Security › Camera.",
          );
        if (!this.state.sessionId) await this.start({ cameraId, callId, caption: caption() });
      }
      // The video runs, possibly started meanwhile by another request: it follows this call,
      // unless that call ended or the request was cancelled first.
      if (cancelled() || !this.state.sessionId) return false;
      this.follow(callId);
      return true;
    } catch (error) {
      this.report(message(error));
      throw error;
    }
  }
  // Resolves false when a newer start or a stop replaced this one while the camera opened.
  async start({
    cameraId,
    callId = null,
    caption = "",
  }: {
    cameraId: string;
    callId?: string | null;
    caption?: string;
  }) {
    const sessionId = crypto.randomUUID();
    this.stopPolling();
    this.live = null;
    this.latest = caption;
    this.pending = null;
    this.update({ ...idleVideo, sessionId, starting: true, callId });
    try {
      await this.queue(async () => {
        if (this.state.sessionId !== sessionId) return;
        // Ties the start to this page: a start sent just before a reload is then refused.
        const page = await this.call<number>("camera_relay_page", {});
        if (this.state.sessionId !== sessionId) return;
        // A native start replaces the previous relay, even when it fails.
        this.owner = null;
        await this.call("camera_relay_start", { sessionId, cameraId, page });
        this.owner = sessionId;
      });
    } catch (error) {
      if (this.state.sessionId === sessionId) this.update({ ...idleVideo, error: message(error) });
      throw error;
    }
    if (this.state.sessionId !== sessionId) return false;
    this.live = sessionId;
    this.update({ starting: false });
    this.poll = setInterval(() => void this.check(sessionId), this.pollMs);
    if (this.latest) this.caption(this.latest);
    return true;
  }
  stop(error: string | null = null) {
    const sessionId = this.state.sessionId;
    this.stops += 1;
    this.stopPolling();
    this.live = null;
    this.latest = "";
    this.pending = null;
    if (sessionId || error !== this.state.error) this.update({ ...idleVideo, error });
    // Releases whatever the native side runs, including a start this one replaced mid-opening.
    return this.queue(async () => {
      const owner = this.owner;
      if (!owner || owner === this.state.sessionId) return;
      this.owner = null;
      await this.call("camera_relay_stop", { sessionId: owner });
    }).then(
      () => {},
      () => {},
    );
  }
  // Shows a failure that happened before any camera opened.
  report(error: string) {
    if (!this.state.sessionId) this.update({ error });
  }
  // A video started before a call stops with that call once translation adopts it.
  follow(callId: string | null) {
    if (callId && this.state.sessionId && !this.state.callId) this.update({ callId });
  }
  dismissError() {
    if (this.state.error) this.update({ error: null });
  }
  caption(text: string) {
    if (!this.state.sessionId) return;
    this.latest = text;
    // Captions requested while the camera opens are sent once it runs.
    if (this.live !== this.state.sessionId) return;
    this.pending = text;
    if (!this.sending) void this.flush();
  }
  dispose() {
    void this.stop();
  }
  private async flush() {
    this.sending = true;
    while (this.pending !== null && this.live) {
      const text = this.pending;
      const sessionId = this.live;
      this.pending = null;
      try {
        await this.call("camera_relay_caption", { sessionId, text });
      } catch (error) {
        if (this.live === sessionId) this.update({ error: `The video captions stopped: ${message(error)}` });
      }
    }
    this.sending = false;
  }
  // Camera failures surface here: a disconnection, or no image for a few seconds.
  private async check(sessionId: string) {
    let status: RelayStatus;
    try {
      status = await this.call<RelayStatus>("camera_relay_status", {});
    } catch {
      return;
    }
    if (this.live !== sessionId) return;
    if (status.sessionId !== sessionId || !status.running) void this.stop(status.error);
    else if (status.error) void this.stop(status.error);
    else if (status.camera !== this.state.camera) this.update({ camera: status.camera });
  }
  private stopPolling() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }
  private queue<T>(work: () => Promise<T>) {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
}
