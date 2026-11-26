// Tube compressor modeled on the layout of a 1960s broadcast compressor, with a variable-mu twin triode in the V1 position.
//  V1 (push-pull variable-mu): solved electrically every sample -> plate current from the tube formula and the
//     47k plate load (load line), plate supply node from the schematic (sags with current, smoothed by C7 80uF).
//  T1 / V2 / T2: block models (soft saturation, low-end transformer saturation, high roll-off).
//  Side chain (V3 6AL5 full-wave + R12/C4/R9/P2): rectified output charges a cap -> more negative V1 grid bias.
//  Feedback type: the side chain listens to the output. Runs at 2x the sample rate.

// the tube: several triode sections with different mu in parallel (fit to a variable-mu twin triode's transfer chart)
const MU = [3, 5, 8, 13, 22, 40], K = [0.009629, 0.006399, 0.1067, 0.04671, 0.2643, 0.1333];
function tube(va, vg) { // returns [Ia (A), dIa/dVa]
  let s = 0, d = 0;
  for (let j = 0; j < 6; j++) { const x = vg + va / MU[j]; if (x > 0) { const r = Math.sqrt(x); s += K[j] * x * r; d += (1.5 * K[j] * r) / MU[j]; } }
  return [s / 1000, d / 1000];
}
// schematic values
const VRAW = 292.8, RSRC = 13400, RL = 47000, C7 = 80e-6, IDLE_BIAS = -2; // idle bias that lands on the schematic's 65V / 210V

// one side of V1: Ia with the node voltage vs held for this sample (Newton from the previous value)
function solveSide(vg, vs, I) {
  for (let it = 0; it < 4; it++) {
    const va = vs - RL * I, [f, df] = tube(va, vg), g = I - f, dg = 1 + RL * df;
    I = Math.max(0, Math.min(vs / RL, I - g / dg));
  }
  return I;
}
function smallGain(vg, vs) { // |dVp/dVg| for the gain-reduction meter table
  const vp = (g) => { let I = 0.002; for (let k = 0; k < 40; k++) I = solveSide(g, vs, I); return vs - RL * I; };
  return Math.abs((vp(vg + 0.01) - vp(vg - 0.01)) / 0.02);
}
function idleNode() { // DC operating point: both sides draw Ia, node = VRAW - RSRC*2Ia
  let lo = 0, hi = VRAW / (RL + 2 * RSRC);
  for (let it = 0; it < 60; it++) { const I = (lo + hi) / 2, vs = VRAW - RSRC * 2 * I; (I - tube(vs - RL * I, IDLE_BIAS)[0] > 0) ? (hi = I) : (lo = I); }
  const I = (lo + hi) / 2; return { I, vs: VRAW - RSRC * 2 * I };
}

