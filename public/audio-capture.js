class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(480);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.energy = 0;
    this.energyCount = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  flush() {
    if (!this.index) return;
    const pcm = this.buffer.slice(0, this.index);
    this.port.postMessage(
      {
        type: "audio",
        pcm: pcm.buffer,
        rms: Math.sqrt(this.energy / Math.max(1, this.energyCount)),
      },
      [pcm.buffer],
    );
    this.index = 0;
    this.energy = 0;
    this.energyCount = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    for (const channel of outputs[0] || []) channel.fill(0);
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.phase += 24000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.buffer[this.index++] = value < 0 ? value * 32768 : value * 32767;
        this.energy += value * value;
        this.energyCount++;
        if (this.index === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("speech-capture", SpeechCapture);
