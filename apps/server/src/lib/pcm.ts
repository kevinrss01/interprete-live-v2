// Removes the silence the voice provider pads around each synthesized fragment.
// Fragments play back to back, so that padding otherwise accumulates as lag behind
// the speaker. Audible samples are never delayed: only quiet samples wait, until
// more audio arrives (a pause inside the fragment) or the fragment ends.
export class SilenceTrimmer {
  private readonly threshold: number;
  private readonly sampleRate: number;
  private readonly leadBytes: number;
  private readonly tailBytes: number;
  private started = false;
  private carry: Buffer | null = null;
  private quiet = Buffer.alloc(0);
  // When the listener finishes playing everything returned so far, if each packet plays as
  // soon as it is returned, after the audio already queued on their side. The quiet held
  // after that audio would start playing then.
  private playhead: number;
  constructor({
    threshold = 330,
    leadMs = 20,
    tailMs = 60,
    sampleRate = 24000,
    playhead = 0,
  }: { threshold?: number; leadMs?: number; tailMs?: number; sampleRate?: number; playhead?: number } = {}) {
    this.threshold = threshold;
    this.sampleRate = sampleRate;
    this.leadBytes = Math.round((leadMs * sampleRate) / 1000) * 2;
    this.tailBytes = Math.round((tailMs * sampleRate) / 1000) * 2;
    this.playhead = playhead;
  }
  // 16-bit little-endian mono PCM in, audio that can be played right away out.
  push(input: Buffer, now = performance.now()) {
    let bytes = this.carry ? Buffer.concat([this.carry, input]) : input;
    this.carry = null;
    if (bytes.length % 2) {
      this.carry = Buffer.from(bytes.subarray(bytes.length - 1));
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    let last = -1;
    for (let at = bytes.length - 2; at >= 0; at -= 2)
      if (this.audible(bytes, at)) {
        last = at;
        break;
      }
    if (last < 0) {
      this.quiet = Buffer.concat([this.quiet, bytes]);
      // Before the first word, only a short lead-in is worth keeping.
      if (!this.started && this.quiet.length > this.leadBytes)
        this.quiet = this.quiet.subarray(this.quiet.length - this.leadBytes);
      return Buffer.alloc(0);
    }
    let ready = Buffer.concat([this.quiet, bytes.subarray(0, last + 2)]);
    let first = 0;
    while (!this.audible(ready, first)) first += 2;
    if (this.started) {
      // Part of the pause before these words may already have reached the listener as a gap
      // in playback, when the provider was slower to send them than the listener to play what
      // came before: only the rest of the pause is played.
      const elapsed = Math.round(((now - this.playhead) * this.sampleRate) / 1000) * 2;
      ready = ready.subarray(Math.min(first, Math.max(0, elapsed)));
    } else {
      ready = ready.subarray(Math.max(0, first - this.leadBytes));
      this.started = true;
    }
    this.playhead = Math.max(this.playhead, now) + (ready.length / 2 / this.sampleRate) * 1000;
    this.quiet = Buffer.from(bytes.subarray(last + 2));
    return ready;
  }
  // Keeps a short natural tail and drops the rest of the closing silence.
  end() {
    const tail = this.started ? Buffer.from(this.quiet.subarray(0, this.tailBytes)) : Buffer.alloc(0);
    this.started = false;
    this.carry = null;
    this.quiet = Buffer.alloc(0);
    return tail;
  }
  private audible(bytes: Buffer, at: number) {
    return Math.abs(bytes.readInt16LE(at)) > this.threshold;
  }
}
