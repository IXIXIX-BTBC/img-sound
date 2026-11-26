// Renders notes off the main thread so the screen never freezes.
// Gets the photo once ('img'), then 'render' requests: settings + an area -> one note (L, R, loop points).
import { countPixels, toPartials, envelopes, rowWaves, wobbles, thickness, renderNote, harmonize, mergeClose } from './pixels.js?v=23';

const imgs = new Map(); // id -> ImageData
onmessage = ({ data: m }) => {
  if (m.type === 'img') { imgs.set(m.id ?? 'cur', m.img); return; }
  if (m.type !== 'render') return;
  const img = imgs.get(m.imgId ?? 'cur');
  if (!img) { postMessage({ gen: m.gen, idx: m.idx, error: 'no image' }); return; }
  const s = m.set, rect = m.rect;
  const cnt = countPixels(img, { fine: s.fine, redNote: s.red, octLo: s.lo, octHi: s.hi, rect });
  const parts = mergeClose(harmonize(toPartials(cnt, { gamma: s.gamma, thr: s.thr, max: s.merge > 0 ? 400 : s.max, redNote: s.red, octLo: s.lo, perm: s.perm }), { mode: s.harm, amount: s.harmAmt, chord: s.chord }), s.merge, s.max);
  const env = envelopes(img, cnt, parts, { rule: s.envRule, rect, smooth: s.smooth, circular: true });
  const waves = s.src === 'row' ? rowWaves(img, cnt, parts, { rect }) : null;
  const wob = wobbles(img, cnt, parts, { rect });
  const thick = thickness(cnt, parts);
  const r = renderNote(parts, {
    sr: m.sr, A: s.A, D: s.D, S: s.Sus, hd: s.hd, env, envDur: s.envDur, depth: s.depth, waves, nh: s.nh, fund: s.fund,
    wob, wobAmt: s.wobAmt, wobCents: s.wobCents, wobAmpD: s.wobAmpD, wobSlow: s.wobSlow, wobFast: s.wobFast,
    wobSpeed: s.wobSpeed, wobTogether: s.wobTogether, wobVary: s.wobVary, wobSwing: s.wobSwing,
    thick, noiseAmt: s.noiseAmt, noiseWidth: s.noiseWidth, noiseWob: s.noiseWob, noiseWobW: s.noiseWobW, spread: s.spread ?? 0.6,
    loopSec: s.loopSec ?? 12,
  });
  postMessage({ gen: m.gen, idx: m.idx, draft: m.draft, rect, L: r.L, R: r.R, loopStart: r.loopStart, loopEnd: r.loopEnd }, [r.L.buffer, r.R.buffer]);
};
