// Smooth random ("coherent noise") — shared by every page. One noise = making method x processing x settings.
//  makeNoise({ type, seed, octaves, rough }) -> f(x): roughly -1..1, smooth in x (x = time or position, 1 unit = one bump)
//  type: 'fbm'   = Perlin noise summed over octaves (calm wandering)
//        'ridge' = folded Perlin (sharp ridges: mostly calm, now and then a quick sharp move)
//        'warp'  = Perlin read at a position bent by another Perlin (swirls: comes round, goes back, loops)
//        'cell'  = stay-then-move (each stretch holds a random value, then glides to the next)
//  seed: same seed = the same shape every time. octaves: 1..5 layers. rough: how strong the finer layers are (0..1).
// Perlin noise (1D, gradient noise): a random slope at every whole number, value 0 there, joined with the 6t^5-15t^4+10t^3 curve.

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function perlinFor(seed) {
  const rnd = mulberry32(seed), g = Float32Array.from({ length: 256 }, () => rnd() * 2 - 1);
  return (x) => {
    const i = Math.floor(x), t = x - i, g0 = g[i & 255], g1 = g[(i + 1) & 255], u = t * t * t * (t * (t * 6 - 15) + 10);
    return 2 * (g0 * t + (g1 * (t - 1) - g0 * t) * u);
  };
}

export function makeNoise({ type = 'fbm', seed = 1, octaves = 3, rough = 0.5 } = {}) {
  const oct = Math.max(1, Math.min(5, octaves | 0)), P = Array.from({ length: oct + 1 }, (_, o) => perlinFor(seed * 7919 + o * 104729 + 13));
  const W = Array.from({ length: oct }, (_, o) => Math.pow(Math.max(0.05, rough), o)), Wsum = W.reduce((s, v) => s + v, 0);
  const fbm = (x) => { let s = 0; for (let o = 0; o < oct; o++) s += W[o] * P[o](x * Math.pow(2.07, o) + o * 31.7); return s / Wsum; };
  const rnd = mulberry32(seed * 31 + 7), cellV = Float32Array.from({ length: 256 }, () => rnd() * 2 - 1);
  const k = 1.9; // plain Perlin rarely goes past +-0.5; stretch it so the whole -1..1 is used now and then
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  switch (type) {
    case 'ridge': return (x) => { let s = 0; for (let o = 0; o < oct; o++) { const r = 1 - Math.abs(P[o](x * Math.pow(2.07, o) + o * 31.7)); s += W[o] * r * r; } return clamp(((s / Wsum) - 0.62) * 3.2); };
    case 'warp': { const wp = perlinFor(seed * 5 + 999); return (x) => clamp(fbm(x + 1.4 * wp(x * 0.6)) * k); }
    case 'cell': return (x) => { // hold, then glide in the last quarter of each stretch
      const i = Math.floor(x), t = x - i, u = Math.max(0, (t - 0.7) / 0.3), s = u * u * (3 - 2 * u);
      const a = cellV[i & 255], b = cellV[(i + 1) & 255]; return a + (b - a) * s + 0.08 * P[0](x * 3);
    };
    default: return (x) => clamp(fbm(x) * k);
  }
}
// Several independent noises of the same kind (one per channel: x, y, size ...), each with its own seed.
export function noiseSet(n, opt) { return Array.from({ length: n }, (_, i) => makeNoise({ ...opt, seed: (opt.seed || 1) * 1009 + i * 7717 })); }
export const NOISE_TYPES = { fbm: 'ゆったり漂う(パーリン)', ridge: 'ときどき鋭く動く(リッジ)', warp: '渦を巻く(ワープ)', cell: 'とどまって移る(セル)' };
