// Techno lead: count the photo row by row (pure functions, no DOM).
// Same reading as the ambient page: hue -> note name, brightness -> octave, chroma -> strength, gray makes no sound.
// The difference is where we count: one horizontal row (a band of a few rows) instead of a dragged area.
import { harmonize } from '../pixel/pixels.js?v=23';

// per row: chroma summed into hue x octave cells
export function countRows(img, { fine, octLo, octHi }) {
  const { data, width: w, height: h } = img, cols = 12 * fine, octs = octHi - octLo + 1, C = cols * octs;
  const rows = Array.from({ length: h }, () => new Float32Array(C));
  for (let y = 0; y < h; y++) {
    const r0 = rows[y];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      if (c < 1e-3) continue;
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, o = Math.min(octs - 1, Math.floor(L * octs));
      let hue = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      hue = (((hue / 6) % 1) + 1) % 1;
      r0[o * cols + (Math.floor(hue * cols) % cols)] += c;
    }
  }
  return { rows, cols, octs, h, w };
}

// Build the table the synth reads: which cells sound (fixed pitch each), and how strong each one is on every row.
//  band: rows above/below averaged (a 1-pixel row is noisy)
//  each row keeps only its own peaks: its strongest `max` cells above thr (so the set of pitches changes row to row)
//  candidates = every cell that is a peak on some row (at most 64, ranked by how strongly/often they appear)
//  amp[y][k] = (cell count on row y / that row's top)^gamma if the cell is one of row y's peaks, else 0;
//  each row then scaled to equal loudness. Moving between rows: the synth interpolates neighboring rows and smooths.
// perm: which note each of the 12 color sectors plays (perm[i] = semitones above the red note; null = in order, the default)
export function rowTable(rc, { band = 2, gamma = 2, thr = 0.08, max = 24, red = 0, octLo = 3, harm = 'normal', harmAmt = 0.7, chord = 'major', perm = null }) {
  const { rows, cols, octs, h } = rc, C = cols * octs;
  const B = rows.map((_, y) => { const a = new Float32Array(C); for (let d = -band; d <= band; d++) { const r = rows[Math.min(h - 1, Math.max(0, y + d))]; for (let c = 0; c < C; c++) a[c] += r[c]; } return a; });
  const score = new Float32Array(C), norm = (a) => { let m = 0; for (const v of a) m = Math.max(m, v); return m; };
  const tops = B.map(norm);
  const V = B.map((b, y) => { // this row's own peaks only
    const v = new Float32Array(C); if (!(tops[y] > 0)) return v;
    const list = [];
    for (let c = 0; c < C; c++) { const a = Math.pow(b[c] / tops[y], gamma); if (a >= thr) list.push([c, a]); }
    list.sort((p, q) => q[1] - p[1]).slice(0, max).forEach(([c, a]) => { v[c] = a; score[c] += a; });
    return v;
  });
  const cells = [...score.keys()].filter((c) => score[c] > 0).sort((a, b) => score[b] - score[a]).slice(0, 64);
  let parts = cells.map((cell) => { const o = Math.floor(cell / cols), k = cell % cols, fine = cols / 12, sec = Math.floor(k / fine), semis = (perm ? perm[sec] : sec) + (k + 0.5) / fine - 0.5 - sec, midi = 12 * (octLo + o + 1) + red + semis; return { cell, midi, a: score[cell], hue: k / cols }; });
  parts = harmonize(parts, { mode: harm, amount: harmAmt, chord });
  const K = parts.length, amp = new Float32Array(h * K);
  for (let y = 0; y < h; y++) {
    let ss = 0;
    for (let k = 0; k < K; k++) { const a = V[y][parts[k].cell]; amp[y * K + k] = a; ss += a * a; }
    const g = ss > 0 ? 1 / Math.sqrt(ss) : 0; // equal loudness per row
    for (let k = 0; k < K; k++) amp[y * K + k] *= g;
  }
  // pitch of each component relative to the played key: C4 key = the photo's own pitches
  const ratio = Float32Array.from(parts, (p) => Math.pow(2, (p.midi - 60) / 12));
  return { K, rows: h, amp, ratio, parts };
}
