class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pendingInput = [];
    this.pendingOutput = [];
    this.resampleRatio = sampleRate / 16000;
    this.sourcePosition = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      this.pendingInput.push(sample);
    }

    const chunkSize = 1600;
    while (this.sourcePosition + 1 < this.pendingInput.length) {
      const left = Math.floor(this.sourcePosition);
      const fraction = this.sourcePosition - left;
      const sample = this.pendingInput[left] +
        (this.pendingInput[left + 1] - this.pendingInput[left]) * fraction;
      this.pendingOutput.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      this.sourcePosition += this.resampleRatio;
    }

    const consumed = Math.floor(this.sourcePosition);
    this.pendingInput.splice(0, consumed);
    this.sourcePosition -= consumed;

    while (this.pendingOutput.length >= chunkSize) {
      const pcm = new Int16Array(this.pendingOutput.splice(0, chunkSize));
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
