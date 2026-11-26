// Bass, step 1: the core = a sine with character, and the character comes from the photo (the chosen area).
// Same character as the multiply lab's oscillator, plus "resistance":
//  shape  = bend the cycle (phase warp)                 -> adds low harmonics, the sine leans
//  drift  = slow pitch wander (Perlin, up to +-9 cents)   jitter = every cycle a slightly different length
//  noise  = a little hiss                                  sat    = soft overdrive (odd harmonics: 3rd, 5th)
//  asym   = lopsided overdrive (even harmonics: 2nd, 4th — thickness), DC blocker after it
//  resist = a gentle low-pass after the overdrive that follows the pitch (rounds off what the overdrive added: "drag")
// Attack: pitch push = the note starts pAmt semitones high and falls back within about pDec (like a kick drum: the 'thud' of
//  a bass); click = a very short filtered noise burst on top (clickAmt), its length / brightness from the photo's edges
//  (clickLen, clickCut). Both only on a fresh strike (not on legato slides). The click is added outside the ADSR.
// keySync 1 = every strike starts the sine from the start of its cycle (same punch every time) and the click uses the same
//  noise every time; if the previous note is still sounding, the old oscillator fades out over 2 ms (no snap). 0 = runs freely.
// Upper-harmonic wobble (shim): the 1st and 2nd harmonics are rebuilt exactly from the oscillator's own phase (their
//  strength / phase per character = c.lc, measured on the page), so they never move. The rest (3rd harmonic up) is split by
//  two low-passes that follow the pitch (4.5x, 8.5x): band 1 (3rd-4th) + band 2 (5th-8th) + band 3 (9th up), which add back
//  up to exactly the rest. Each band's level moves with its own shape from the photo area
//  (top / middle / bottom of the area), read once every shimRate seconds (set on the page from BPM x bars). All three bands
//  move at the same speed; with keySync the wobble starts again from the beginning on every fresh strike (it locks to the notes).
// Grit layer (the 'kin' of a rock bass): a metal string made of harmonics from the photo (g.H) — only the ones above 400 Hz,
//  each one stretched upward like a stiff string (h * sqrt(1 + B h^2), B from the photo's edges x gStr), weighted by a broad
//  bell around gTone (where the 'kin' sits), bright at the strike and fading (higher harmonics faster, over about gLen, then a
//  small rest; then after gHold seconds it drops away at gDrop — 'rings, then cuts off'), then a lopsided overdrive (gDrive x photo contrast) and a high-pass (~300 Hz) so the low end stays the core's.
//  It follows the ADSR and moves with the upper-harmonic wobble. Harmonics are rotating phasors (no sin per sample).
// Wobble layer: a harmonic-rich cycle from the photo (w.table, the area's columns) at the played pitch, 3 copies a little
//  detuned (wDet cents, all in the middle), through a resonant low-pass whose opening and resonance follow an LFO in time
//  with the music (one pass = wRate s, set from BPM x bars). LFO shape 'photo' = the two bands of the area (w.cut / w.res);
//  or sine / tri / saw / square (then resonance = wRes). Control is smoothed (wSmooth). Randomness: wJit = small fast
//  jitter of the opening (more on grainy areas), wDrift = the centre drifts slowly over the cycles (Perlin, more with
//  more colors). Then a soft overdrive (wDrive) and a high-pass (~110 Hz) so the low end stays the core's.
//  With keySync the LFO starts again on every fresh strike. The LFO position is posted to the page for drawing.
// XY pad for the wobble (xyMode 0 = not used, 1 = A, 2 = B, 3 = C; this.xy = { act, x, y } from the page, 0..1):
//  A: x = LFO speed in steps (1/4, 1/8, 1/8 triplet, 1/16, 1/32 of a bar), y = how far it opens (top of the range).
//  B: no LFO — x = the filter opening itself, y = the resonance (a hand-played wah).
//  C: trace the photo — x = where on the photo path (opening + resonance from the two bands at that x), y = which of the 16
//     running waveforms (top -> bottom of the area).
//  D = A + B: x = LFO speed in steps (as A), y = where the filter sits by hand (as B) — the LFO wobbles around that
//     position (+-25 % of the range) and the resonance rises with y.
//  Released (act 0): A, B and D close the filter; C goes back to the normal LFO. 'Hold' on the page keeps act at 1.
// Bass low-pass (bass mode only, bLp on/off): one resonant low-pass (TPT state-variable, 12 dB/oct) over the whole bass
//  sound, fixed (not moved by an LFO): bF = cutoff Hz, bQ = resonance 0..1.
// Two instruments on one core (mode): 0 = bass (core + grit + upper-harmonic wobble), 1 = wobble. In wobble the core is
//  split: its 1st harmonic is replaced by a clean sine (the sub, subLv) and everything the photo character added (core minus
//  its own 1st harmonic) goes INTO the wobble filter together with the wobble source (wCore), so the whole bass above the
//  sub moves as one. Grit and the upper-harmonic wobble are bass-only. wReese = the source is a wide-detuned saw stack.
// Wobble extras: glide also slides a re-struck note from the pitch that is still sounding (phrases slide); wScan = the wobble's waveform runs through w.frames
//  (16 cycles from the area, top -> bottom) together with the LFO (opening up = later frames), like a moving wavetable.
// wSaw 1 = the wobble / reese layer plays a plain band-limited saw (w.saw) instead of the photo cycle.
// Phrase player (seq): steps of 16th notes { t: on / tie / rest, semi, rate }, played in time inside the synth (no timer
//  drift): 'on' = a fresh strike of root + semi (attack, click, LFO from the start), 'tie' = keep sounding, 'rest' = release.
//  While a phrase plays, the wobble LFO speed is the step's rate (fraction of a bar) and, if the type asks for one, its shape.
//  The current step is posted to the page for drawing.
// All values 0..1 are worked out from the photo area on the page and sent here, with gain = a level match so every photo
// sounds as loud as a plain sine (the core of a bass keeps one level). Mono, last-note priority, glide, ADSR.
function perlinFor(seed) {
  let a = seed | 0; const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = Float32Array.from({ length: 256 }, () => rnd() * 2 - 1);
  return (x) => { const i = Math.floor(x), t = x - i, g0 = g[i & 255], g1 = g[(i + 1) & 255], u = t * t * t * (t * (t * 6 - 15) + 10); return 2 * (g0 * t + (g1 * (t - 1) - g0 * t) * u); };
}
const P1 = perlinFor(11), P2 = perlinFor(23), P3 = perlinFor(37);
const fbm = (x) => P1(x) * 0.6 + P2(x * 2.13 + 17.1) * 0.28 + P3(x * 4.37 + 41.7) * 0.12;
class Osc {
  constructor() { this.ph = 0; this.jit = 1; this.lp = 0; this.rs = 0; this.dcx = 0; this.dcy = 0; this.dx = Math.random() * 1000; }
  next(f, C, dt) {
    this.dx += dt * 0.35;
    const fm = f * (C.drift > 0 ? Math.pow(2, (C.drift * 15 * fbm(this.dx) * 1.6) / 1200) : 1) * this.jit;
    this.ph += fm * dt; if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.jit = 1 + C.jitter * 0.007 * (Math.random() * 2 - 1); }
    let p = this.ph;
    if (C.shape > 0) { p += C.shape * 0.07 * Math.sin(2 * Math.PI * p); p -= Math.floor(p); }
    let y = Math.sin(2 * Math.PI * p);
    if (C.sat > 0 || C.asym > 0) {
      const k = 1 + 4 * C.sat, bs = 0.6 * C.asym, t0 = Math.tanh(k * bs);
      const pk = Math.max(Math.tanh(k * (1 + bs)) - t0, t0 - Math.tanh(k * (bs - 1)));
      const wz = Math.min(1, (C.sat + C.asym) * 3); // fade the overdrive in: near 0 it must be a clean sine
      y += ((Math.tanh(k * (y + bs)) - t0) / pk - y) * wz;
      if (bs > 0) { const yo = y - this.dcx + 0.9989 * this.dcy; this.dcx = y; this.dcy = yo; y = yo; }
    }
    if (C.resist > 0) { const fc = fm * (1.5 + 40 * Math.pow(1 - C.resist, 2)), a = 1 - Math.exp(-2 * Math.PI * Math.min(fc, 20000) * dt); this.rs += (y - this.rs) * a; y = this.rs; } // round off (the level is matched by gain)
    else this.rs = y;
    if (C.noise > 0) y += C.noise * 0.05 * (Math.random() * 2 - 1);
    return y;
  }
}
class Bass extends (globalThis.AudioWorkletProcessor || class {}) {
  constructor() {
    super();
    this.sr = globalThis.sampleRate || 48000;
    this.p = { A: 0.005, D: 0.3, S: 0.85, R: 0.15, glide: 0, legato: 1, level: 0.8, pAmt: 7, pDec: 0.06, clickAmt: 0.4, keySync: 1, shimAmt: 1, shimRate: 4, gAmt: 0.5, gDrive: 0.5, gTone: 1500, gLen: 1, gStr: 1, gHold: 0.25, gDrop: 0.04,
      wAmt: 0.6, wRate: 0.25, wShape: 'photo', wMin: 150, wMax: 3000, wRes: 0.7, wSmooth: 0.01, wDet: 8, wDrive: 0.3, wJit: 0, wDrift: 0, wScan: 0, wSaw: 0, mode: 0, wCore: 1, subLv: 0.8, wReese: 0, bLp: 0, bF: 1200, bQ: 0.3, xyMode: 0, xyBar: 2 };
    this.xy = { act: 0, x: 0.5, y: 0.5 };
    this.bs = [0, 0];
    this.seq = null; this.seqPos = -1; this.seqT = 0; this.seqNote = null; this.seqRate = 0.125;
    this.w = null; this.wph = 0; this.wp = [0, 0.31, 0.67]; this.ws = [0, 0]; this.wc = 0.5; this.wr = 0.5; this.wdx = Math.random() * 100; this.wh1 = 0; this.wh2 = 0; this.whx = 0; this.why = 0; this.wPost = 0;
    this.g = null; this.gAge = 0; this.gr = new Float64Array(65).fill(1); this.gi = new Float64Array(65); this.gcs = new Float64Array(65); this.gsn = new Float64Array(65); this.gA = new Float32Array(65); this.gTop = 0; this.gLo = 1; this.gh1 = 0; this.gh2 = 0; this.gx = 0; this.gy = 0;
    this.c = { shape: 0, drift: 0, jitter: 0, noise: 0, sat: 0, asym: 0, resist: 0, gain: 1, clickLen: 0.005, clickCut: 2000 };
    this.pe = 0; this.ck = 0; this.c1 = 0; this.c2 = 0; this.old = null; this.xf = 0; this.ns = 1; // pitch push, click (envelope, filters, noise seed), hand-over oscillator
    this.sw = null; this.sDepth = 0; this.sph = [0, 0.33, 0.66]; this.xs = [0, 0, 0, 0, 0, 0]; // upper-harmonic wobble: shapes, depth, read positions, splitter states
    this.o = new Osc(); this.f = 65.4; this.fT = 65.4; this.stack = []; this.env = 0; this.stage = 'off'; this.gate = false;
    if (this.port) this.port.onmessage = ({ data: m }) => this.msg(m);
  }
  msg(m) {
    if (m.type === 'params') Object.assign(this.p, m.p);
    else if (m.type === 'char') Object.assign(this.c, m.c);
    else if (m.type === 'shim') { this.sw = m.waves; this.sDepth = m.depth; }
    else if (m.type === 'grit') this.g = m.g;
    else if (m.type === 'wob') this.w = m.w;
    else if (m.type === 'seq') { this.seq = m; this.seqPos = -1; this.seqT = 0; }
    else if (m.type === 'xy') this.xy = m;
    else if (m.type === 'seqRoot') { if (this.seq) this.seq.root = m.root; }
    else if (m.type === 'seqStop') { this.seq = null; if (this.seqNote != null) this.msg({ type: 'noteOff', midi: this.seqNote }); this.seqNote = null; }
    else if (m.type === 'noteOn') {
      const was = this.stack.length > 0; this.stack = this.stack.filter((n) => n !== m.midi); this.stack.push(m.midi);
      this.fT = 440 * Math.pow(2, (m.midi - 69) / 12); if (!was && !(this.p.glide > 0 && this.stage !== 'off' && this.env > 0.01)) this.f = this.fT; // with glide: slide even into a re-struck note
      if (!was || !this.p.legato) {
        if (this.p.keySync) { // fresh oscillator from the start of the cycle; keep the drift where it was
          if (this.stage !== 'off' && this.env > 1e-3) { this.old = this.o; this.xf = 1; } // still sounding: fade the old one out
          const n = new Osc(); n.dx = this.o.dx; this.o = n; this.ns = 1; this.c1 = 0; this.c2 = 0; this.sph = [0, 0, 0]; // wobble from its start too
        }
        this.stage = 'att'; this.pe = this.p.pAmt; this.ck = 1; this.gAge = 0; // the string is struck again
        if (this.p.keySync) this.wph = 0; // the wobble starts with the note
        if (this.p.keySync) { this.gr.fill(1); this.gi.fill(0); }
      }
      this.gate = true;
    } else if (m.type === 'noteOff') {
      this.stack = this.stack.filter((n) => n !== m.midi);
      if (this.stack.length) this.fT = 440 * Math.pow(2, (this.stack[this.stack.length - 1] - 69) / 12); else { this.gate = false; this.stage = 'rel'; }
    } else if (m.type === 'allOff') { this.stack = []; this.gate = false; this.stage = 'rel'; }
  }
  // split into low / 3 bands with three 12 dB low-passes (TPT state-variable) and give each band its own photo wobble
  shim(x, f, dt) {
    const P = this.p, s = this.xs, d = Math.min(1.5, this.sDepth * P.shimAmt), N = 128;
    const lc = this.c.lc, th = 2 * Math.PI * this.o.ph;
    const low = lc ? lc[0] * Math.cos(th) + lc[1] * Math.sin(th) + lc[2] * Math.cos(2 * th) + lc[3] * Math.sin(2 * th) : 0;
    let rest = x - low, sum = 0; // 3rd harmonic and up
    for (let j = 0; j < 2; j++) {
      const fc = Math.min(0.45 / dt, f * [4.5, 8.5][j]), g = Math.tan(Math.PI * fc * dt), k = Math.SQRT2, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v3 = rest - s[j * 2 + 1], v1 = a1 * s[j * 2] + a2 * v3, v2 = s[j * 2 + 1] + a2 * s[j * 2] + a3 * v3; s[j * 2] = 2 * v1 - s[j * 2]; s[j * 2 + 1] = 2 * v2 - s[j * 2 + 1];
      sum += v2 * this.sg[j]; rest -= v2;
    }
    sum += rest * this.sg[2];
    return low + sum;
  }
  resetStates() {
    this.ws = [0, 0]; this.bs = [0, 0]; this.xs.fill(0); this.wc = 0.5; this.wr = 0.5; this.wh1 = this.wh2 = this.whx = this.why = 0;
    this.gh1 = this.gh2 = this.gx = this.gy = 0; this.c1 = this.c2 = 0; this.gr.fill(1); this.gi.fill(0);
    const o = this.o; o.lp = o.rs = o.dcx = o.dcy = 0; if (!isFinite(o.ph)) o.ph = 0; if (!isFinite(this.f)) this.f = this.fT; this.old = null;
  }
  // grit: per block, which harmonics, their stretched pitch (step of each phasor) and strength at this moment
  gritBlock(f, dt, n) {
    const P = this.p, g = this.g; if (!g || P.gAmt <= 0 || P.mode) { this.gTop = 0; return; } // grit: bass only
    const B = (g.stretch || 0) * P.gStr * 0.0004, lo = Math.max(1, Math.ceil(400 / f)), a = this.gAge, tone = Math.log2(Math.max(100, P.gTone));
    this.gLo = lo; this.gTop = 0;
    for (let h = lo; h <= 64; h++) {
      const fh = h * f * Math.sqrt(1 + B * h * h); if (fh > 0.45 / dt) break;
      const w = 2 * Math.PI * fh * dt; this.gcs[h] = Math.cos(w); this.gsn[h] = Math.sin(w);
      const mg = Math.hypot(this.gr[h], this.gi[h]); if (mg > 0) { this.gr[h] /= mg; this.gi[h] /= mg; } else this.gr[h] = 1;
      const bell = 0.15 + 1 / (1 + ((Math.log2(fh) - tone) / 0.9) ** 2), tau = Math.max(0.01, P.gLen * Math.sqrt(16 / h));
      const drop = a < P.gHold ? 1 : Math.exp(-(a - P.gHold) / Math.max(0.002, P.gDrop * Math.sqrt(16 / h))); // held, then drops (higher harmonics first)
      this.gA[h] = g.H[h] * bell * (0.08 + 0.92 * Math.exp(-a / tau)) * drop; this.gTop = h;
    }
    this.gAge += n * dt;
  }
  // wobble: LFO value (0..1 opening, 0..1 resonance) at phase p
  wobLfo(p) {
    const P = this.p, w = this.w, shape = (this.seq && this.seq.shape) || P.wShape;
    if (shape === 'photo' && w && w.cut) { const N = w.cut.length, q = p * N, i = q | 0, t = q - i; return [w.cut[i % N] + (w.cut[(i + 1) % N] - w.cut[i % N]) * t, w.res[i % N] + (w.res[(i + 1) % N] - w.res[i % N]) * t]; }
    const v = shape === 'tri' ? 1 - Math.abs(2 * p - 1) : shape === 'saw' ? 1 - p : shape === 'square' ? (p < 0.5 ? 1 : 0) : 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    return [v, 0.6];
  }
  process(_, outputs) {
    const out = outputs[0]; if (!out || !out[0]) return true;
    const L = out[0], R = out[1] || out[0], n = L.length, P = this.p, dt = 1 / this.sr;
    const kP = Math.exp(-dt / Math.max(0.001, P.pDec / 2.5)), kC = Math.exp(-dt / Math.max(0.0003, this.c.clickLen / 4)), aC = 1 - Math.exp(-2 * Math.PI * Math.min(this.c.clickCut, 18000) * dt);
    const kA = dt / Math.max(0.0005, P.A), kD = 1 - Math.exp(-dt / Math.max(0.003, P.D / 3)), kR = 1 - Math.exp(-dt / Math.max(0.005, P.R / 3)), kG = P.glide > 0 ? 1 - Math.exp(-dt / P.glide) : 1;
    // wobble gains for this block (one per band), read from the photo shapes
    this.sg = this.sg || [1, 1, 1];
    if (this.sw) { const d = Math.min(1.5, this.sDepth * P.shimAmt), N = 128; for (let j = 0; j < 3; j++) { this.sph[j] = (this.sph[j] + (n * dt) / Math.max(0.01, P.shimRate)) % 1; const q = this.sph[j] * N, i0 = q | 0, t = q - i0, wv = this.sw[j]; const m = wv[i0 % N] + (wv[(i0 + 1) % N] - wv[i0 % N]) * t; this.sg[j] = Math.max(0, 1 + d * m); } }
    if (this.seq) { // phrase player: step on 16th-note boundaries
      this.seqT -= n;
      while (this.seqT <= 0) {
        const S = this.seq; this.seqPos = (this.seqPos + 1) % S.steps.length; const st = S.steps[this.seqPos]; this.seqRate = st.rate; this.seqT += S.step * this.sr;
        if (st.t === 'on') { if (this.seqNote != null) this.msg({ type: 'noteOff', midi: this.seqNote }); this.seqNote = S.root + st.semi; this.msg({ type: 'noteOn', midi: this.seqNote }); }
        else if (st.t === 'rest' && this.seqNote != null) { this.msg({ type: 'noteOff', midi: this.seqNote }); this.seqNote = null; }
        if (this.port) this.port.postMessage({ seqPos: this.seqPos });
      }
    }
    this.gritBlock(this.f * Math.pow(2, this.pe / 12), dt, n);
    // wobble: control for this block
    let wa1 = 0, wa2 = 0, wa3 = 0, wk = 1, wOn = P.mode && this.w && this.w.table && this.stage !== 'off'; // wobble: wobble mode only
    if (wOn) {
      const xy = this.xy, xm = P.xyMode, xa = xm && xy.act;
      const XY_RATES = [1 / 4, 1 / 8, 1 / 12, 1 / 16, 1 / 32];
      const wRate = (xm === 1 || xm === 4) && xa ? XY_RATES[Math.min(4, Math.floor(xy.x * 5))] * P.xyBar : this.seq ? this.seqRate * this.seq.bar : P.wRate;
      this.wph = (this.wph + (n * dt) / Math.max(0.02, wRate)) % 1;
      let [c, r] = this.wobLfo(this.wph);
      if (xm === 2 && xa) { c = xy.x; r = xy.y; } // B: the hand is the filter
      else if (xm === 4 && xa) { c = xy.y + (c - 0.5) * 0.5; r = xy.y; } // D: the LFO wobbles around the hand's position
      else if (xm === 3 && xa && this.w.cut) { const N = this.w.cut.length, i = Math.min(N - 1, Math.floor(xy.x * N)); c = this.w.cut[i]; r = this.w.res[i]; } // C: scrub the photo path
      if ((xm === 1 || xm === 2 || xm === 4) && !xy.act) c = 0; // A / B / D released: closed
      if (P.wJit > 0) c += (Math.random() - 0.5) * P.wJit * 0.25 * (0.3 + 0.7 * (this.w.grain || 0));
      if (P.wDrift > 0) { this.wdx += (n * dt) / Math.max(0.02, wRate) / 8; c += P.wDrift * 0.35 * (0.3 + 0.7 * (this.w.hue || 0)) * fbm(this.wdx) * 1.6; }
      const kS = 1 - Math.exp(-(n * dt) / Math.max(0.0005, P.wSmooth)); this.wc += (Math.max(0, Math.min(1, c)) - this.wc) * kS; this.wr += (r - this.wr) * kS;
      const wMax = xm === 1 && xa ? 300 * Math.pow(8000 / 300, xy.y) : P.wMax; // A: y = how far it opens
      const fc = Math.min(0.45 / dt, P.wMin * Math.pow(Math.max(1.01, wMax / P.wMin), this.wc)), g = Math.tan(Math.PI * fc * dt);
      const res = xm === 2 && xa ? this.wr : xm === 4 && xa ? P.wRes * (0.3 + 0.7 * this.wr) : (xm === 3 && xa) || ((this.seq && this.seq.shape) || P.wShape) === 'photo' ? P.wRes * (0.25 + 0.75 * this.wr) : P.wRes; wk = 2 - 1.9 * Math.min(1, res); // k: 2 = no peak ... 0.1 = strong peak
      wa1 = 1 / (1 + g * (g + wk)); wa2 = g * wa1; wa3 = g * wa2;
    }
    if (this.port && (this.wPost += n) >= 2048) { this.wPost = 0; this.port.postMessage({ wph: this.wph, wc: this.wc, wr: this.wr }); }
    const bG = Math.tan(Math.PI * Math.min(P.bF, 0.45 / dt) * dt), bK = 2 - 1.9 * Math.min(1, P.bQ), bA1 = 1 / (1 + bG * (bG + bK)), bA2 = bG * bA1, bA3 = bG * bA2;
    const wHp = Math.exp(-2 * Math.PI * 110 * dt), wDk = 1 + 5 * P.wDrive, wDn = Math.tanh(wDk);
    const gk = 1 + 8 * Math.min(1, P.gDrive * (0.4 + 1.2 * ((this.g && this.g.drive) || 0))), gb = 0.35, gt0 = Math.tanh(gk * gb), gpk = Math.max(Math.tanh(gk * (1 + gb)) - gt0, gt0 - Math.tanh(gk * (gb - 1)));
    const gHp = Math.exp(-2 * Math.PI * 300 * dt), gW = this.sw ? (this.sg[0] + this.sg[1] + this.sg[2]) / 3 : 1;
    for (let i = 0; i < n; i++) {
      if (this.stage === 'att') { this.env += kA; if (this.env >= 1) { this.env = 1; this.stage = 'dec'; } }
      else if (this.stage === 'dec') this.env += ((this.gate ? P.S : 0) - this.env) * kD;
      else if (this.stage === 'rel') { this.env -= this.env * kR; if (this.env < 1e-5) { this.env = 0; this.stage = 'off'; } }
      this.f *= Math.pow(this.fT / this.f, kG);
      this.pe *= kP; const fp = this.pe > 0.001 ? this.f * Math.pow(2, this.pe / 12) : this.f; // pitch push falls back
      let w = this.stage === 'off' ? 0 : this.o.next(fp, this.c, dt);
      if (this.old) { w = w * (1 - this.xf) + this.old.next(fp, this.c, dt) * this.xf; this.xf -= dt / 0.002; if (this.xf <= 0) this.old = null; } // 2 ms hand-over
      let y, coreHarm = 0;
      if (!P.mode) { // bass: the core as it is (+ upper-harmonic wobble)
        if (this.sw && this.sDepth * P.shimAmt > 0.001 && this.stage !== 'off') w = this.shim(w, fp, dt);
        y = w * this.c.gain * this.env * P.level;
      } else { // wobble: clean sine sub + the core's added harmonics go into the wobble filter
        const lc = this.c.lc, th = 2 * Math.PI * this.o.ph, h1 = lc ? lc[0] * Math.cos(th) + lc[1] * Math.sin(th) : 0;
        coreHarm = (w - h1) * this.c.gain;
        y = (this.stage === 'off' ? 0 : Math.sin(th)) * P.subLv * this.env * P.level;
      }
      if (this.ck > 1e-4) { // click: noise through two gentle low-passes, very short decay
        let r; if (P.keySync) { this.ns = (Math.imul(this.ns, 1664525) + 1013904223) | 0; r = (this.ns >>> 0) / 2147483648 - 1; } else r = Math.random() * 2 - 1; // same click every time when synced
        this.c1 += (r - this.c1) * aC; this.c2 += (this.c1 - this.c2) * aC;
        y += this.c2 * this.ck * P.clickAmt * P.level * 6; this.ck *= kC;
      }
      if (this.gTop && this.stage !== 'off') { // grit layer
        let s = 0; for (let h = this.gLo; h <= this.gTop; h++) { const re = this.gr[h], im = this.gi[h]; this.gr[h] = re * this.gcs[h] - im * this.gsn[h]; this.gi[h] = re * this.gsn[h] + im * this.gcs[h]; s += this.gi[h] * this.gA[h]; }
        s *= 0.35; let z = (Math.tanh(gk * (s + gb)) - gt0) / gpk; // lopsided overdrive
        this.gh1 = gHp * (this.gh1 + z - this.gx); this.gx = z; this.gh2 = gHp * (this.gh2 + this.gh1 - this.gy); this.gy = this.gh1; // two high-passes ~300 Hz (also removes the offset)
        y += this.gh2 * P.gAmt * this.env * P.level * gW * 1.2;
      }
      if (wOn) { // wobble layer
        const T = 2048, T1 = T + 1, tab = P.wSaw && this.w.saw ? this.w.saw : this.w.table, fr0 = this.w.frames, F = this.w.F || 0; let s = 0;
        let fa = 0, fb = 0, ft = 0; const scan = !P.wSaw && fr0 && F > 1 && (P.wScan > 0 || (P.xyMode === 3 && this.xy.act));
        if (scan) { const pos = (P.xyMode === 3 && this.xy.act ? this.xy.y : Math.max(0, Math.min(1, 0.5 * (1 - P.wScan) + P.wScan * this.wc))) * (F - 1); fa = pos | 0; fb = Math.min(F - 1, fa + 1); ft = pos - fa; } // the waveform runs with the LFO
        for (let u = 0; u < 3; u++) {
          const fr = fp * Math.pow(2, ((u - 1) * (P.wReese ? Math.max(18, P.wDet * 2.5) : P.wDet)) / 1200); this.wp[u] += fr * dt; this.wp[u] -= Math.floor(this.wp[u]); const q = this.wp[u] * T, j = q | 0, t = q - j;
          if (scan) { const oa = fa * T1, ob = fb * T1, va = fr0[oa + j] + (fr0[oa + j + 1] - fr0[oa + j]) * t, vb = fr0[ob + j] + (fr0[ob + j + 1] - fr0[ob + j]) * t; s += va + (vb - va) * ft; }
          else s += tab[j] + (tab[j + 1] - tab[j]) * t;
        }
        s = (s / 3) * P.wAmt + coreHarm * P.wCore; const sv = this.ws, v3 = s - sv[1], v1 = wa1 * sv[0] + wa2 * v3, v2 = sv[1] + wa2 * sv[0] + wa3 * v3; sv[0] = 2 * v1 - sv[0]; sv[1] = 2 * v2 - sv[1]; // wAmt = how much of the wobble source; the core's harmonics join at wCore
        const z = Math.tanh(v2 * wDk) / wDn;
        this.wh1 = wHp * (this.wh1 + z - this.whx); this.whx = z; this.wh2 = wHp * (this.wh2 + this.wh1 - this.why); this.why = this.wh1; // two high-passes ~110 Hz
        y += this.wh2 * this.env * P.level * 0.7;
      }
      if (!P.mode && P.bLp) { // bass low-pass
        const s = this.bs, v3 = y - s[1], v1 = bA1 * s[0] + bA2 * v3, v2 = s[1] + bA2 * s[0] + bA3 * v3; s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1]; y = v2;
      }
      if (!(Math.abs(y) < 1e6)) { y = 0; this.resetStates(); } // safety: never let a broken number stick in a filter
      L[i] = y; R[i] = y; // mono: the core of a bass stays in the middle
    }
    return true;
  }
}
if (globalThis.registerProcessor) registerProcessor('bass-synth', Bass);
export { Bass, Osc };
