// Fit, away from the page: a take is stretched or squeezed to n frames without changing its pitch (WSOLA: short
// windowed pieces laid at the new spacing, each nudged to where it lines up best with the one before), plus `tail`
// frames that go on from its start (for the loop seam). The page keeps playing the take as recorded until this is back.
//   in:  { id, L, R, n, tail, sr }   (L / R: the take or its range, Float32Array, transferred)
//   out: { id, l, r, sr }
function stretch(L, R, n, tail) {
  const N = 2048, H = N / 2, TOL = 512, len = L.length, ratio = len / n, total = n + tail;
  const wrap = (a, k) => a[((k % len) + len) % len]; // past the end = the start again
  const oL = new Float32Array(total + N), oR = new Float32Array(total + N), wsum = new Float32Array(total + N);
  const win = Float32Array.from({ length: N }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N));
  let prev = 0;
  for (let o = 0, f = 0; o < total; o += H, f++) {
    let pos = Math.round(o * ratio);
    if (f) { // where the piece lines up best with the natural continuation of the one before
      const want = prev + H; let best = pos, bc = -Infinity;
      for (let d = -TOL; d <= TOL; d += 8) { let c = 0; for (let k = 0; k < H; k += 4) c += wrap(L, want + k) * wrap(L, pos + d + k) + wrap(R, want + k) * wrap(R, pos + d + k); if (c > bc) { bc = c; best = pos + d; } }
      pos = best;
    }
    for (let k = 0; k < N; k++) { const w = win[k]; oL[o + k] += wrap(L, pos + k) * w; oR[o + k] += wrap(R, pos + k) * w; wsum[o + k] += w; }
    prev = pos;
  }
  const l = new Float32Array(total), r = new Float32Array(total);
  for (let k = 0; k < total; k++) { const w = wsum[k] > 1e-3 ? wsum[k] : 1; l[k] = oL[k] / w; r[k] = oR[k] / w; }
  return { l, r };
}
onmessage = ({ data: { id, L, R, n, tail, sr } }) => {
  const { l, r } = stretch(L, R, n, tail);
  postMessage({ id, l, r, sr }, [l.buffer, r.buffer]);
};
