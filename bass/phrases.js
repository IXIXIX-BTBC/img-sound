// Classic wobble-bass phrase types (generic patterns, not copied from any song).
// One bar = 16 steps (16th notes). Notes: C = root, c = root an octave up, G = fifth, E = minor third (Eb), - = hold, . = rest.
// rates = LFO speed for each beat, as a fraction of a bar (1/4 = quarter, 1/12 = eighth-note triplet, 1/32 = 32nd).
// shape (optional) = the LFO shape this type wants (others use the wobble's own shape, e.g. the photo path).
export const PHRASES = [
  { name: '1. 基本の「ワブ・ワブ・ワワワワ」', bars: ['C---------------'], rates: [[1 / 4, 1 / 4, 1 / 8, 1 / 16]], hint: '長い1音のまま、LFOだけだんだん速く' },
  { name: '2. 3連でつまずかせる', bars: ['C---------------'], rates: [[1 / 8, 1 / 8, 1 / 12, 1 / 16]], hint: '3拍目だけ3連でノリが転ぶ' },
  { name: '3. 呼びかけと応え(2小節)', bars: ['C-------........', '..G-C-------E---'], rates: [[1 / 8, 1 / 8, 1 / 8, 1 / 8], [1 / 16, 1 / 4, 1 / 8, 1 / 16]], hint: '問いかけて黙り、別の音程と速さで答える' },
  { name: '4. ハーフタイムの「間」', bars: ['C-----......C-..'], rates: [[1 / 4, 1 / 4, 1 / 4, 1 / 16]], hint: '重さ。間を空けて、最後に短い刻み' },
  { name: '5. カクカク刻み', bars: ['C-C-.C--C-.Cc-C-'], rates: [[1 / 16, 1 / 16, 1 / 32, 1 / 16]], shape: 'square', hint: '速い矩形のLFOとオクターブの跳び' },
  { name: '6. 加速して落とす', bars: ['C--------------.'], rates: [[1 / 4, 1 / 8, 1 / 16, 1 / 32]], hint: '1拍ずつ速く、最後に一瞬休む' },
];
const SEMI = { C: 0, c: 12, G: 7, E: 3 };
// -> steps the synth plays: { t: 'on' | 'tie' | 'rest', semi, rate }
export function toSteps(ph) {
  const out = [];
  ph.bars.forEach((bar, b) => { for (let i = 0; i < 16; i++) { const ch = bar[i], rate = ph.rates[b][i >> 2]; out.push(ch === '-' ? { t: 'tie', rate } : ch === '.' ? { t: 'rest', rate } : { t: 'on', semi: SEMI[ch] ?? 0, rate }); } });
  return out;
}
export const RATE_LABEL = (r) => ({ [1 / 4]: '1/4', [1 / 8]: '1/8', [1 / 12]: '1/8の3連', [1 / 16]: '1/16', [1 / 32]: '1/32' })[r] || r.toFixed(3);
