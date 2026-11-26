// Tape echo modeled on a 1970s multi-head studio tape echo (its block diagram, circuit, mode table and reference data).
//  Tape: one record head and three equally spaced playback heads (Fig.6). Speed 12-40 cm/s (reference data).
//    The tape position at every written sample is kept, and each playback head reads the spot of tape that is under it now,
//    so changing the speed (or wow/flutter) bends the pitch of echoes already on the tape, like the real machine.
//  Record path: record pre-amp -> record amp -> tape (soft saturation, more with an old tape).
//  Playback: head/tape high loss that gets darker as the tape slows down, pre-amp, mode selector (12 modes, p.6 table).
//  Intensity: playback pre-amp output fed back to the record pre-amp (VR5), so every repeat passes tape + amps again.
//  Echo volume -> tone (bass +-10dB @100Hz, treble +-10dB @5kHz, reference data) -> added to the dry sound.
//  Stereo (not on the machine, which is mono): the echoes get a side part = the echo minus itself 11 ms earlier, added to
//  the left and taken from the right. They spread out, while left + right (mono) stays exactly the echo. 0 = in the middle.

const HEAD_SPACING = 2.4; // cm between heads. Not given in the notes: chosen so head 1 = 60..200 ms over 40..12 cm/s
const MODES = [[], [1], [2], [3], [2, 3], [1], [2], [3], [1, 2], [2, 3], [1, 3], [1, 2, 3], []]; // index = mode 1..12

function shelf(type, f, gainDb, sr) { // RBJ shelving biquad (S = 1)
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f) / sr, cs = Math.cos(w), sn = Math.sin(w), al = (sn / 2) * Math.SQRT2, sq = 2 * Math.sqrt(A) * al;
  let b0, b1, b2, a0, a1, a2;
  if (type === 'low') { b0 = A * (A + 1 - (A - 1) * cs + sq); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - sq); a0 = A + 1 + (A - 1) * cs + sq; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - sq; }
  else { b0 = A * (A + 1 + (A - 1) * cs + sq); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - sq); a0 = A + 1 - (A - 1) * cs + sq; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - sq; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
const bq = (f, x) => { const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; return y; };

