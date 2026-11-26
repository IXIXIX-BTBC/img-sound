// Copied from _old/v1/js/analysis.js (the first experimental build) for the lead's "row waveform" layer: row brightness -> one cycle -> band-limited levels.
// Photo analysis (pure functions, no DOM).
// Input is ImageData-like {data, width, height}. These functions return numeric arrays only,
// so they can be ported to a JUCE WebView or C++ later.

export const N = 2048; // samples in one wave cycle
export const HARMS = [1023, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]; // highest harmonic per band-limited level

// Split RGBA into R/G/B Float32Arrays (0..1)
export function toChannels(img) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4] / 255; g[i] = data[i * 4 + 1] / 255; b[i] = data[i * 4 + 2] / 255;
  }
  return { w, h, r, g, b };
}

// Bilinear sample (clamped to the image edges)
export function bilinear(ch, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = ch[y0 * w + x0] + (ch[y0 * w + x1] - ch[y0 * w + x0]) * fx;
  const c = ch[y1 * w + x0] + (ch[y1 * w + x1] - ch[y1 * w + x0]) * fx;
  return a + (c - a) * fy;
}

// Read one horizontal line as a single cycle (y in pixels)
export function extractRow(chs, y, n = N) {
  const { w, h } = chs;
  const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const x = (i / n) * (w - 1);
    out.r[i] = bilinear(chs.r, w, h, x, y);
    out.g[i] = bilinear(chs.g, w, h, x, y);
    out.b[i] = bilinear(chs.b, w, h, x, y);
  }
  return out;
}

// Read a circle around a point as a single cycle (closed, so the ends join naturally)
export function extractCircle(chs, cx, cy, radius, n = N) {
  const { w, h } = chs;
  const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
    out.r[i] = bilinear(chs.r, w, h, x, y);
    out.g[i] = bilinear(chs.g, w, h, x, y);
    out.b[i] = bilinear(chs.b, w, h, x, y);
  }
  return out;
}

// Sample points inside a disc (for color features)
// Shape one cycle: seam fix, blur, DC removal
const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
export function prepare(src, { blur = 0, seam = false } = {}) {
  const n = src.length;
  let a = Float32Array.from(src);
  if (seam) { // blend the last 6% toward the first sample (removes the click where the cycle wraps)
    const m = Math.floor(n * 0.06), start = a[0];
    for (let k = 0; k < m; k++) {
      const t = k / (m - 1), s = t * t * (3 - 2 * t);
      a[n - m + k] = a[n - m + k] * (1 - s) + start * s;
    }
  }
  const rad = Math.round(blur);
  for (let pass = 0; pass < 2 && rad > 0; pass++) { // circular moving average (applied twice ≈ Gaussian)
    const o = new Float32Array(n);
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += a[(k + n) % n];
    for (let i = 0; i < n; i++) {
      o[i] = s / (rad * 2 + 1);
      s += a[(i + rad + 1) % n] - a[(i - rad + n) % n];
    }
    a = o;
  }
  const m = mean(a);
  for (let i = 0; i < n; i++) a[i] -= m;
  return a;
}

// Mix the 3 RGB layers into one wave.
// proportional=true: each layer's level follows how much of that color the line has
export function mixLayers(raw, mix, { proportional = true, blur = 0, seam = false } = {}) {
  const keys = ['r', 'g', 'b'];
  const means = keys.map((k) => mean(raw[k]));
  const maxMean = Math.max(...means, 1e-4);
  const weights = {}, layers = {};
  const n = raw.r.length, wave = new Float32Array(n);
  keys.forEach((k, i) => {
    weights[k] = proportional ? means[i] / maxMean : 1;
    const a = prepare(raw[k], { blur, seam });
    let peak = 0;
    for (let j = 0; j < n; j++) peak = Math.max(peak, Math.abs(a[j]));
    const g = (1 / Math.max(peak, 0.08)) * weights[k]; // flat regions don't get blown up (they stay quiet)
    for (let j = 0; j < n; j++) a[j] *= g;
    layers[k] = a;
    for (let j = 0; j < n; j++) wave[j] += a[j] * mix[k];
  });
  let peak = 0;
  for (let j = 0; j < n; j++) peak = Math.max(peak, Math.abs(wave[j]));
  const g = 1 / Math.max(peak, 0.2);
  for (let j = 0; j < n; j++) wave[j] *= g;
  return { wave, layers, weights };
}

// Radix-2 FFT (in place)
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Band-limited tables (one per octave): drop harmonics above each level's cap (prevents harsh aliasing on high notes)
export function buildMipmaps(wave) {
  const n = wave.length;
  const re0 = Float64Array.from(wave), im0 = new Float64Array(n);
  fft(re0, im0, false);
  const data = new Float32Array(HARMS.length * n);
  HARMS.forEach((H, lv) => {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 1; k <= Math.min(H, n / 2 - 1); k++) {
      re[k] = re0[k]; im[k] = im0[k]; re[n - k] = re0[n - k]; im[n - k] = im0[n - k];
    }
    fft(re, im, true);
    for (let i = 0; i < n; i++) data[lv * n + i] = re[i];
  });
  return { data, levels: HARMS.length };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Color features (all 0..1): saturation, warm (1 = red side, 0 = blue side), variety (spread of hues), contrast
// Single brightness channel weighted by the RGB mix (used by scratch mode)
export const FRAMES = 64;
// Radius of circle mode (fraction of the shorter side) from position 0..1
export const circleRadius = (pos) => 0.02 + pos * 0.48;

// Precompute a stack of waveforms from top to bottom (or small to large circles). The engine moves through them by position
export function buildStack(chs, { scan = 'row', center = { x: 0.5, y: 0.5 }, mix, proportional = true, blur = 0, frames = FRAMES } = {}) {
  const levels = HARMS.length, data = new Float32Array(frames * levels * N);
  for (let k = 0; k < frames; k++) {
    const raw = extractAt(chs, k / (frames - 1), { scan, center });
    const res = mixLayers(raw, mix, { proportional, blur, seam: scan === 'row' });
    data.set(buildMipmaps(res.wave).data, k * levels * N);
  }
  return { data, frames, levels };
}

// Read the waveform at position 0..1 (row = height, circle = radius)
export function extractAt(chs, pos, { scan = 'row', center = { x: 0.5, y: 0.5 } } = {}) {
  const { w, h } = chs;
  return scan === 'row'
    ? extractRow(chs, pos * (h - 1))
    : extractCircle(chs, center.x * w, center.y * h, circleRadius(pos) * Math.min(w, h));
}

// LFO shape from the brightness of one vertical column (-1..1, len samples)
// Render a scratch trace to audio (same algorithm as the engine's live scratch). pts = [{x,y (px), t (ms)}]
// Strength of harmonics 1..count (0..1, relative to the loudest)
export function harmonics(wave, count = 32) {
  const n = wave.length, out = new Float32Array(count);
  let mx = 1e-9;
  for (let h = 1; h <= count; h++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i += 2) { const a = (TAU_ * h * i) / n; re += wave[i] * Math.cos(a); im -= wave[i] * Math.sin(a); }
    out[h - 1] = Math.hypot(re, im); mx = Math.max(mx, out[h - 1]);
  }
  for (let h = 0; h < count; h++) out[h] /= mx;
  return out;
}
const TAU_ = Math.PI * 2;