class TubeComp extends (globalThis.AudioWorkletProcessor || class {}) {
  constructor() {
    super();
    this.sr = (globalThis.sampleRate || 48000) * 2; // processing rate (2x)
    this.p = { on: 1, input: 1.5, thresh: 0.5, release: 0.4, output: 1, balance: 0.15 };
    const op = idleNode();
    this.vs = op.vs; this.I1 = op.I; this.I2 = op.I; this.vc = 0;
    this.G0 = smallGain(IDLE_BIAS, op.vs);
    this.grTab = Float32Array.from({ length: 161 }, (_, i) => 20 * Math.log10(smallGain(IDLE_BIAS - i * 0.5, op.vs) / this.G0)); // vc 0..80V
    this.ch = [0, 1].map(() => ({ hpIn: 0, xin: 0, hpOut: 0, yout: 0, lpT: 0, lpH: 0, dc: 0, prev: 0, lp1: 0, lp2: 0 }));
    this.y = 0; this.mix = 1; this.meterT = 0; this.grNow = 0;
    if (this.port) this.port.onmessage = ({ data }) => Object.assign(this.p, data);
  }
  // one sample at 2x rate for a mono-summed control, per-channel audio through the same V1 state? -> stereo: two V1s share one side chain
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length, sr = this.sr, dt = 1 / sr, P = this.p;
    const inGain = P.input, side = 140 * P.thresh, aA = 1 - Math.exp(-dt / 0.033), aR = 1 - Math.exp(-dt / (0.27 + P.release * 1.0));
    const aNode = 1 - Math.exp(-dt / (RSRC * C7)), hp = Math.exp(-2 * Math.PI * 12 / sr), aT = 1 - Math.exp(-2 * Math.PI * 120 / sr), aH = 1 - Math.exp(-2 * Math.PI * 17000 / sr);
    const norm = 1 / (2 * this.G0), target = P.on ? 1 : 0;
    for (let c = 0; c < out.length; c++) if (!inp || !inp[c]) out[c].fill(0);
    if (!inp || !inp.length) return true;
    const nc = Math.min(out.length, inp.length);
    for (let i = 0; i < n; i++) {
      this.mix += (target - this.mix) * 0.002;
      let det = 0;
      for (let c = 0; c < nc; c++) {
        const S = this.ch[c], xin = inp[c][i];
        let acc = 0;
        for (let o = 0; o < 2; o++) { // 2x: linear interpolation up, average down after a 2-pole lowpass
          const x = o === 0 ? (S.prev + xin) * 0.5 : xin;
          // T1: block DC / sub-bass, gentle core saturation
          S.hpIn = hp * (S.hpIn + x - S.xin); S.xin = x;
          const t1 = Math.tanh(S.hpIn * 1.1) / 1.1;
          // V1: grids at bias +- signal (center-tapped secondary); balance = slight mismatch (even harmonics)
          const bias = IDLE_BIAS - this.vc, v = t1 * inGain;
          const I1 = solveSide(bias + v + P.balance, this.vs, c === 0 ? this.I1 : S.I1 ?? this.I1);
          const I2 = solveSide(bias - v - P.balance, this.vs, c === 0 ? this.I2 : S.I2 ?? this.I2);
          if (c === 0) { this.I1 = I1; this.I2 = I2; } else { S.I1 = I1; S.I2 = I2; }
          let d = ((this.vs - RL * I1) - (this.vs - RL * I2)) * norm; // differential plate output, unity at idle
          S.dc += (d - S.dc) * 0.0005; d -= S.dc; // coupling caps C2/C3
          // V2 6CG7 push-pull: soft, slightly asymmetric
          let y = Math.tanh(0.7 * (d + 0.04 * d * d)) / 0.7;
          // T2: lows saturate a little more, top rolls off
          S.lpT += (y - S.lpT) * aT; y = y - S.lpT + Math.tanh(S.lpT * 1.4) / 1.4;
          S.lpH += (y - S.lpH) * aH; y = S.lpH;
          S.lp1 += (y - S.lp1) * 0.75; S.lp2 += (S.lp1 - S.lp2) * 0.75; // ~20kHz at the 2x rate
          acc += S.lp2;
          if (o === 1) det = Math.max(det, Math.abs(y));
        }
        S.prev = xin;
        const wet = acc * 0.5 * P.output;
        out[c][i] = xin * (1 - this.mix) + wet * this.mix;
      }
      // V1 node: average current pulls the plate supply down, smoothed by C7
      this.vs += (VRAW - RSRC * (this.I1 + this.I2) - this.vs) * aNode * 2;
      // V3 side chain (feedback: listens to the output): full-wave rectifier -> C4 charges through R12, discharges through R9+P2
      const vsig = Math.max(0, det * side - 0.5);
      this.vc += (vsig > this.vc ? (vsig - this.vc) * aA : -this.vc * aR) * 2;
      this.vc = Math.min(80, this.vc);
    }
    this.meterT += n;
    if (this.meterT > 2400 && this.port) { this.meterT = 0; const j = Math.min(160, this.vc * 2); const j0 = j | 0; this.port.postMessage({ gr: this.grTab[j0] + (this.grTab[Math.min(160, j0 + 1)] - this.grTab[j0]) * (j - j0), vc: this.vc }); }
    return true;
  }
}
if (globalThis.registerProcessor) registerProcessor('tube-comp', TubeComp);
export { TubeComp, tube, idleNode, smallGain };