class TapeEcho extends (globalThis.AudioWorkletProcessor || class {}) {
  constructor() {
    super();
    const sr = (this.sr = globalThis.sampleRate || 48000);
    this.p = { on: 1, mode: 1, speed: 26, intensity: 0.45, echo: 0.6, bass: 0, treble: 0, wow: 0.3, age: 0.3, width: 0 };
    this.eb = new Float32Array(Math.round(sr * 0.011)); this.ei = 0; // the echo 11 ms ago (Stereo)
    this.N = Math.ceil(sr * 2.5); // longest echo: head 3 at 12 cm/s = 0.6 s; plenty of room for slow-downs
    this.tape = new Float32Array(this.N); this.pos = new Float64Array(this.N); // signal and tape position (cm) per written sample
    this.w = 0; this.x = 0; this.v = this.p.speed; this.rd = [0, 0, 0, 0];
    this.pb = 0; this.lp = [0, 0, 0, 0]; this.lp2 = [0, 0, 0, 0]; this.hp = 0; this.hpx = 0;
    this.wowPh = Math.random() * 6.28; this.flPh = Math.random() * 6.28; this.drift = 0; this.driftT = 0;
    this.tone = null; this.toneKey = '';
    this.mix = 1; this.sig = 0; // sig = how much sound is going through (hiss follows it, so silence stays silent)
    for (let i = 0; i < this.N; i++) this.pos[i] = -1e9; // nothing recorded yet
    if (this.port) this.port.onmessage = ({ data }) => Object.assign(this.p, data);
  }
  // signal recorded at tape position y (cm): search the written positions around head k's last spot and interpolate
  readAt(k, y) {
    const N = this.N, pos = this.pos;
    let i = this.rd[k];
    // move forward while the next written spot is still behind y (the tape moves on, so this pointer only advances)
    for (let g = 0; g < 64 && pos[(i + 1) % N] <= y && ((i + 1) % N) !== this.w; g++) i = (i + 1) % N;
    // and back if the speed jumped
    for (let g = 0; g < 64 && pos[i] > y; g++) i = (i - 1 + N) % N;
    this.rd[k] = i;
    const j = (i + 1) % N, a = pos[i], b = pos[j];
    if (!(b > a) || y < a) return 0;
    const t = Math.min(1, (y - a) / (b - a));
    return this.tape[i] * (1 - t) + this.tape[j] * t;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length, sr = this.sr, P = this.p, dt = 1 / sr;
    const heads = MODES[Math.max(1, Math.min(12, Math.round(P.mode)))];
    const key = `${P.bass},${P.treble}`;
    if (key !== this.toneKey) { this.toneKey = key; this.tone = [shelf('low', 100, P.bass, sr), shelf('high', 5000, P.treble, sr)]; }
    // playback high loss: darker when the tape is slow and when it is worn
    const age = P.age, aMotor = 1 - Math.exp(-dt / 0.35), hpA = Math.exp(-2 * Math.PI * 70 / sr);
    const drive = 1.2 + 2.5 * age, hiss = 0.0015 * age, sigRel = Math.exp(-dt / 1.2);
    const target = P.on ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const L = inp && inp[0] ? inp[0][i] : 0, R = inp && inp[1] ? inp[1][i] : L;
      this.mix += (target - this.mix) * 0.002;
      // --- tape transport: motor follows the rate knob with inertia; wow (slow) + flutter (fast) + slow random drift
      this.v += (P.speed - this.v) * aMotor;
      this.wowPh += 2 * Math.PI * 0.6 * dt; this.flPh += 2 * Math.PI * (7.5 + 0.5 * Math.sin(this.wowPh * 0.37)) * dt;
      if ((this.driftT -= dt) <= 0) { this.driftT = 0.4 + Math.random(); this.driftTo = Math.random() * 2 - 1; }
      this.drift += ((this.driftTo || 0) - this.drift) * 0.00005;
      const vNow = this.v * (1 + P.wow * (0.004 * Math.sin(this.wowPh) + 0.0015 * Math.sin(this.flPh) + 0.003 * this.drift));
      this.x += vNow * dt;
      // --- playback: each active head reads the tape that is under it now
      const fc = Math.min(12000, 5200 * Math.pow(vNow / 19, 0.9)) * (1 - 0.55 * age), a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      let pb = 0;
      for (const k of heads) {
        let s = this.readAt(k, this.x - k * HEAD_SPACING);
        this.lp[k] += (s - this.lp[k]) * a; this.lp2[k] += (this.lp[k] - this.lp2[k]) * a; s = this.lp2[k]; // gap/tape loss
        pb += s;
      }
      // hiss only while there is sound (input or its echoes); it fades out ~1-3 s after the last echo instead of running forever
      const lv = Math.max(Math.abs(L), Math.abs(R), Math.abs(this.pb) > 0.004 ? Math.abs(this.pb) : 0);
      this.sig = lv > this.sig ? lv : this.sig * sigRel;
      pb += (Math.random() * 2 - 1) * hiss * Math.min(1, this.sig * 40) * (heads.length ? 1 : 0);
      // playback pre-amp: block lows, soft limit (discrete transistor stage)
      this.hp = hpA * (this.hp + pb - this.hpx); this.hpx = pb; pb = Math.tanh(this.hp * 1.1) / 1.1;
      this.pb = pb;
      // --- record path: dry (mono) + intensity feedback -> record pre-amp -> record amp -> tape saturation
      const recIn = (L + R) * 0.5 + pb * P.intensity * 1.05;
      const rec = Math.tanh(recIn * drive) / drive;
      this.tape[this.w] = rec; this.pos[this.w] = this.x; this.w = (this.w + 1) % this.N;
      // --- echo volume -> tone -> mix with the dry sound
      let e = pb * P.echo * 1.6;
      e = bq(this.tone[0], e); e = bq(this.tone[1], e);
      e *= this.mix;
      const side = (e - this.eb[this.ei]) * 0.7 * P.width; this.eb[this.ei] = e; this.ei = (this.ei + 1) % this.eb.length;
      out[0][i] = L + e + side;
      if (out[1]) out[1][i] = R + e - side;
    }
    return true;
  }
}
if (globalThis.registerProcessor) registerProcessor('tape-echo', TapeEcho);
export { TapeEcho, HEAD_SPACING, MODES };
