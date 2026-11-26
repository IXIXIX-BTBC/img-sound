// Techno lead (real time). Mode: mono (1 voice, last-note priority, glide, legato) or chord (up to 4/8 voices, no glide,
// the oldest note is stopped when all voices are busy). Every voice plays two layers on its own row position:
//  1) color->scale layer: components from the row table (rows.js), see below
//  2) row-waveform layer (the first experimental build's method): the current row's brightness read left->right = one cycle
//     at the played pitch (whole harmonic series = the core of the note), 1-7 detuned unison copies, a real resonant
//     low-pass (TPT state-variable). The stack holds 64 rows x 11 band-limited levels, chosen by pitch so nothing aliases.
// Connection (conn): 0 parallel (summed) / 1 serial: layer 1 bends layer 2's read phase (phase modulation)
//  / 2 serial: layer 1 multiplies layer 2 (ring modulation). ser = depth. In both serial modes layer 2 is filtered after
//  the modulation, so the resonant low-pass also tames the new upper partials.
// Color->scale layer: components come from the row table (rows.js):
//  each component = a sine (or the photo row's waveform) at (key pitch x its ratio); its strength = the table at the row.
//  Row position = base + per-press nudge (each note its own) + per-note sweep (envelope) + LFO (tempo synced), smoothed.
//  Filter = a resonant low-pass curve applied to each component's strength (no aliasing, sweeps cleanly).
// Each voice is driven (tanh) on its own, so a chord does not distort into one another; the voices are then summed.
// Sound type (fuse): 0 = separate (as above) / 2 = instrument (below). (1 = 'one lump' was removed on 11/18.)
// fuse 2 = instrument: source = the row's own harmonics (its brightness read as one cycle), each harmonic with its own
//  timing from the row (bright piece = starts at once, stays long / dark = late, short; tdiff = how much), then a 'body':
//  the row's color components become FIXED-pitch resonances (do not follow the key, like a body or a mouth), bodyAmt / bodyQ.
//  Instrument source not on exact harmonics (hdev / hstr > 0): harmonic h sits at h * sqrt(1 + B h^2) (stiff-string stretch,
//  B = hstr * 0.0008) and is moved by hdev * 60 cents in the direction the photo piece's color says (inst.Dh, gray = none,
//  the 1st harmonic never moves). Each harmonic then needs its own oscillator: a rotating phasor (no sin per sample).
//  Instrument unison: 1-7 copies of the whole harmonic source, detuned and spread left/right (the body is fed their sum).
// Sub (all types): a round sine one octave below the played note, added clean after the drive (no body, no filter).
// Move together (all types): every part of a voice gets the same small pitch and level movement, read from the row's
//  brightness (an irregular, photo-made wobble, not a sine). Parts that move together are heard as one object.
const BLOCK = 32, MAXV = 8, HMAX = 48;
const HARMS = [1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]; // highest harmonic per band-limited level (same as v1)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
class Voice {
  constructor() {
    this.midi = -1; this.f = 261.63; this.fT = 261.63; this.gate = false; this.vel = 1; this.t = 0;
    this.aenv = 0; this.astage = 'off'; this.fenv = 0; this.renv = 0; this.row = 0.5; this.nudge = 0;
    this.ph = new Float64Array(64); this.basePh = 0; this.prevA = new Float32Array(64); this.curA = new Float32Array(64);
    this.uph = Float64Array.from({ length: 8 }, () => Math.random()); this.sv = [0, 0, 0, 0];
    this.prevH = new Float32Array(HMAX + 1); this.curH = new Float32Array(HMAX + 1); // one-lump / instrument: harmonic strengths
    this.bz = new Float32Array(128); this.pS = 0; this.pB = 0; this.age = 0; this.hc = new Float32Array(HMAX + 1); this.subPh = 0; this.rr = new Float32Array(HMAX + 1);
    this.pr = new Float64Array(8 * (HMAX + 1)).fill(1); this.pim = new Float64Array(8 * (HMAX + 1)); this.cs = new Float64Array(8 * (HMAX + 1)); this.sn = new Float64Array(8 * (HMAX + 1)); // free harmonics: phasors per copy x harmonic
    this.mph = Math.random(); this.fm0 = 1; this.am0 = 1; // body states, time since the strike, wobble
    this.ck = 0; this.c1 = 0; this.c2 = 0; // click: envelope and its two low-pass filters
    for (let u2 = 0; u2 < 8; u2++) { const ph = Math.random(); for (let h = 0; h <= HMAX; h++) { const j = u2 * (HMAX + 1) + h; this.pr[j] = Math.cos(2 * Math.PI * h * ph); this.pim[j] = Math.sin(2 * Math.PI * h * ph); } } // each copy starts at its own point of the cycle (like the other unisons)
  }
  start(m, P) { this.vel = m.vel ?? 1; this.astage = 'att'; this.fenv = 1; this.renv = 1; this.gate = true; this.nudge = m.nudge || 0; this.age = 0; this.ck = 1; } // ck: the click starts (only on a fresh strike)
}
class Lead extends (globalThis.AudioWorkletProcessor || class {}) {
  constructor() {
    super();
    this.sr = globalThis.sampleRate || 48000;
    this.p = { glide: 0.06, legato: 1, A: 0.002, D: 0.25, S: 0.6, R: 0.12, cutoff: 600, res: 0.6, envAmt: 3, fD: 0.25, keyTrack: 0.5,
      rowBase: 0.5, rowEnv: 0, rowD: 0.3, lfoAmt: 0, lfoRate: 2, smooth: 0.02, base: 0.6, drive: 1.5, accent: 0.5, clickAmt: 0, clickTone: 3000, clickLen: 0.006,
      mix: 0.5, uni: 7, detune: 22, width: 0.8, waveLv: 1, conn: 0, ser: 0.5, filt: 0, poly: 0, voices: 8, fuse: 0,
      tdiff: 0.7, hLen: 0.5, bodyAmt: 0.8, bodyQ: 12, togAmt: 0, togRate: 4, sub: 0, hdev: 0.35, hstr: 0.2 };
    this.K = 0; this.ratio = new Float32Array(0); this.amp = new Float32Array(0); this.rows = 1; this.tabs = null; this.TAB = 2048; this.WP = 1;
    this.wst = null; this.frames = 0; this.levels = 0; this.N = 2048; this.inst = null; this.bc = null;
    this.v = Array.from({ length: MAXV }, () => new Voice()); this.clock = 0;
    this.stack = []; this.lfoPh = 0; this.msgT = 0; this.last = this.v[0];
    if (this.port) this.port.onmessage = ({ data: m }) => this.msg(m);
  }
  allOff() { this.stack = []; for (const v of this.v) if (v.astage !== 'off') { v.gate = false; v.astage = 'rel'; } }
  msg(m) {
    const P = this.p;
    if (m.type === 'params') { const was = P.poly; Object.assign(P, m.p); if (P.poly !== was) this.allOff(); }
    else if (m.type === 'table') { this.K = m.K; this.ratio = m.ratio; this.amp = m.amp; this.rows = m.rows; }
    else if (m.type === 'waves') { this.tabs = m.tabs; this.TAB = m.TAB; this.WP = m.P || 1; this.tabsK = m.K; } // null = sines; WP bands top->bottom, K tables each (built for tabsK components)
    else if (m.type === 'inst') this.inst = m;
    else if (m.type === 'stack') { this.wst = m.data; this.frames = m.frames; this.levels = m.levels; this.N = m.N; }
    else if (m.type === 'allOff') this.allOff();
    else if (!P.poly) this.monoMsg(m);
    else this.polyMsg(m);
  }
  monoMsg(m) {
    const v = this.v[0], P = this.p; this.last = v;
    if (m.type === 'noteOn') {
      const was = this.stack.length > 0;
      this.stack = this.stack.filter((n) => n !== m.midi); this.stack.push(m.midi);
      v.fT = mtof(m.midi); v.midi = m.midi; v.nudge = m.nudge || 0;
      if (!was) v.f = v.fT; // glide only from a key that is still held (slide, like an acid line)
      if (!was || !P.legato) v.start(m, P); // retrigger
      v.gate = true;
    } else if (m.type === 'noteOff') {
      this.stack = this.stack.filter((n) => n !== m.midi);
      if (this.stack.length) { v.midi = this.stack[this.stack.length - 1]; v.fT = mtof(v.midi); } // back to the held key (glides)
      else { v.gate = false; v.astage = 'rel'; }
    }
  }
  polyMsg(m) {
    const P = this.p, n = Math.max(1, Math.min(MAXV, P.voices | 0)), vs = this.v.slice(0, n);
    if (m.type === 'noteOn') {
      // same key still sounding -> reuse it; else a silent voice; else the oldest released one; else the oldest
      let v = vs.find((x) => x.gate && x.midi === m.midi) || vs.find((x) => x.astage === 'off');
      if (!v) { const rel = vs.filter((x) => !x.gate); v = (rel.length ? rel : vs).reduce((a, b) => (a.t <= b.t ? a : b)); }
      if (v.astage === 'off') v.row = Math.min(1, Math.max(0, P.rowBase + (m.nudge || 0))); // fresh voice: start on its row
      v.midi = m.midi; v.f = v.fT = mtof(m.midi); v.t = ++this.clock; v.start(m, P); this.last = v;
    } else if (m.type === 'noteOff') {
      for (const v of this.v) if (v.gate && v.midi === m.midi) { v.gate = false; v.astage = 'rel'; }
    }
  }
  resetVoice(v) {
    v.sv = [0, 0, 0, 0]; v.bz.fill(0); v.pS = 0; v.pB = 0; v.prevH.fill(0); v.curH.fill(0); v.prevA.fill(0); v.curA.fill(0);
    for (const a of [v.ph, v.pim]) a.fill(0); v.pr.fill(1); v.basePh = 0; v.subPh = 0; v.uph.fill(0); v.fm0 = 1; v.am0 = 1;
    if (!isFinite(v.f)) v.f = v.fT; if (!isFinite(v.row)) v.row = 0.5;
  }
  // strength of every component at the voice's row, shaped by the filter, into curA
  shape(v, fc) {
    const K = this.K, P = this.p, r = Math.min(this.rows - 1, Math.max(0, v.row * (this.rows - 1))), r0 = r | 0, r1 = Math.min(this.rows - 1, r0 + 1), t = r - r0;
    for (let k = 0; k < K; k++) {
      const a = this.amp[r0 * K + k] * (1 - t) + this.amp[r1 * K + k] * t;
      if (P.fuse === 2) { v.curA[k] = 261.63 * this.ratio[k] < this.sr * 0.45 ? a : 0; continue; } // instrument: body strengths (fixed pitch)
      const rk = this.ratio[k], x = (v.f * rk) / fc, lx = Math.log2(x), cf = P.filt;
      const lp = cf ? 1 / Math.sqrt(1 + x * x * x * x) : 1; // 12 dB/oct (filt 0 = bypass)
      const peak = cf ? P.res * 6 * Math.exp(-0.5 * (lx / 0.2) ** 2) : 0; // resonance bump at the cutoff
      v.curA[k] = (v.f * rk < this.sr * 0.45) ? a * lp * (1 + peak) : 0;
    }
  }
  process(_, outputs) {
    const out = outputs[0]; if (!out || !out[0]) return true;
    const L = out[0], R = out[1] || out[0], n = L.length, P = this.p;
    L.fill(0); if (R !== L) R.fill(0);
    const vg = P.poly ? 0.5 : 1; // chord: each voice a bit lower
    if (P.fuse === 2 && (this.bcQ !== P.bodyQ || this.bcR !== this.ratio)) { // body resonators: fixed pitch, TPT band-pass coefficients
      this.bcQ = P.bodyQ; this.bcR = this.ratio; this.bc = new Float32Array(this.K * 3); const kq = 1 / Math.max(0.5, P.bodyQ);
      for (let k = 0; k < this.K; k++) { const g = Math.tan(Math.PI * Math.min(261.63 * this.ratio[k], this.sr * 0.45) / this.sr), a1 = 1 / (1 + g * (g + kq)); this.bc[k * 3] = a1; this.bc[k * 3 + 1] = g * a1; this.bc[k * 3 + 2] = g * g * a1; }
    }
    for (let b = 0; b < n; b += BLOCK) {
      const m = Math.min(BLOCK, n - b);
      this.lfoPh = (this.lfoPh + P.lfoRate * m / this.sr) % 1;
      const lfo = Math.sin(2 * Math.PI * this.lfoPh);
      for (const v of this.v) if (v.astage !== 'off') this.voiceBlock(v, L, R, b, m, lfo, vg); // every sounding voice (tails finish after a mode change)
      // safety: a broken number (NaN / Infinity) must never stick in a filter and silence the synth — clear and reset
      let bad = false; for (let i = b; i < b + m; i++) if (!(Math.abs(L[i]) < 1e6 && Math.abs(R[i]) < 1e6)) { bad = true; L[i] = 0; R[i] = 0; }
      if (bad) for (const v of this.v) this.resetVoice(v);
    }
    if ((this.msgT += n) > 1600 && this.port) { this.msgT = 0; this.port.postMessage({ row: this.last.row, env: this.last.aenv }); }
    return true;
  }
  voiceBlock(v, L, R, b, m, lfo, vg) {
    v.age += m / this.sr;
    const kE = 1 - Math.exp(-1 / (0.06 * this.sr)); // body level matching
    const sr = this.sr, P = this.p, dt = 1 / sr, K = this.K, TAU = Math.PI * 2;
    const kA = 1 / Math.max(1, P.A * sr), kD = 1 - Math.exp(-dt / Math.max(0.003, P.D / 4)), kR = 1 - Math.exp(-dt / Math.max(0.003, P.R / 4));
    const kF = Math.exp(-dt / Math.max(0.005, P.fD / 3)), kRow = Math.exp(-dt / Math.max(0.005, P.rowD / 3));
    const kG = !P.poly && P.glide > 0 ? 1 - Math.exp(-dt / P.glide) : 1;
    const kS = 1 - Math.exp(-(BLOCK * dt) / Math.max(0.0005, P.smooth));
    // click (11/20, like Quake's): a very short noise burst through two gentle low-passes, outside the ADSR and the drive
    const kC = Math.exp(-dt / Math.max(0.0003, (P.clickLen || 0.006) / 4)), aC = 1 - Math.exp(-2 * Math.PI * Math.min(P.clickTone || 3000, 18000) * dt);
    // move together: one irregular wobble for the whole voice, read from the row's brightness (inst.G: 128 points per row)
    let fm1 = 1, am1 = 1;
    if (P.togAmt > 0 && this.inst) {
      const I = this.inst, fr = Math.min(I.frames - 1, Math.max(0, Math.round(v.row * (I.frames - 1)))), q = v.mph * 128, j = q | 0, w = q - j;
      const g0 = I.G[fr * 128 + j], g1 = I.G[fr * 128 + ((j + 1) & 127)], gm = g0 + (g1 - g0) * w;
      fm1 = Math.pow(2, (P.togAmt * 12 * gm) / 1200); am1 = Math.max(0, 1 + P.togAmt * 0.4 * gm);
      v.mph = (v.mph + (P.togRate / 4) * m * dt) % 1; // one pass over the row = 4 wobbles at togRate
    }
    const fm0 = v.fm0, am0 = v.am0; v.fm0 = fm1; v.am0 = am1;
    // block-rate: row position, cutoff, component strengths
    const rowT = Math.min(1, Math.max(0, P.rowBase + v.nudge + P.rowEnv * v.renv + P.lfoAmt * 0.5 * lfo));
    v.row += (rowT - v.row) * kS;
    const acc = 1 + P.accent * (v.vel - 0.75);
    const fc = Math.min(sr * 0.45, P.cutoff * Math.pow(2, P.envAmt * v.fenv * acc + P.keyTrack * Math.log2(v.f / 261.63)));
    v.prevA.set(v.curA.subarray(0, K)); this.shape(v, fc);
    const fuse = P.fuse;
    let hTop = 0;
    const additive = fuse === 2;
    if (fuse === 2) { // instrument: the row's own harmonics, each with its own timing
      v.prevH.set(v.curH); v.curH.fill(0);
      const I = this.inst;
      if (I) {
        const IH = I.IH, W = IH + 1, fp = v.row * (I.frames - 1), f0 = fp | 0, f1 = Math.min(I.frames - 1, f0 + 1), tt = fp - f0, a = P.tdiff, age = v.age;
        const Bst = P.hstr * 0.0008;
        for (let h = 1; h <= Math.min(IH, HMAX); h++) {
          const dv = I.Dh ? I.Dh[f0 * W + h] * (1 - tt) + I.Dh[f1 * W + h] * tt : 0;
          v.rr[h] = h * Math.sqrt(1 + Bst * h * h) * Math.pow(2, (P.hdev * 60 * dv) / 1200); // stretched + photo-moved harmonic
          if (v.rr[h] * v.f * Math.pow(2, P.detune / 1200) >= sr * 0.45) continue;
          const amp = I.H[f0 * W + h] * (1 - tt) + I.H[f1 * W + h] * tt, br = I.Bh[f0 * W + h] * (1 - tt) + I.Bh[f1 * W + h] * tt;
          const delay = a * (1 - br) * 0.04, Lf = 1 + a * (0.15 + 0.85 * br - 1), tau = Math.max(0.01, P.hLen * (1 + a * ((0.3 + 1.4 * br) / Math.sqrt(h) - 1)));
          const e = age < delay ? 0 : Math.min(1, (age - delay) / 0.003) * (Lf + (1 - Lf) * Math.exp(-(age - delay) / tau));
          v.curH[h] = amp * e; hTop = h;
        }
      }
      v.curH[1] += P.base;
    }
    // layer 2 setup: which rows (frames) and which band-limited level, filter coefficients, unison spread
    const st = this.wst, useW = st && P.mix > 0.001 && fuse !== 2, nu = Math.max(1, Math.min(7, Math.round(P.uni)));
    const free = fuse === 2 && (P.hdev > 0 || P.hstr > 0);
    if (free) { // each harmonic its own rotating phasor: step angle per copy x harmonic for this block; keep them at length 1
      const W = HMAX + 1;
      for (let u2 = 0; u2 < nu; u2++) {
        const sp = nu > 1 ? (u2 / (nu - 1)) * 2 - 1 : 0, fc = v.f * Math.pow(2, (sp * P.detune) / 1200) * fm1;
        for (let h = 1; h <= hTop; h++) {
          const j = u2 * W + h, w = 2 * Math.PI * fc * v.rr[h] * dt; v.cs[j] = Math.cos(w); v.sn[j] = Math.sin(w);
          const mg = Math.hypot(v.pr[j], v.pim[j]); if (mg > 0) { v.pr[j] /= mg; v.pim[j] /= mg; } else v.pr[j] = 1;
        }
      }
    }
    let fA = 0, fB = 0, ft = 0, lv = 0, ga1 = 0, ga2 = 0, ga3 = 0;
    if (useW || fuse) {
      const fp = v.row * (this.frames - 1); fA = Math.floor(fp); fB = Math.min(this.frames - 1, fA + 1); ft = fp - fA;
      const fMax = v.f * Math.pow(2, (P.detune * 1.2) / 1200) * 1.5; // top unison voice, with some headroom for glide
      lv = 0; while (lv < this.levels - 1 && HARMS[lv] * fMax > sr * 0.45) lv++;
      const g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr), gk = 1 / (0.5 + P.res * 5);
      ga1 = 1 / (1 + g * (g + gk)); ga2 = g * ga1; ga3 = g * ga2;
    }
    // waves are rebuilt a moment after the table changes: until they match the table (tabsK), play sines
    const tabs = this.tabs && this.tabsK === K ? this.tabs : null, T = this.TAB, T1 = T + 1, wpp = v.row * (this.WP - 1), wp0 = Math.floor(wpp), wp1 = Math.min(this.WP - 1, wp0 + 1), wpt = wpp - wp0;
    const mc = fuse === 2 ? 1.8 : Math.min(1, 2 * (1 - P.mix)), mw = Math.min(1, 2 * P.mix) * 1.4, dn = Math.max(1, P.drive * 0.5); // at 50/50 both layers are at full level
    for (let i = 0; i < m; i++) {
      // envelopes
      if (v.astage === 'att') { v.aenv += kA; if (v.aenv >= 1) { v.aenv = 1; v.astage = 'dec'; } }
      else if (v.astage === 'dec') v.aenv += ((v.gate ? P.S : 0) - v.aenv) * kD;
      else if (v.astage === 'rel') { v.aenv -= v.aenv * kR; if (v.aenv < 1e-5) { v.aenv = 0; v.astage = 'off'; } }
      v.fenv *= kF; v.renv *= kRow;
      // glide in log-frequency (mono only)
      if (kG < 1) v.f *= Math.pow(v.fT / v.f, kG); else v.f = v.fT;
      const u = (i + 1) / m, fmu = fm0 + (fm1 - fm0) * u, dtf = dt * fmu; // move together: same pitch wobble for every part
      let s = 0, sl2 = 0, sr2 = 0, st2 = false;
      if (free) { // instrument, harmonics not exactly on the series: every harmonic of every copy rotates on its own
        st2 = true;
        const hc = v.hc, W = HMAX + 1; for (let h = 1; h <= hTop; h++) hc[h] = v.prevH[h] + (v.curH[h] - v.prevH[h]) * u;
        for (let u2 = 0; u2 < nu; u2++) {
          const sp = nu > 1 ? (u2 / (nu - 1)) * 2 - 1 : 0, o = u2 * W; let c = 0;
          for (let h = 1; h <= hTop; h++) {
            const j = o + h, re = v.pr[j], im = v.pim[j], cs = v.cs[j], sn = v.sn[j];
            v.pr[j] = re * cs - im * sn; v.pim[j] = re * sn + im * cs; c += v.pim[j] * hc[h];
          }
          const pan = sp * P.width; sl2 += c * (1 - Math.max(0, pan)); sr2 += c * (1 + Math.min(0, pan));
        }
        const gn = 1 / Math.sqrt(nu); sl2 *= gn; sr2 *= gn; s = (sl2 + sr2) * 0.5;
      } else if (additive && fuse === 2 && nu > 1) { // instrument unison: several detuned copies of the harmonic source, spread left/right
        st2 = true;
        const hc = v.hc; for (let h = 1; h <= hTop; h++) hc[h] = v.prevH[h] + (v.curH[h] - v.prevH[h]) * u;
        for (let u2 = 0; u2 < nu; u2++) {
          const sp = (u2 / (nu - 1)) * 2 - 1;
          v.uph[u2] += v.f * Math.pow(2, (sp * P.detune) / 1200) * dtf; if (v.uph[u2] >= 1) v.uph[u2] -= 1;
          const th = v.uph[u2] * TAU, c2 = 2 * Math.cos(th);
          let s1 = Math.sin(th), s0 = 0, c = 0;
          for (let h = 1; h <= hTop; h++) { c += s1 * hc[h]; const s2 = c2 * s1 - s0; s0 = s1; s1 = s2; }
          const pan = sp * P.width; sl2 += c * (1 - Math.max(0, pan)); sr2 += c * (1 + Math.min(0, pan));
        }
        const gn = 1 / Math.sqrt(nu); sl2 *= gn; sr2 *= gn; s = (sl2 + sr2) * 0.5;
      } else if (additive) { // phase-locked harmonics from one phase: sin(h*th) by recurrence
        v.basePh += v.f * dtf; if (v.basePh >= 1) v.basePh -= 1;
        const th = v.basePh * TAU, c2 = 2 * Math.cos(th);
        let s1 = Math.sin(th), s0 = 0;
        for (let h = 1; h <= hTop; h++) { s += s1 * (v.prevH[h] + (v.curH[h] - v.prevH[h]) * u); const s2 = c2 * s1 - s0; s0 = s1; s1 = s2; }
      } else for (let k = 0; k < K; k++) {
        const a = v.prevA[k] + (v.curA[k] - v.prevA[k]) * u; // ramp across the block: no zipper
        if (a > 1e-6) {
          if (tabs && !fuse) { // the photo row's waveform near the current row: crossfade the two nearest bands
            const q = v.ph[k] * T, j = q | 0, fr = q - j, o0 = (wp0 * K + k) * T1, o1 = (wp1 * K + k) * T1;
            const w0 = tabs[o0 + j] + (tabs[o0 + j + 1] - tabs[o0 + j]) * fr, w1 = tabs[o1 + j] + (tabs[o1 + j + 1] - tabs[o1 + j]) * fr;
            s += (w0 + (w1 - w0) * wpt) * a;
          } else s += Math.sin(v.ph[k] * TAU) * a;
        }
        v.ph[k] += (v.f * this.ratio[k]) * dtf; if (v.ph[k] >= 1) v.ph[k] -= Math.floor(v.ph[k]);
      }
      if (!additive) { // the played pitch itself (keeps the note readable as a lead)
        v.basePh += v.f * dtf; if (v.basePh >= 1) v.basePh -= 1;
        const xb = v.f / fc, baseW = P.filt && !fuse ? 1 / Math.sqrt(1 + xb * xb * xb * xb) : 1;
        s += Math.sin(v.basePh * TAU) * P.base * baseW;
      }
      if (fuse === 2 && P.bodyAmt > 0 && this.bc) { // the body: fixed-pitch resonances from the row's colors
        const bz = v.bz, bc = this.bc, kq = 1 / Math.max(0.5, P.bodyQ); let bs = 0;
        for (let k = 0; k < K; k++) {
          const a = v.prevA[k] + (v.curA[k] - v.prevA[k]) * u, z = k * 2;
          if (a <= 1e-4) { bz[z] = 0; bz[z + 1] = 0; continue; } // silent resonance: start clean when it comes back
          const o = k * 3, v3 = s - bz[z + 1], v1 = bc[o] * bz[z] + bc[o + 1] * v3, v2 = bz[z + 1] + bc[o + 1] * bz[z] + bc[o + 2] * v3;
          bz[z] = 2 * v1 - bz[z]; bz[z + 1] = 2 * v2 - bz[z + 1]; bs += v1 * kq * a;
        }
        // the body changes the color, not the loudness: match its level to the source (slow, ~60 ms)
        v.pS += (s * s - v.pS) * kE; v.pB += (bs * bs - v.pB) * kE;
        const bg = bs * P.bodyAmt * Math.min(30, Math.sqrt(v.pS / (v.pB + 1e-9)));
        if (st2) { const sd = (sl2 - sr2) * 0.5; s = s * (1 - P.bodyAmt) + bg; sl2 = s + sd; sr2 = s - sd; } // the body replaces only the middle; the copies' spread stays
        else s = s * (1 - P.bodyAmt) + bg;
      }
      // layer 2: row waveform x unison, through the resonant low-pass
      let wl = 0, wr = 0;
      if (useW) {
        const N = this.N, oA = (fA * this.levels + lv) * N, oB = (fB * this.levels + lv) * N;
        const sm = P.conn ? Math.tanh(s * 1.5) : 0, pm = P.conn === 1 ? sm * P.ser * 1.5 : 0; // layer 1, bounded
        for (let u2 = 0; u2 < nu; u2++) {
          const sp = nu === 1 ? 0 : (u2 / (nu - 1)) * 2 - 1, fr = v.f * Math.pow(2, (sp * P.detune) / 1200);
          let ph2 = v.uph[u2] + pm; ph2 -= Math.floor(ph2);
          const q = ph2 * N, j = q | 0, j1 = (j + 1) % N, t = q - j;
          const a0 = st[oA + j] + (st[oA + j1] - st[oA + j]) * t, a1 = st[oB + j] + (st[oB + j1] - st[oB + j]) * t;
          const smp = a0 + (a1 - a0) * ft, pan = sp * P.width;
          wl += smp * (1 - Math.max(0, pan)); wr += smp * (1 + Math.min(0, pan));
          v.uph[u2] += fr * dtf; if (v.uph[u2] >= 1) v.uph[u2] -= 1;
        }
        const gu = (P.waveLv / Math.sqrt(nu)) * (P.conn === 2 ? 1 - P.ser + P.ser * 2 * sm : 1);
        wl *= gu; wr *= gu;
        if (P.filt && !fuse) { // TPT state-variable low-pass, one per side (skipped when the filter is off; one-lump filters the sum below)
          const sv = v.sv;
          let v3 = wl - sv[1], v1 = ga1 * sv[0] + ga2 * v3, v2 = sv[1] + ga2 * sv[0] + ga3 * v3; sv[0] = 2 * v1 - sv[0]; sv[1] = 2 * v2 - sv[1]; wl = v2;
          v3 = wr - sv[3]; v1 = ga1 * sv[2] + ga2 * v3; v2 = sv[3] + ga2 * sv[2] + ga3 * v3; sv[2] = 2 * v1 - sv[2]; sv[3] = 2 * v2 - sv[3]; wr = v2;
        }
      }
      const g = v.aenv * (0.6 + 0.4 * v.vel) * acc * (am0 + (am1 - am0) * u);
      let xl = (st2 ? sl2 : s) * mc + wl * mw, xr = (st2 ? sr2 : s) * mc + wr * mw;
      if (fuse && P.filt) { // one-lump: both layers through ONE resonant low-pass
        const sv = v.sv;
        let v3 = xl - sv[1], v1 = ga1 * sv[0] + ga2 * v3, v2 = sv[1] + ga2 * sv[0] + ga3 * v3; sv[0] = 2 * v1 - sv[0]; sv[1] = 2 * v2 - sv[1]; xl = v2;
        v3 = xr - sv[3]; v1 = ga1 * sv[2] + ga2 * v3; v2 = sv[3] + ga2 * sv[2] + ga3 * v3; sv[2] = 2 * v1 - sv[2]; sv[3] = 2 * v2 - sv[3]; xr = v2;
      }
      let sb = 0;
      if (P.sub > 0) { v.subPh += v.f * 0.5 * dtf; if (v.subPh >= 1) v.subPh -= 1; sb = Math.sin(v.subPh * TAU) * P.sub * g * 0.35; } // sub: one octave below, clean (after the drive)
      let ckv = 0;
      if (v.ck > 1e-4) { if (P.clickAmt > 0) { const r = Math.random() * 2 - 1; v.c1 += (r - v.c1) * aC; v.c2 += (v.c1 - v.c2) * aC; ckv = v.c2 * v.ck * P.clickAmt * (0.6 + 0.4 * v.vel) * acc * 4; } v.ck *= kC; }
      L[b + i] += ((Math.tanh(xl * g * P.drive * 0.5) / dn) * 0.6 + sb + ckv) * vg;
      R[b + i] += ((Math.tanh(xr * g * P.drive * 0.5) / dn) * 0.6 + sb + ckv) * vg;
    }
  }
}
if (globalThis.registerProcessor) registerProcessor('lead-synth', Lead);
export { Lead };
