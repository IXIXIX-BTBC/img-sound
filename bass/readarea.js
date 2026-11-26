// Read the chosen photo area and turn it into the sine's character (pure functions, no DOM).
// What is measured (all 0..1):
//  bright   = mean brightness                     contrast = how spread the brightness is (standard deviation)
//  chroma   = how colorful (mean of max-min of RGB) grain   = roughness: mean brightness step to the next pixel
//  hueSpread = how many different hues (1 - length of the mean hue vector, weighted by chroma)
// How it becomes character (each 0..1, then times "photo amount"):
//  sat    (overdrive, odd harmonics)  <- contrast   : strong light/dark = harder edge
//  asym   (lopsided, even harmonics)  <- chroma     : colorful = warmer, thicker
//  shape  (bent cycle)                <- how far the brightness is from middle gray (very dark / very bright = leaning)
//  resist (rounding after overdrive)  <- darkness   : dark = more drag, rounder
//  jitter (cycle-to-cycle unsteadiness) <- grain    : rough texture = unsteady
//  drift  (slow pitch wander)          <- hueSpread : many colors = wandering
//  noise  (hiss)                       <- grain, only the rough part; it has its own amount (noiseAmt) instead of the photo amount
// Attack click (the 'tock' of a finger / pick at the start of a note) <- edges: how sharp the strongest light/dark steps are
//  (mean of the top 2% steps). hard = sharp edges -> short, bright click / soft = blurry -> longer, duller thump.
export function measure(img, rect) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h };
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1);
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000))); // about 40k samples at most
  let n = 0, sL = 0, sL2 = 0, sC = 0, sG = 0, nG = 0, hx = 0, hy = 0, wsum = 0; const steps = [];
  const lum = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = (y * w + x) * 4, r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, L = lum(i);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    n++; sL += L; sL2 += L * L; sC += c;
    if (x + 1 < x1) { const d = Math.abs(lum(i + 4) - L); sG += d; nG++; steps.push(d); }
    if (y + 1 < y1) { const d = Math.abs(lum(i + w * 4) - L); sG += d; nG++; steps.push(d); }
    if (c > 0.05) { let hue = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; hue = (hue / 6) * 2 * Math.PI; hx += Math.cos(hue) * c; hy += Math.sin(hue) * c; wsum += c; }
  }
  const bright = sL / n, contrast = Math.min(1, Math.sqrt(Math.max(0, sL2 / n - bright * bright)) / 0.35), chroma = Math.min(1, (sC / n) / 0.6);
  const grain = Math.min(1, (sG / Math.max(1, nG)) / 0.12), hueSpread = wsum > 0 ? 1 - Math.hypot(hx, hy) / wsum : 0;
  steps.sort((a, b) => b - a); const top = steps.slice(0, Math.max(1, Math.floor(steps.length * 0.02)));
  const hard = Math.min(1, (top.reduce((s, v) => s + v, 0) / top.length) / 0.5);
  return { bright, contrast, chroma, grain, hueSpread, hard };
}
export function toCharacter(m, amount = 1, noiseAmt = 1) {
  const k = (v) => Math.max(0, Math.min(1, v * amount));
  return {
    sat: k(m.contrast * 0.9), asym: k(m.chroma), shape: k(Math.abs(m.bright - 0.5) * 2 * 0.8), resist: k((1 - m.bright) * 0.8),
    jitter: k(m.grain * 0.7), drift: k(m.hueSpread),
    noise: Math.max(0, Math.min(1, Math.max(0, m.grain - 0.4) * 0.8 * noiseAmt)),
    clickLen: 0.012 - 0.0105 * (m.hard ?? 0.5), clickCut: 300 * Math.pow(2, 5.3 * (m.hard ?? 0.5)), // 12 ms dull ... 1.5 ms bright
  };
}
// Wobble of the upper harmonics: three shapes read from the area — the brightness along a band at the top, the middle and
// the bottom of the area (left -> right, 128 points, smoothed, zero mean, peak 1). Depth = how much the brightness changes
// along those bands (flat area = gentle, busy area = deep).
export function areaWaves(img, rect, K = 3, N = 128) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h };
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1), rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
  const lum = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  const waves = [], band = Math.max(1, Math.floor(rh / (K * 3))); let spread = 0;
  for (let j = 0; j < K; j++) {
    const yc = Math.floor(y0 + ((j + 0.5) / K) * rh), raw = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = Math.min(x1 - 1, Math.floor(x0 + (i / N) * rw)); let s = 0, n = 0; for (let y = Math.max(y0, yc - band); y <= Math.min(y1 - 1, yc + band); y++) { s += lum(x, y); n++; } raw[i] = s / n; }
    const sm = new Float32Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let d = -4; d <= 4; d++) s += raw[(i + d + N) % N]; sm[i] = s / 9; }
    const mean = sm.reduce((s, v) => s + v, 0) / N; let pk = 0, sq = 0; for (let i = 0; i < N; i++) { sm[i] -= mean; pk = Math.max(pk, Math.abs(sm[i])); sq += sm[i] * sm[i]; }
    spread += Math.sqrt(sq / N); for (let i = 0; i < N; i++) sm[i] /= pk || 1; waves.push(sm);
  }
  return { waves, depth: Math.min(1, spread / K / 0.12) };
}
// Grit layer ("kin" of a rock bass): the middle band of the area read left -> right as one cycle -> strengths of harmonics
// 1..64 (peak 1). Stretch (how stiff the metal string is) <- edges (hard); drive <- contrast.
export function gritFromArea(img, rect, m) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h }, N = 512, HN = 64;
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1), rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
  const yc = Math.floor(y0 + rh / 2), band = Math.max(1, Math.floor(rh / 10)), row = new Float32Array(N);
  const lum = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  for (let i = 0; i < N; i++) { const x = Math.min(x1 - 1, Math.floor(x0 + (i / N) * rw)); let s = 0, n = 0; for (let y = Math.max(y0, yc - band); y <= Math.min(y1 - 1, yc + band); y++) { s += lum(x, y); n++; } row[i] = s / n; }
  const H = new Float32Array(HN + 1); let mx = 0;
  for (let k = 1; k <= HN; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const a = (2 * Math.PI * k * i) / N; re += row[i] * Math.cos(a); im += row[i] * Math.sin(a); } H[k] = Math.hypot(re, im); mx = Math.max(mx, H[k]); }
  for (let k = 1; k <= HN; k++) H[k] = mx > 1e-6 ? H[k] / mx : 1 / k; // a flat row: fall back to a plain string (1/k)
  return { H, stretch: m.hard ?? 0.5, drive: m.contrast ?? 0.5 };
}
// Wobble path (preview for the wobble layer): two bands of the area, at 1/3 and 2/3 of its height, read left -> right
// as one LFO cycle. Upper band brightness -> how far the filter opens (cut), lower band -> how strong the resonance (res).
// Lightly smoothed (keeps the photo's steps and edges), each stretched to use 0..1. ys = the band rows (for drawing).
export function wobblePaths(img, rect, N = 128) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h };
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1), rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
  const lum = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  const band = Math.max(0, Math.floor(rh / 30)), ys = [Math.floor(y0 + rh / 3), Math.floor(y0 + (2 * rh) / 3)];
  const read = (yc) => {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = Math.min(x1 - 1, Math.floor(x0 + (i / N) * rw)); let s = 0, n = 0; for (let y = Math.max(y0, yc - band); y <= Math.min(y1 - 1, yc + band); y++) { s += lum(x, y); n++; } raw[i] = s / n; }
    const sm = Float32Array.from(raw, (_, i) => (raw[(i - 1 + N) % N] + 2 * raw[i] + raw[(i + 1) % N]) / 4);
    let mn = 1, mx = 0; for (const v of sm) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    return { path: Float32Array.from(sm, (v) => (mx - mn > 0.02 ? (v - mn) / (mx - mn) : 0.5)), range: mx - mn };
  };
  const a = read(ys[0]), b = read(ys[1]);
  return { cut: a.path, res: b.path, cutRange: a.range, resRange: b.range, ys };
}
// Wobble source: the area's brightness averaged down each column, read left -> right as one cycle, rebuilt from its first
// 64 harmonics (band-limited, no aliasing in the bass range), no DC, peak 1. Table of T + 1 points (last = first).
export function wobbleSource(img, rect, T = 2048) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h }, N = 512;
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1), rw = Math.max(1, x1 - x0);
  const col = new Float32Array(N), ys = Math.max(1, Math.floor((y1 - y0) / 60));
  for (let i = 0; i < N; i++) { const x = Math.min(x1 - 1, Math.floor(x0 + (i / N) * rw)); let s = 0, n = 0; for (let y = y0; y < y1; y += ys) { const k = (y * w + x) * 4; s += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255; n++; } col[i] = s / n; }
  const re = new Float32Array(65), im = new Float32Array(65);
  for (let k = 1; k <= 64; k++) for (let i = 0; i < N; i++) { const a = (2 * Math.PI * k * i) / N; re[k] += col[i] * Math.cos(a); im[k] += col[i] * Math.sin(a); }
  const tab = new Float32Array(T + 1); let pk = 0;
  for (let j = 0; j < T; j++) { let s = 0; for (let k = 1; k <= 64; k++) { const a = (2 * Math.PI * k * j) / T; s += re[k] * Math.cos(a) + im[k] * Math.sin(a); } tab[j] = s; pk = Math.max(pk, Math.abs(s)); }
  if (pk < 1e-6) for (let j = 0; j < T; j++) tab[j] = 1 - (2 * j) / T; else for (let j = 0; j < T; j++) tab[j] /= pk; // flat area: a plain saw
  tab[T] = tab[0];
  return tab;
}
// Running waveform for the wobble: F cycles from the area, top -> bottom (each = a band of rows averaged, read left -> right,
// rebuilt from 64 harmonics, peak 1). Packed as F tables of T + 1 points.
export function wobbleFrames(img, rect, F = 16, T = 2048) {
  const { data, width: w, height: h } = img, R = rect || { x0: 0, y0: 0, x1: w, y1: h }, N = 256, H = 64;
  const x0 = Math.max(0, R.x0), x1 = Math.min(w, R.x1), y0 = Math.max(0, R.y0), y1 = Math.min(h, R.y1), rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
  const out = new Float32Array(F * (T + 1)), cs = Float32Array.from({ length: T }, (_, j) => Math.cos((2 * Math.PI * j) / T)), sn = Float32Array.from({ length: T }, (_, j) => Math.sin((2 * Math.PI * j) / T));
  for (let f = 0; f < F; f++) {
    const ya = Math.floor(y0 + (f / F) * rh), yb = Math.max(ya + 1, Math.floor(y0 + ((f + 1) / F) * rh)), col = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = Math.min(x1 - 1, Math.floor(x0 + (i / N) * rw)); let s = 0, n = 0; for (let y = ya; y < Math.min(yb, y1); y++) { const k = (y * w + x) * 4; s += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255; n++; } col[i] = n ? s / n : 0; }
    const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) for (let i = 0; i < N; i++) { const a = (2 * Math.PI * k * i) / N; re[k] += col[i] * Math.cos(a); im[k] += col[i] * Math.sin(a); }
    const o = f * (T + 1); let pk = 0;
    for (let j = 0; j < T; j++) { let s = 0; for (let k = 1; k <= H; k++) { const idx = (k * j) % T; s += re[k] * cs[idx] + im[k] * sn[idx]; } out[o + j] = s; pk = Math.max(pk, Math.abs(s)); }
    for (let j = 0; j < T; j++) out[o + j] = pk > 1e-6 ? out[o + j] / pk : 1 - (2 * j) / T;
    out[o + T] = out[o];
  }
  return out;
}
export const SAW_TABLE = (() => { const T = 2048, t = new Float32Array(T + 1); for (let j = 0; j < T; j++) { let s = 0; for (let k = 1; k <= 64; k++) s += Math.sin((2 * Math.PI * k * j) / T) / k; t[j] = s * 0.55; } t[T] = t[0]; return t; })();
export const PLAIN_GRIT = { H: Float32Array.from({ length: 65 }, (_, k) => (k ? 1 / k : 0)), stretch: 0.3, drive: 0.4 };
export const CHAR_LABELS = [
  ['sat', '歪み', 'コントラスト', '明暗の差が大きいほど硬く(3・5倍音)'],
  ['asym', '非対称', '色の濃さ', '色が濃いほど太く(2・4倍音)'],
  ['shape', '形の崩れ', '明るさの偏り', 'とても暗い/明るいほど波が傾く'],
  ['resist', '抵抗', '暗さ', '暗いほど歪みの角が丸まる'],
  ['jitter', 'ジッター', 'ザラつき', 'ザラザラほど1周期ごとに揺らぐ'],
  ['drift', 'ドリフト', '色のばらつき', '色が多いほど音程がさまよう'],
  ['noise', 'ノイズ', 'ザラつき(強い所)', 'とても粗いと「サー」が混じる(下の「ノイズの効き」で別に調整)'],
];
