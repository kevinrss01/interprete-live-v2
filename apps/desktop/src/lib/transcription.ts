import { bytesToBase64 } from "./audio";
import { api, call } from "./api";

export type Transcript = {
  id: string;
  sequence: number;
  startedAt: number;
  text: string;
  final: boolean;
  revised: boolean;
  replaying: boolean;
};
export type ConnectionState = "connecting" | "connected" | "reconnecting";
export type StreamTiming = {
  checkpointMs: number;
  renewMs: number;
  retryMs: number;
  finalTimeoutMs: number;
  connectTimeoutMs: number;
  maxBufferedMs: number;
};
const defaults: StreamTiming = {
  checkpointMs: 30_000,
  renewMs: 45 * 60_000,
  retryMs: 300,
  finalTimeoutMs: 10_000,
  connectTimeoutMs: 10_000,
  maxBufferedMs: 60_000,
};
type Chunk = {
  id: string;
  sequence: number;
  startedAt: number;
  text: string;
  audio: Uint8Array[];
  bytes: number;
  closed: boolean;
  final: boolean;
  owner: Connection | null;
  timer?: ReturnType<typeof setTimeout>;
};
type Slot = {
  chunk: Chunk;
  text: string;
  previousText: string;
  itemId?: string;
  replay: boolean;
};
type Connection = {
  ws: WebSocket;
  abort: AbortController;
  ready: boolean;
  retired: boolean;
  draining: boolean;
  slots: Slot[];
  commits: Slot[];
  items: Map<string, Slot>;
};
type Options = {
  language: string;
  initialId: string;
  signal: AbortSignal;
  onTranscript: (item: Transcript) => void;
  onConnection: (state: ConnectionState) => void;
  onWarning: (message: string) => void;
  timing?: Partial<StreamTiming>;
};

// The microphone has one lifetime. ASR items and sockets have independent,
// shorter lifetimes, so committing or replacing a socket never stops capture.
export class ContinuousTranscription {
  private timing: StreamTiming;
  private chunks: Chunk[] = [];
  private active: Chunk | null = null;
  private main: Connection | null = null;
  private connections = new Set<Connection>();
  private connecting: Promise<void> | null = null;
  private warming = false;
  private renewal: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private stopped = false;
  private finishing = false;
  private everConnected = false;
  private finished: (() => void) | null = null;
  private onAbort = () => this.close();

  constructor(private options: Options) {
    this.timing = { ...defaults, ...options.timing };
    options.signal.addEventListener("abort", this.onAbort, { once: true });
  }

  start() {
    return this.ensureConnected();
  }

  append(bytes: Uint8Array) {
    if (this.stopped || this.finishing || !bytes.length) return;
    if (!this.active) {
      this.active = {
        id: this.sequence ? crypto.randomUUID() : this.options.initialId,
        sequence: this.sequence++,
        startedAt: performance.now(),
        text: "",
        audio: [],
        bytes: 0,
        closed: false,
        final: false,
        owner: null,
      };
      this.chunks.push(this.active);
      this.notify(this.active);
    }
    const chunk = this.active;
    chunk.audio.push(bytes);
    chunk.bytes += bytes.length;
    if (this.main?.ready) this.sendAudio(this.main, chunk, bytes);
    if (chunk.bytes / 48 >= this.timing.checkpointMs) this.checkpoint();
    this.boundBuffer();
  }

  // A speech pause finalizes an ASR item, never the microphone or the output.
  checkpoint(force = false) {
    const chunk = this.active;
    if (!chunk) return;
    if (chunk.bytes < 4_800) {
      if (!force) return;
      const padding = new Uint8Array(4_800 - chunk.bytes);
      chunk.audio.push(padding);
      chunk.bytes += padding.length;
      if (chunk.owner?.ready) this.sendAudio(chunk.owner, chunk, padding);
    }
    this.active = null;
    chunk.closed = true;
    if (chunk.owner?.ready) this.commit(chunk.owner, chunk);
  }

  private notify(chunk: Chunk, revised = false, replaying = false) {
    this.options.onTranscript({
      id: chunk.id,
      sequence: chunk.sequence,
      startedAt: chunk.startedAt,
      text: chunk.text,
      final: chunk.final,
      revised,
      replaying,
    });
  }

  private slot(connection: Connection, chunk: Chunk) {
    let slot = connection.slots.find((entry) => entry.chunk === chunk);
    if (!slot) {
      slot = {
        chunk,
        text: "",
        previousText: chunk.text,
        replay: Boolean(chunk.text),
      };
      connection.slots.push(slot);
      chunk.owner = connection;
    }
    return slot;
  }

