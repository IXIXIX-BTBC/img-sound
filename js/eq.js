// 4-band parametric EQ (Web Audio biquads). Used by the bass page (before its volume) and by the shared finishing rack.
// Each band: type (low shelf / peak / high shelf), frequency (where), gain (how much, +-15 dB), width (Q: how wide it reaches;
// small Q = wide and gentle, large Q = narrow and pointed). Shelves: the browser's shelf has a fixed slope, so width does nothing.
// The response curve is computed with the same formulas (RBJ cookbook) the browser uses, so the picture matches the sound.
export const EQ_TYPES = { lowshelf: 'ローシェルフ(下をまとめて)', peaking: 'ピーク(山/谷)', highshelf: 'ハイシェルフ(上をまとめて)' };
export const EQ_DEFAULT = () => [
  { type: 'lowshelf', f: 60, g: 0, q: 0.7 }, { type: 'peaking', f: 250, g: 0, q: 1 },
  { type: 'peaking', f: 1000, g: 0, q: 1 }, { type: 'highshelf', f: 4000, g: 0, q: 0.7 },
];
export function makeEq(ctx) {
  const nodes = Array.from({ length: 4 }, () => ctx.createBiquadFilter());
  for (let i = 0; i < 3; i++) nodes[i].connect(nodes[i + 1]);
  return {
    input: nodes[0], output: nodes[3], nodes,
    set(bands, on) {
      const t = ctx.currentTime;
      bands.forEach((b, i) => { const n = nodes[i]; n.type = b.type; n.frequency.setTargetAtTime(b.f, t, 0.02); n.Q.setTargetAtTime(b.q, t, 0.02); n.gain.setTargetAtTime(on ? b.g : 0, t, 0.02); });
    },
  };
}
function coefs(b, sr) {
  const A = Math.pow(10, b.g / 40), w0 = (2 * Math.PI * b.f) / sr, cs = Math.cos(w0), sn = Math.sin(w0);
  if (b.type === 'peaking') { const al = sn / (2 * b.q); return [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A]; }
  // the browser's shelves ignore Q (Web Audio spec: slope S = 1): alpha = sin(w0)/2 * sqrt(2)
  const a2s = 2 * Math.sqrt(A) * (sn / 2) * Math.SQRT2;
  if (b.type === 'lowshelf') return [A * ((A + 1) - (A - 1) * cs + a2s), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - a2s), (A + 1) + (A - 1) * cs + a2s, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - a2s];
  return [A * ((A + 1) + (A - 1) * cs + a2s), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - a2s), (A + 1) - (A - 1) * cs + a2s, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - a2s];
}
// magnitude (dB) of one band / of the whole EQ at frequency f
export function bandResponse(b, f, sr = 48000) {
  if (!b.g) return 0;
  const [b0, b1, b2, a0, a1, a2] = coefs(b, sr), w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
export function eqResponse(bands, f, sr = 48000) { return bands.reduce((s, b) => s + bandResponse(b, f, sr), 0); }
