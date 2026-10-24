import assert from "node:assert/strict";
import test from "node:test";
import { MicrophoneCapture, type CaptureOptions } from "../src/lib/audio";

test("sample monitoring toggles independently of transcription and disconnects immediately on stop", async () => {
  const originalFetch = globalThis.fetch;
  const originalWorklet = globalThis.AudioWorkletNode;
  const connections: unknown[] = [];
  const gain = {
    gain: { value: 0, setTargetAtTime(value: number) { this.value = value; } },
    connected: false,
    connect() { this.connected = true; },
    disconnect() { this.connected = false; },
  };
  const source = { buffer: null, onended: null, starts: 0,
    connect: (node: unknown) => connections.push(node),
    disconnect: () => {}, start() { this.starts++; } };
  let worklet!: { port: { onmessage: (event: unknown) => void; postMessage: () => void } };
  class Worklet {
    port = { onmessage: (_event: unknown) => {}, postMessage: () => this.port.onmessage({ data: { type: "flushed" } }) };
    constructor() { worklet = this; }
    connect() {}
    disconnect() {}
  }
  const context = {
    currentTime: 0, destination: {}, resume: async () => {},
    audioWorklet: { addModule: async () => {} },
    decodeAudioData: async () => ({}),
    createBufferSource: () => source, createGain: () => gain,
  };
  const received: number[] = [];
  const options: CaptureOptions = {
    demoUrl: "/samples/nasa-en.wav", recordSample: false,
    context: context as unknown as AudioContext,
    onAudio: (bytes) => received.push(bytes.length),
    onLevel: () => {}, onEnded: () => {}, onError: assert.fail,
  };
  const capture = new MicrophoneCapture(options);
  globalThis.fetch = async () => new Response(new ArrayBuffer(4));
  globalThis.AudioWorkletNode = Worklet as unknown as typeof AudioWorkletNode;
  try {
    await capture.start();
    assert.equal(gain.gain.value, 0, "silent by default");
    assert.equal(source.starts, 1);
    assert.deepEqual(connections, [worklet, gain]);
    capture.setDemoAudible(true);
    assert.equal(gain.gain.value, 1);
    worklet.port.onmessage({ data: { type: "audio", pcm: new ArrayBuffer(960), rms: 0.1 } });
    capture.setDemoAudible(false);
    assert.equal(gain.gain.value, 0);
    worklet.port.onmessage({ data: { type: "audio", pcm: new ArrayBuffer(960), rms: 0.1 } });
    assert.deepEqual(received, [960, 960], "muting never interrupts ASR input");
    assert.equal(source.starts, 1, "toggling never restarts the clip");
    capture.setDemoAudible(true);
    const stopped = capture.stop();
    assert.equal(gain.connected, false, "mute before waiting for the worklet to flush");
    await stopped;
  } finally {
    await capture.stop();
    globalThis.fetch = originalFetch;
    globalThis.AudioWorkletNode = originalWorklet;
  }
});
