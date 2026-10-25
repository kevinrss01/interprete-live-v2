import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type WebSocket from "ws";
import { speechSocket } from "../src/lib/eleven";

process.env.ELEVENLABS_API_KEY = "mock-key";
class Socket extends EventEmitter {
  readyState = 0;
  terminated = false;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.terminated = true; this.close(); }
  open() { this.readyState = 1; this.emit("open"); }
}
const connect = (socket: Socket) => () => socket as unknown as WebSocket;

test("a socket closed before opening rejects instead of leaving the handshake pending", async () => {
  const socket = new Socket();
  const pending = speechSocket("test-voice", "fr", new AbortController().signal, () => {}, 1, { connect: connect(socket) });
  socket.close();
  await assert.rejects(pending, { code: "VOICE_CLOSED" });
  assert.equal(socket.terminated, true);
});

test("an aborted handshake and a peer that never opens both release their sockets", async () => {
  for (const cancel of [true, false]) {
    const socket = new Socket(), abort = new AbortController();
    const pending = speechSocket("test-voice", "fr", abort.signal, () => {}, 1,
      { connect: connect(socket), connectTimeoutMs: 15 });
    if (cancel) abort.abort();
    await assert.rejects(pending, { code: cancel ? "ABORTED" : "VOICE_TIMEOUT" });
    assert.equal(socket.terminated, true);
  }
});

test("a peer that never finalizes cannot hold the next translation indefinitely", async () => {
  const socket = new Socket();
  const pending = speechSocket("test-voice", "fr", new AbortController().signal, () => {}, 1,
    { connect: connect(socket), finishTimeoutMs: 15 });
  socket.open();
  const speech = await pending;
  speech.send("Synthetic words.");
  await assert.rejects(speech.finish(), { code: "VOICE_TIMEOUT" });
  assert.equal(socket.terminated, true);
});

test("final audio settles once and late packets after completion are ignored", async () => {
  const socket = new Socket();
  let packets = 0;
  const pending = speechSocket("test-voice", "fr", new AbortController().signal, () => { packets++; }, 1, { connect: connect(socket) });
  socket.open();
  const speech = await pending;
  const finishing = speech.finish();
  socket.emit("message", JSON.stringify({ audio: "AAA=", isFinal: true }));
  await finishing;
  socket.emit("message", JSON.stringify({ audio: "AAA=" }));
  assert.equal(packets, 1);
  assert.equal(socket.terminated, true);
});
