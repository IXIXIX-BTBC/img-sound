// Safety limiter: the very last stage before the speakers, for the ears.
//  Ceiling -1 dBFS. Below it the sound passes untouched (gain exactly 1).
//  Look-ahead 1.5 ms: the output is delayed a little so the gain can come down *before* a loud peak arrives
//  (no clipped edge). Release 80 ms. A hard clamp at the ceiling catches anything left over, and broken numbers
//  (NaN / Infinity) become silence.
class SafetyLimiter extends (globalThis.AudioWorkletProcessor || class {}) {
  constructor() {
    super();
    const sr = globalThis.sampleRate || 48000;
    this.N = Math.max(8, Math.round(sr * 0.0015));
    this.ceil = Math.pow(10, -1 / 20);
    this.bufL = new Float32Array(this.N); this.bufR = new Float32Array(this.N); this.req = new Float32Array(this.N).fill(1);
    this.w = 0; this.g = 1; this.minGain = 1;
    this.att = 1 - Math.exp(-1 / (this.N / 5)); // reaches the needed gain within the look-ahead
    this.rel = 1 - Math.exp(-1 / (sr * 0.08));
    this.t = 0;
    this.port.onmessage = () => {};
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], oL = out[0], oR = out[1] || out[0];
    const iL = inp && inp[0], iR = inp && (inp[1] || inp[0]);
    const N = this.N, C = this.ceil;
    for (let i = 0; i < oL.length; i++) {
      let l = iL ? iL[i] : 0, r = iR ? iR[i] : 0;
      if (!(Math.abs(l) < 1e6)) l = 0; if (!(Math.abs(r) < 1e6)) r = 0;
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const w = this.w;
      const dl = this.bufL[w], dr = this.bufR[w]; // the sample from N samples ago comes out now
      this.bufL[w] = l; this.bufR[w] = r; this.req[w] = pk > C ? C / pk : 1;
      this.w = w + 1 === N ? 0 : w + 1;
      let m = 1; for (let k = 0; k < N; k++) if (this.req[k] < m) m = this.req[k]; // lowest gain needed in the window
      this.g += (m - this.g) * (m < this.g ? this.att : this.rel);
      let yl = dl * this.g, yr = dr * this.g;
      yl = yl > C ? C : yl < -C ? -C : yl; yr = yr > C ? C : yr < -C ? -C : yr;
      oL[i] = yl; if (oR !== oL) oR[i] = yr;
      if (this.g < this.minGain) this.minGain = this.g;
    }
    // report how hard it worked (for a small indicator), ~6 times a second
    if ((this.t += oL.length) > 8000) { this.port.postMessage({ gr: 20 * Math.log10(this.minGain) }); this.t = 0; this.minGain = 1; }
    return true;
  }
}
if (globalThis.registerProcessor) registerProcessor('safety-limiter', SafetyLimiter);