  private sendAudio(connection: Connection, chunk: Chunk, bytes: Uint8Array) {
    if (connection.retired) return;
    // A reconnect can enqueue the whole retained minute in one JS turn. Allow
    // its base64 payload plus event framing before judging a socket congested.
    const maxSocketBytes = Math.max(1_048_576, this.timing.maxBufferedMs * 72);
    if (connection.ws.readyState !== WebSocket.OPEN || connection.ws.bufferedAmount > maxSocketBytes) {
      this.reconnect();
      return;
    }
    this.slot(connection, chunk);
    try {
      connection.ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: bytesToBase64(bytes),
      }));
    } catch {
      this.reconnect();
    }
  }

  private commit(connection: Connection, chunk: Chunk) {
    if (connection.retired || !chunk.bytes) return;
    const slot = this.slot(connection, chunk);
    if (connection.commits.includes(slot)) return;
    connection.commits.push(slot);
    try {
      connection.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      chunk.timer = setTimeout(() => this.reconnect(), this.timing.finalTimeoutMs);
    } catch {
      this.reconnect();
    }
  }

  private assign(connection: Connection, slot: Slot, itemId: string) {
    slot.itemId = itemId;
    connection.items.set(itemId, slot);
  }

  private receive(connection: Connection, data: Record<string, unknown>) {
    if (this.stopped || connection.retired) return;
    const type = data.type;
    const itemId = typeof data.item_id === "string" ? data.item_id : "";
    if (type === "input_audio_buffer.committed") {
      const slot = connection.commits.shift();
      if (slot && itemId) this.assign(connection, slot, itemId);
      return;
    }
    if (type !== "conversation.item.input_audio_transcription.delta" &&
        type !== "conversation.item.input_audio_transcription.completed") return;
    const slot = connection.items.get(itemId) ?? connection.slots.find((entry) => !entry.itemId);
    if (!slot || slot.chunk.final) return;
    if (itemId && !slot.itemId) this.assign(connection, slot, itemId);
    const chunk = slot.chunk;
    if (type === "conversation.item.input_audio_transcription.delta") {
      slot.text += String(data.delta ?? "");
      // Hide the replayed prefix until ASR catches up with text already shown/spoken.
      const catchingUp = slot.replay && slot.text.length < slot.previousText.length;
      if (!catchingUp) chunk.text = slot.text;
      this.notify(chunk, slot.replay, catchingUp);
      if (!catchingUp) slot.replay = false;
    } else {
      this.finalize(chunk, String(data.transcript ?? slot.text ?? chunk.text));
      connection.slots = connection.slots.filter((entry) => entry !== slot);
      connection.commits = connection.commits.filter((entry) => entry !== slot);
      if (slot.itemId) connection.items.delete(slot.itemId);
      if (connection.draining && !connection.slots.length) this.retire(connection);
    }
  }

  private finalize(chunk: Chunk, text: string) {
    if (chunk.final) return;
    clearTimeout(chunk.timer);
    chunk.text = text;
    chunk.final = true;
    chunk.audio = [];
    chunk.bytes = 0;
    if (this.active === chunk) this.active = null;
    this.chunks = this.chunks.filter((entry) => entry !== chunk);
    this.notify(chunk, true);
    if (!this.chunks.length) this.finished?.();
  }

  private async open(): Promise<Connection> {
    const abort = new AbortController();
    const signal = AbortSignal.any([this.options.signal, abort.signal, AbortSignal.timeout(this.timing.connectTimeoutMs)]);
    const session = await call(
      api.api.session.$post({ json: { language: this.options.language } }, { init: { signal } }),
    );
    signal.throwIfAborted();
    if (this.stopped) throw new DOMException("Stopped", "AbortError");
    const connection: Connection = {
      ws: new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", [
        "realtime", "openai-insecure-api-key." + session.token,
      ]),
      abort, ready: false, retired: false, draining: false,
      slots: [], commits: [], items: new Map(),
    };
    this.connections.add(connection);
    return new Promise<Connection>((resolve, reject) => {
      let settled = false;
      const rejectOpen = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.retire(connection);
          reject(new Error("La connexion de transcription est indisponible."));
        } else if (!connection.retired) this.reconnect();
      };
      const timer = setTimeout(rejectOpen, this.timing.connectTimeoutMs);
      abort.signal.addEventListener("abort", rejectOpen, { once: true });
      connection.ws.onclose = rejectOpen;
      connection.ws.onerror = rejectOpen;
      connection.ws.onmessage = (event) => {
        if (connection.retired || this.stopped) return;
        let data: Record<string, unknown>;
        try { data = JSON.parse(String(event.data)); } catch { return; }
        if (data.type === "session.created" && !settled) {
          settled = true;
          clearTimeout(timer);
          connection.ready = true;
          resolve(connection);
        } else if (data.type === "error" || data.type === "conversation.item.input_audio_transcription.failed") {
          rejectOpen();
        } else this.receive(connection, data);
      };
    });
  }

  private ensureConnected(): Promise<void> {
    if (this.main?.ready || this.stopped) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const work = (async () => {
      let attempts = 0;
      while (!this.stopped && !this.main) {
        this.options.onConnection(this.everConnected || attempts ? "reconnecting" : "connecting");
        try {
          const connection = await this.open();
          if (this.stopped) { this.retire(connection); return; }
          this.main = connection;
          for (const chunk of this.chunks) {
            for (const bytes of chunk.audio) {
              this.sendAudio(connection, chunk, bytes);
              if (connection.retired) break;
            }
            if (connection.retired) break;
            if (chunk.closed) this.commit(connection, chunk);
          }
          if (connection.retired) throw new Error("La reprise audio a été interrompue.");
          this.everConnected = true;
          this.options.onConnection("connected");
          this.armRenewal();
        } catch {
          if (this.stopped) return;
          const delay = Math.min(5_000, this.timing.retryMs * 2 ** Math.min(attempts++, 5));
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); this.options.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, delay);
            this.options.signal.addEventListener("abort", done, { once: true });
          });
        }
      }
    })();
    this.connecting = work;
    void work.finally(() => { if (this.connecting === work) this.connecting = null; });
    return work;
  }

  private armRenewal() {
    if (this.renewal) clearTimeout(this.renewal);
    if (!this.finishing && !this.stopped)
      this.renewal = setTimeout(() => void this.renew(), this.timing.renewMs);
  }

  private async renew() {
    if (this.warming || !this.main || this.finishing || this.stopped) return;
    this.warming = true;
    const previous = this.main;
    try {
      const next = await this.open();
      if (this.stopped || this.finishing || this.main !== previous) {
        this.retire(next);
        return;
      }
      // Warm first, then switch routing synchronously. No capture frame is discarded.
      this.checkpoint(true);
      this.main = next;
      previous.draining = true;
      if (!previous.slots.length) this.retire(previous);
      this.armRenewal();
    } catch {
      if (!this.stopped && !this.finishing)
        this.renewal = setTimeout(() => void this.renew(), 2_000);
    } finally {
      this.warming = false;
    }
  }

  private reconnect() {
    if (this.stopped) return;
    this.main = null;
    if (this.renewal) clearTimeout(this.renewal);
    for (const connection of this.connections) this.retire(connection);
    for (const chunk of this.chunks) {
      clearTimeout(chunk.timer);
      chunk.owner = null;
    }
    this.options.onConnection("reconnecting");
    // Yield so a failing initial replay can finish its current connection attempt.
    queueMicrotask(() => { if (!this.stopped) void this.ensureConnected(); });
  }

  private retire(connection: Connection) {
    if (connection.retired) return;
    connection.retired = true;
    connection.ready = false;
    this.connections.delete(connection);
    connection.abort.abort();
    connection.ws.close();
  }

  private boundBuffer() {
    let bytes = this.chunks.reduce((total, chunk) => total + chunk.bytes, 0);
    const limit = this.timing.maxBufferedMs * 48;
    for (const chunk of [...this.chunks]) {
      if (bytes <= limit) break;
      if (!chunk.closed) break;
      bytes -= chunk.bytes;
      this.options.onWarning("Connexion interrompue plus d’une minute : une partie de l’audio n’a pas pu être transcrite. Le micro reste actif.");
      this.finalize(chunk, chunk.text);
    }
  }

  async finish() {
    if (this.stopped) return;
    this.finishing = true;
    if (this.renewal) clearTimeout(this.renewal);
    // OpenAI requires at least 100 ms on commit, including a very quick manual stop.
    if (this.active && this.active.bytes < 4_800) {
      const padding = new Uint8Array(4_800 - this.active.bytes);
      this.active.audio.push(padding);
      this.active.bytes += padding.length;
      if (this.main?.ready) this.sendAudio(this.main, this.active, padding);
    }
    this.checkpoint();
    if (this.chunks.length) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.timing.finalTimeoutMs);
        this.finished = () => { clearTimeout(timer); resolve(); };
      });
    }
    for (const chunk of [...this.chunks]) this.finalize(chunk, chunk.text);
    this.close();
  }

  close() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.renewal) clearTimeout(this.renewal);
    for (const chunk of this.chunks) clearTimeout(chunk.timer);
    for (const connection of this.connections) this.retire(connection);
    this.main = null;
    this.active = null;
    this.chunks = [];
    this.finished?.();
    this.options.signal.removeEventListener("abort", this.onAbort);
  }
}
