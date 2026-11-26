// Photo -> components, counting pixel by pixel (pure functions, no DOM)
// hue = note name (one turn of the color wheel = 12 semitones), brightness = octave, chroma = strength.
// Grayish pixels have no hue and make no sound (their share is only counted for display).
import { fft } from '../js/fft.js?v=1';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi) => NAMES[((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// opt: { fine (hue bins per semitone: 1 = snap to semitones), redNote (0..11, which note red is), octLo, octHi (MIDI octave numbers),
//       rect: {x0, y0, x1, y1} in pixels (optional: count only inside) }
export function countPixels(img, opt) {
  const { data, width: w, height: h } = img;
  const fine = opt.fine, cols = 12 * fine, octs = opt.octHi - opt.octLo + 1;
  const tone = new Float32Array(cols * octs), gray = new Float32Array(octs), pixCell = new Int32Array(w * h), pixOct = new Uint8Array(w * h), pixChroma = new Float32Array(w * h), cellN = new Float32Array(cols * octs);
  let total = 0;
  const R = opt.rect || { x0: 0, y0: 0, x1: w, y1: h };
  pixCell.fill(-2); // -2 = outside the area
  for (let y = Math.max(0, R.y0); y < Math.min(h, R.y1); y++) for (let x = Math.max(0, R.x0); x < Math.min(w, R.x1); x++) {
    const p = y * w + x, i = p * 4;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn; // chroma = how colorful (0 = gray)
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const o = Math.min(octs - 1, Math.floor(L * octs));
    gray[o] += 1 - c; pixOct[p] = o; pixChroma[p] = c;
    total++;
    if (c < 1e-3) { pixCell[p] = -1; continue; }
    let hue = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; // 0..6
    hue = ((hue / 6) % 1 + 1) % 1; // 0..1 starting at red
    const col = Math.floor(hue * cols) % cols;
    tone[o * cols + col] += c; cellN[o * cols + col]++;
    pixCell[p] = o * cols + col;
  }
  return { cols, octs, fine, tone, cellN, gray, total, pixCell, pixOct, pixChroma, w, h, opt };
}

// Turn the counts into components (frequency + strength). gamma > 1 keeps only the dominant colors.
// perm: which note each of the 12 color sectors plays (perm[i] = semitones above the red note; null = in order, the default)
export function toPartials(cnt, { gamma = 1, thr = 0.02, max = 96, redNote = 0, octLo = 2, perm = null }) {
  let top = 0; for (const v of cnt.tone) top = Math.max(top, v);
  const out = [];
  for (let o = 0; o < cnt.octs; o++) for (let k = 0; k < cnt.cols; k++) {
    const v = cnt.tone[o * cnt.cols + k];
    if (!v) continue;
    const a = Math.pow(v / top, gamma);
    if (a < thr) continue;
    const sec = Math.floor(k / cnt.fine), semis = (perm ? perm[sec] : sec) + (k + 0.5) / cnt.fine - 0.5 - sec; // bin center, in semitones above the red note
    const midi = 12 * (octLo + o + 1) + redNote + semis;
    out.push({ cell: o * cnt.cols + k, midi, f: mtof(midi), a, share: v / cnt.total, hue: k / cnt.cols, oct: o, chroma: v / cnt.cellN[o * cnt.cols + k] });
  }
  out.sort((p, q) => q.a - p.a);
  return out.slice(0, max);
}

/* ---------- One-cycle waveform per component, read from the photo row where its color is most common ---------- */
// rows: index of the most common row (inside the area) for each component
export function bestRows(cnt, parts, rect) {
  const w = cnt.w, R = rect || { x0: 0, y0: 0, x1: cnt.w, y1: cnt.h }, rh = Math.max(1, R.y1 - R.y0);
  const idx = new Map(parts.map((p, k) => [p.cell, k])), rows = parts.map(() => new Float32Array(rh));
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) { const k = idx.get(cnt.pixCell[y * w + x]); if (k !== undefined) rows[k][y - R.y0]++; }
  return rows.map((r) => { let b = 0; for (let y = 1; y < rh; y++) if (r[y] > r[b]) b = y; return R.y0 + b; });
}
// Brightness along that row (area width) = one cycle. Returns harmonics {re, im} 1..H per component
export function rowWaves(img, cnt, parts, { rect, H = 64 }) {
  const { data, width: w } = img, R = rect || { x0: 0, y0: 0, x1: img.width, y1: img.height }, rw = Math.max(2, R.x1 - R.x0), N = 1024;
  const rows = bestRows(cnt, parts, rect);
  return parts.map((p, k) => {
    const y = rows[k]; p.waveRow = y;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { // resample the row to N points
      const fx = R.x0 + (i / N) * (rw - 1), x0 = Math.floor(fx), x1 = Math.min(R.x1 - 1, x0 + 1), t = fx - x0;
      const l = (j) => (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
      re[i] = l((y * w + x0) * 4) * (1 - t) + l((y * w + x1) * 4) * t;
    }
    const sm = Math.round(N * 0.06); // blend the end toward the start so the cycle joins without a click
    for (let i = 0; i < sm; i++) { const t = (i + 1) / (sm + 1); re[N - sm + i] = re[N - sm + i] * (1 - t) + re[0] * t; }
    fft(re, im);
    return { re: Float32Array.from({ length: H + 1 }, (_, h) => re[h] / N), im: Float32Array.from({ length: H + 1 }, (_, h) => im[h] / N) };
  });
}
// Rebuild one cycle from the first nh harmonics (no DC), peak 1. Table has TAB+1 points (last = first)
// fund: mix in a sine at the component's own pitch (keeps the pitch even when the row repeats a pattern)
export function buildTable(wv, nh, TAB = 4096, fund = 0) {
  const t = new Float32Array(TAB + 1);
  for (let h = 1; h <= nh && h < wv.re.length; h++) {
    const a = wv.re[h], b = wv.im[h];
    if (Math.abs(a) + Math.abs(b) < 1e-9) continue;
    for (let i = 0; i < TAB; i++) { const ph = (2 * Math.PI * h * i) / TAB; t[i] += 2 * (a * Math.cos(ph) - b * Math.sin(ph)); }
  }
  let pk = 0; for (let i = 0; i < TAB; i++) pk = Math.max(pk, Math.abs(t[i]));
  if (pk < 1e-9) { for (let i = 0; i < TAB; i++) t[i] = Math.sin((2 * Math.PI * i) / TAB); pk = 1; } // flat row: fall back to a sine
  for (let i = 0; i < TAB; i++) t[i] = (t[i] / pk) * (1 - fund) + Math.sin((2 * Math.PI * i) / TAB) * fund;
  pk = 0; for (let i = 0; i < TAB; i++) pk = Math.max(pk, Math.abs(t[i]));
  for (let i = 0; i < TAB; i++) t[i] /= pk || 1;
  t[TAB] = t[0];
  return t;
}
/* ---------- Harmony: pull each component's pitch toward consonant or dissonant intervals ---------- */
// Root = the strongest component. Each component's interval above the root (within the octave) moves toward the
// nearest target by `amount` (0 = as the photo says, 1 = exactly on the target).
//  consonant: pure (just) intervals of the chosen chord — they ring without beating; detuned neighbors collapse onto one pitch
//  dissonant: minor 2nd / tritone / major 7th, plus a little alternating detune so close pairs rub (roughness)
const CHORDS = { major: [0, 386.3, 702], minor: [0, 315.6, 702], open: [0, 498, 702], seventh: [0, 386.3, 702, 968.8] };
const DISSONANT = [100, 600, 1100];
export function harmonize(parts, { mode = 'normal', amount = 0.7, chord = 'major' } = {}) {
  if (mode === 'normal' || !parts.length) return parts;
  const root = parts[0].midi, set = mode === 'consonant' ? CHORDS[chord] || CHORDS.major : DISSONANT;
  return parts.map((p, k) => {
    if (k === 0) return { ...p };
    const c = (((p.midi - root) * 100) % 1200 + 1200) % 1200; // cents above the root, inside one octave
    let best = 0, bd = Infinity;
    for (const t of set) for (const tt of [t - 1200, t, t + 1200]) { const d = tt - c; if (Math.abs(d) < Math.abs(bd)) { bd = d; best = tt; } }
    let move = bd * amount;
    if (mode === 'dissonant') move += (k % 2 ? 1 : -1) * 18 * amount; // rub against each other
    const midi = p.midi + move / 100;
    return { ...p, midi, f: 440 * Math.pow(2, (midi - 69) / 12), moved: move };
  });
}

/* ---------- Merge components that are too close in pitch (they beat against each other = the fast flutter) ---------- */
// amt (0..1): components closer than amt x the ear's critical band (ERB) at that pitch are folded into the louder one.
// Inside about half a band two tones beat (wobble / fast flutter); merging them removes it.
// The louder one keeps its pitch; the strengths add as power, so the overall level stays the same.
const erbHz = (f) => 24.7 * (4.37 * f / 1000 + 1);
export function mergeClose(parts, amt = 0, max = Infinity) {
  if (!(amt > 0)) return parts.slice(0, max);
  const kept = [];
  for (const p of [...parts].sort((a, b) => b.a - a.a)) {
    const near = kept.find((k) => Math.abs(k.f - p.f) < amt * erbHz((k.f + p.f) / 2));
    if (near) { near.a = Math.sqrt(near.a * near.a + p.a * p.a); near.share += p.share; near.merged = (near.merged || 0) + 1; }
    else kept.push({ ...p });
  }
  let top = 0; for (const k of kept) top = Math.max(top, k.a);
  if (top > 1) for (const k of kept) k.a /= top;
  return kept.slice(0, max);
}

/* ---------- Thickness per component: how spread the color around it is ---------- */
// share of the pixels in the neighboring hue cells (±3, same brightness band) versus the cell itself.
// Even color -> 0 (a clean line), a smear of similar colors -> 1 (a breathy band)
export function thickness(cnt, parts) {
  return parts.map((p) => {
    const o = Math.floor(p.cell / cnt.cols), k = p.cell % cnt.cols;
    let own = cnt.tone[p.cell], nb = 0;
    for (let d = -3; d <= 3; d++) if (d) nb += cnt.tone[o * cnt.cols + ((k + d + cnt.cols) % cnt.cols)];
    return own + nb > 0 ? Math.min(1, nb / (own + nb) / 0.75) : 0;
  });
}

/* ---------- Fluctuation per component, from the grain of the photo ---------- */
// Each component reads its own row (the row where its color is most common) across the area:
//   slow = the row's broad light/dark swell (heavily smoothed), fast = the fine grain left over.
// Both are looped while the note plays. grain = how rough the area is (0 smooth .. 1 rough) -> overall amount.
export function wobbles(img, cnt, parts, { rect, N = 256, ROWS = 16 }) {
  if (!parts.length) return null;
  const { data, width: w } = img, R = rect || { x0: 0, y0: 0, x1: img.width, y1: img.height }, rw = Math.max(4, R.x1 - R.x0), rh = Math.max(1, R.y1 - R.y0);
  const rows = bestRows(cnt, parts, rect), step = Math.max(1, Math.round(rh / 64));
  const lum = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  const norm = (a) => { let k = 0; for (const v of a) k = Math.max(k, Math.abs(v)); if (k > 1e-4) for (let i = 0; i < a.length; i++) a[i] /= k; return a; };
  const readRow = (y) => { const raw = new Float32Array(N); for (let i = 0; i < N; i++) { const fx = R.x0 + (i / N) * (rw - 1), x0 = Math.floor(fx), x1 = Math.min(R.x1 - 1, x0 + 1), t = fx - x0; raw[i] = lum(x0, y) * (1 - t) + lum(x1, y) * t; } return raw; };
  const split = (raw) => { // slow = smoothed swell (mean removed), fast = the grain left over (lightly smoothed)
    const win = Math.max(2, Math.round(N / 10)), slow = new Float32Array(N), fast = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let d = -win; d <= win; d++) s += raw[(i + d + N) % N]; slow[i] = s / (2 * win + 1); }
    let m = 0; for (let i = 0; i < N; i++) m += slow[i]; m /= N;
    for (let i = 0; i < N; i++) { fast[i] = raw[i] - slow[i]; slow[i] -= m; }
    const f2 = new Float32Array(N); for (let i = 0; i < N; i++) f2[i] = (fast[(i - 1 + N) % N] + 2 * fast[i] + fast[(i + 1) % N]) / 4;
    return { slow, fast: f2 };
  };
  let gSum = 0;
  const sig = rows.map((y) => {
    const own = split(readRow(y));
    // the grain is read from ROWS neighboring rows in turn (y, y+step, ...), so the flutter does not repeat every cycle
    const F = new Float32Array(N * ROWS); let fv = 0;
    for (let r = 0; r < ROWS; r++) {
      const yy = Math.min(R.y1 - 1, Math.max(R.y0, y + (r - (ROWS >> 1)) * step));
      const f = r === ROWS >> 1 ? own.fast : split(readRow(yy)).fast;
      F.set(f, r * N);
      for (const v of f) fv += v * v;
    }
    const g = Math.sqrt(fv / F.length); gSum += g;
    return { slow: norm(own.slow), F: norm(F), N, ROWS, g, y };
  });
  const gMean = gSum / sig.length;
  sig.forEach((s) => (s.rough = gMean > 1e-6 ? s.g / gMean : 1)); // this component's grain relative to the others
  return { sig, grain: Math.min(1, gMean / 0.06) };
}

/* ---------- Time shape per component, read from the photo (left = start, right = end of the area) ---------- */
// rule 'pixels': where that component's own pixels are, left to right
// rule 'row'   : brightness along the row where that component's color is most common
// rule 'rank'  : rows top->bottom assigned to components high->low
export function envelopes(img, cnt, parts, { rule, rect, E = 96, smooth = 0.3, circular = true }) {
  if (rule === 'none' || !parts.length) return null;
  const { data, width: w, height: h } = img;
  const R = rect || { x0: 0, y0: 0, x1: w, y1: h }, rw = Math.max(1, R.x1 - R.x0), rh = Math.max(1, R.y1 - R.y0);
  const out = parts.map(() => new Float32Array(E));
  const idx = new Map(parts.map((p, k) => [p.cell, k]));
  const luma = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  const rowLine = (y, e) => { for (let b = 0; b < E; b++) { const x0 = R.x0 + Math.floor((b * rw) / E), x1 = Math.max(x0 + 1, R.x0 + Math.floor(((b + 1) * rw) / E)); let s = 0; for (let x = x0; x < x1; x++) s += luma(x, y); e[b] = s / (x1 - x0); } };
  if (rule === 'pixels') {
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
      const k = idx.get(cnt.pixCell[y * w + x]); if (k === undefined) continue;
      out[k][Math.min(E - 1, Math.floor(((x - R.x0) * E) / rw))] += cnt.pixChroma[y * w + x];
    }
  } else if (rule === 'row') {
    const rows = parts.map(() => new Float32Array(rh));
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) { const k = idx.get(cnt.pixCell[y * w + x]); if (k !== undefined) rows[k][y - R.y0]++; }
    parts.forEach((p, k) => { let best = 0; for (let y = 1; y < rh; y++) if (rows[k][y] > rows[k][best]) best = y; rowLine(R.y0 + best, out[k]); p.row = R.y0 + best; });
  } else if (rule === 'rank') {
    const order = parts.map((p, k) => k).sort((a, b) => parts[b].f - parts[a].f);
    order.forEach((k, r) => { const y = R.y0 + Math.min(rh - 1, Math.floor(((r + 0.5) * rh) / order.length)); rowLine(y, out[k]); parts[k].row = y; });
  }
  // smooth (moving average) and normalize each to a peak of 1
  const win = Math.round(smooth * E * 0.15);
  for (const e of out) {
    if (win > 0) { // circular for looping (hold); otherwise the ends are not joined, so the start stays sharp
      const c = Float32Array.from(e);
      for (let b = 0; b < E; b++) {
        let s = 0, m = 0;
        for (let d = -win; d <= win; d++) { const j = b + d; if (circular) { s += c[(j + E) % E]; m++; } else if (j >= 0 && j < E) { s += c[j]; m++; } }
        e[b] = s / m;
      }
    }
    let m = 0; for (const v of e) m = Math.max(m, v);
    if (m > 0) for (let b = 0; b < E; b++) e[b] /= m;
  }
  return out;
}

/* ---------- One note = key-strike shape (ADSR) x the photo's time shape ---------- */
// Each component is a sine.
//   level(t) = attack ramp x (S + (1-S) e^(-t/Dk)) x photo gain(t)
//   Dk = D x (f / C4)^(-hd): higher components drop faster.  photo gain = (1-depth) + depth x env(t mod envDur)
// Returns { L, R, loopStart, loopEnd } in samples: the head plays once, then [loopStart, loopEnd) repeats while held.
// waves (optional): per component, the harmonics of a one-cycle waveform (from rowWaves); nh = how many harmonics to use.
// Then each component is that waveform instead of a sine.
export function renderNote(partials, { sr, A = 0.003, D = 0.4, S = 0.3, hd = 0.6, env = null, envDur = 2, depth = 0.6, loopSec = 12, waves = null, nh = 12, fund = 0.3, wob = null, wobAmt = 0, wobSpeed = 1, wobTogether = 0.5, wobVary = 0.6, wobSwing = 0.5, wobCents = 8, wobAmpD = 0.35, wobSlow = 0.75, wobFast = 0.25, thick = null, noiseAmt = 0, noiseWidth = 1, noiseWob = 0.5, noiseWobW = 0.3, spread = 0.6 }) {
  const Dk = (p) => Math.max(0.005, D * Math.pow(p.f / 261.63, -hd));
  let dmax = 0; for (const p of partials) dmax = Math.max(dmax, Dk(p));
  const sustain = S > 0.001;
  const P = env ? Math.max(1, Math.round(sr * envDur)) : 0;
  const Xs = Math.round(sr * Math.min(0.3, env ? envDur / 2 : 0.3)); // crossfade length at the loop end
  let Hs = Math.round(sr * Math.min(12, A + (S < 0.999 ? 5 * dmax : 0)));
  if (sustain) Hs = Math.max(Hs, Xs);
  const Ls = sustain ? (env ? P * Math.max(1, Math.ceil((sr * loopSec) / P)) : Math.round(sr * loopSec)) : 0;
  const n = Hs + Ls + (sustain ? 0 : Math.round(sr * 0.05));
  const L = new Float64Array(n), R = new Float64Array(n);
  // fluctuation periods: whole divisions of the loop so the wobble also joins seamlessly
  // Fluctuation timing. Everything is a whole number of cycles per loop, so the wobble joins seamlessly.
  //  - each component has its own speed (rougher row = faster flutter), spread by wobVary
  //  - the flutter speed itself swells with the row's broad light/dark (wobSwing): brighter stretch = faster
  const span = Ls || Math.round(sr * 12), secs = span / sr;
  // widths: pitch in cents, level as a fraction; a smooth area wobbles less (x0.25 .. x1 by grain)
  const gs = wob ? 0.25 + 0.75 * wob.grain : 0, cents = wobCents * gs, ampD = wobAmpD * gs;
  const useWob = wob && wobAmt > 0 && (cents > 0 || ampD > 0) && (wobSlow > 0 || wobFast > 0);
  const timing = (sg) => {
    if (sg.t) return sg.t;
    const f = Math.pow(2, Math.max(-1, Math.min(1, Math.log2(sg.rough || 1))) * wobVary); // 0.5x .. 2x
    const nSlow = Math.max(1, Math.round((secs / 6) * wobSpeed * Math.sqrt(f)));
    const nFast = Math.max(1, Math.round((secs / 0.75) * wobSpeed * f));
    const C = new Float32Array(sg.N + 1), m = Math.min(0.85, wobSwing * 0.85); // cumulative reading speed over one loop
    for (let j = 0; j < sg.N; j++) C[j + 1] = C[j] + 1 + m * sg.slow[j];
    for (let j = 0; j <= sg.N; j++) C[j] /= C[sg.N];
    return (sg.t = { nSlow, nFast, C });
  };
  const sigAt = (sg, i, off, ws = wobSlow, wf = wobFast) => { // slow swell + quick flutter at sample i (off shifts the reading point)
    const { nSlow, nFast, C } = timing(sg), N = sg.N, u = (i / span + off) % 1;
    const qs = ((u * nSlow) % 1) * N, s0 = qs | 0;
    const cu = u * N, c0 = cu | 0, ph = nFast * (C[c0] + (C[c0 + 1] - C[c0]) * (cu - c0)); // flutter position (in row-cycles)
    const qf = (ph % sg.ROWS) * N, f0 = qf | 0, FL = sg.F.length;
    return ws * (sg.slow[s0] + (sg.slow[(s0 + 1) % N] - sg.slow[s0]) * (qs - s0)) + wf * (sg.F[f0 % FL] + (sg.F[(f0 + 1) % FL] - sg.F[f0 % FL]) * (qf - f0));
  };
  if (wob) wob.sig.forEach((sg) => (sg.t = null)); // knobs may have changed since the last render
  const TAB = 4096, sin = Float32Array.from({ length: TAB + 1 }, (_, i) => Math.sin((2 * Math.PI * i) / TAB));
  // Stereo (spread 0 = mono .. 1 = wide):
  //  - place: the loudest component goes left, the next right, and so on, each 50-100% of the way out (so the ones you
  //    hear most do not pile up in the middle); low ones (under ~250 Hz) are kept nearer the middle. Equal-power pan.
  //  - the far side hears it a little later (up to 0.6 ms, at most a quarter of its cycle so mono does not cancel it)
  //  - each one drifts slowly from its place and back (whole cycles per loop, so the loop still joins)
  //  - its breath (noise) is a different noise on each side
  const side = new Map([...partials].sort((a, b) => b.a - a.a).map((p, r) => [p, r % 2 ? 1 : -1]));
  partials.forEach((p, k) => {
    if (p.f > sr * 0.45) return;
    const kD = Math.exp(-1 / (Dk(p) * sr)), aStep = 1 / Math.max(1, A * sr);
    const low = Math.min(1, Math.max(0.2, (p.f - 60) / 190)); // under ~250 Hz: nearer the middle
    const pan = side.get(p) * (0.5 + 0.5 * Math.random()) * spread * low, th = ((pan + 1) * Math.PI) / 4;
    const gl = Math.cos(th) * Math.SQRT2, gr = Math.sin(th) * Math.SQRT2; // equal power (1 / 1 in the middle)
    const dly = Math.round(Math.min(0.0006 * Math.abs(pan), 0.25 / p.f) * sr), dL = pan > 0 ? dly : 0, dR = pan < 0 ? dly : 0; // the far side later
    const mCyc = Math.max(1, Math.round(secs / (8 + 12 * Math.random()))), mPh = Math.random() * 2 * Math.PI, mD = 0.35 * spread * low; // slow drift
    let mL = gl, mR = gr;
    const e = env && env[k], E = e ? e.length : 0;
    let ph = Math.random() * TAB, dec = 1, att = 0;
    const inc = (p.f / sr) * TAB;
    // harmonics limited so that even one octave up nothing passes the top of the audible range (no aliasing)
    const tbl = waves && waves[k] ? buildTable(waves[k], Math.max(1, Math.min(nh, Math.floor((sr * 0.45) / (2 * p.f)))), TAB, fund) : null;
    const wAmp = tbl ? p.a : 0;
    const own = useWob ? wob.sig[k] : null, lead = useWob ? wob.sig[0] : null;
    let cwi = inc, cwa = 1;
    // breath: white noise through a narrow bandpass at this component's pitch (width from the color spread)
    const useN = noiseAmt > 0;
    const bwOf = (f) => Math.max(1, f * (0.004 + 0.06 * (thick ? thick[k] : 0.3)) * noiseWidth); // band width in Hz
    let nb1 = 0, nb2 = 0, rb1 = 0, rb2 = 0, na1 = 0, na2 = 0, na3 = 0, nk = 0, ng = 0; // r…: the right side's own noise
    const nCoef = (f, wm = 1) => { const bw = bwOf(f) * wm, g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr), kk = bw / f; na1 = 1 / (1 + g * (g + kk)); na2 = g * na1; na3 = g * na2; nk = kk;
      ng = (p.a * noiseAmt * 0.707) / Math.sqrt((Math.PI * bw) / (3 * sr)) * (tbl ? 0.6 : 1); }; // level ~ the line's own level x amount
    if (useN) nCoef(p.f);
    // the breath has its own wobble, read from the same row at other points: how much (level) and how wide (band)
    const nsig = wob && useN && (noiseWob > 0 || noiseWobW > 0) ? wob.sig[k] : null;
    let nMod = 1;
    for (let i = 0; i < n; i++) {
      let x;
      let wi = inc, wa = 1;
      if (spread > 0 && (i & 15) === 0) { const m = mD * Math.sin((2 * Math.PI * mCyc * i) / span + mPh); mL = gl * (1 - m); mR = gr * (1 + m); }
      if ((own || nsig) && (i & 15) === 0) { // every 16 samples: pitch (cents) and level from the photo's grain
        let fp = 0, nW = 1;
        if (own) {
          fp = wobTogether * sigAt(lead, i, 0) + (1 - wobTogether) * sigAt(own, i, 0);
          const fa = wobTogether * sigAt(lead, i, 0.5) + (1 - wobTogether) * sigAt(own, i, 0.5);
          cwi = inc * (1 + fp * cents * 0.000578); cwa = Math.max(0, 1 + fa * ampD);
        }
        if (nsig) { // half swell, half flutter, so the breath both surges and rustles
          nMod = Math.max(0, 1 + noiseWob * sigAt(nsig, i, 0.25, 0.5, 0.5));
          nW = Math.pow(2, noiseWobW * 1.6 * sigAt(nsig, i, 0.75, 0.5, 0.5));
        }
        if (useN) nCoef(p.f * (1 + fp * cents * 0.000578), nW);
      }
      if (own) { wi = cwi; wa = cwa; }
      if (tbl) { const j = ph | 0; x = (tbl[j] + (tbl[j + 1] - tbl[j]) * (ph - j)) * wAmp * wa; ph += wi; if (ph >= TAB) ph -= TAB; }
      else { const j = ph | 0; x = (sin[j] + (sin[j + 1] - sin[j]) * (ph - j)) * p.a * wa; ph += wi; if (ph >= TAB) ph -= TAB; }
      att = Math.min(1, att + aStep); dec *= kD;
      let lv = att * (S + (1 - S) * dec);
      if (e) { const q = ((i % P) / P) * E, q0 = q | 0, q1 = (q0 + 1) % E; lv *= 1 - depth + depth * (e[q0] + (e[q1] - e[q0]) * (q - q0)); }
      let xr = x;
      if (useN) {
        const v3 = Math.random() * 2 - 1 - nb2, v1 = na1 * nb1 + na2 * v3, v2 = nb2 + na2 * nb1 + na3 * v3; nb1 = 2 * v1 - nb1; nb2 = 2 * v2 - nb2; x += nk * v1 * ng * wa * nMod;
        if (spread > 0) { const u3 = Math.random() * 2 - 1 - rb2, u1 = na1 * rb1 + na2 * u3, u2 = rb2 + na2 * rb1 + na3 * u3; rb1 = 2 * u1 - rb1; rb2 = 2 * u2 - rb2; xr += nk * u1 * ng * wa * nMod; }
        else xr = x;
      }
      if (i + dL < n) L[i + dL] += x * lv * mL;
      if (i + dR < n) R[i + dR] += xr * lv * mR;
      if (!sustain && i > Hs && lv < 1e-5) break;
    }
  });
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = pk ? 1 / pk : 0;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  if (sustain) { // blend the loop's end toward what comes just before loopStart, so the jump back is seamless
    for (const ch of [L, R]) for (let i = 0; i < Xs; i++) { const t = i / Xs, a = Hs + Ls - Xs + i; ch[a] = ch[a] * (1 - t) + ch[Hs - Xs + i] * t; }
  } else { const f = Math.round(sr * 0.05); for (const ch of [L, R]) for (let i = 0; i < f; i++) ch[n - f + i] *= 1 - i / f; }
  pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g2 = pk ? 0.85 / pk : 0;
  const len = sustain ? Hs + Ls : n;
  return { L: Float32Array.from(L.subarray(0, len), (v) => v * g2), R: Float32Array.from(R.subarray(0, len), (v) => v * g2), loopStart: sustain ? Hs : 0, loopEnd: sustain ? Hs + Ls : 0 };
}

