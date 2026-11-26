// Color -> scale page: screen, drawing, playback
import { countPixels, toPartials, noteName, mtof, envelopes, rowWaves, buildTable, wobbles, thickness, harmonize, mergeClose } from './pixels.js?v=23';
import { presetBar } from '../js/presets.js?v=2';
import { bindBpm } from '../js/tempo.js?v=1';
import { finishRack } from '../js/finish.js?v=9';
import { speakerOut } from '../js/out.js?v=4';
import { noteOrderUI } from '../js/note-order.js?v=3';
import { noiseSet, NOISE_TYPES } from '../js/noise.js?v=1';
import * as DB from '../js/store.js?v=6';
import { readableImages } from '../js/heic.js?v=2';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MUTE = new URLSearchParams(location.search).has('mute');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const imgCv = $('.js-img'), ovCv = $('.js-ov'), ictx = imgCv.getContext('2d', { willReadFrequently: true }), octx = ovCv.getContext('2d');
const S = { red: 0, fine: 8, lo: 2, hi: 7, gamma: 1.5, thr: 0.05, max: 64, sel: null, rect: null, keyOct: 4, release: 1.2, src: 'sine', nh: 12, fund: 0.3, harm: 'normal', harmAmt: 0.7, chord: 'major',
  loopLen: 60, loopVol: 0.8, loopMode: 'scenes',
  wType: 'fbm', wRange: 0.5, wSize: 0.5, wSpeed: 4, wSpeedVar: 0.6, wHome: 0.3, wVisit: 0.5, wSeed: 1, wKeep: 0,
  vary: 1, shift: 0.03,
  noiseAmt: 0.3, noiseWidth: 1, noiseWob: 0.5, noiseWobW: 0.3, spread: 0.6, rvb: 0.3, dist: 0.2, room: 2.5,
  wobAmt: 1, wobCents: 8, wobAmpD: 0.35, wobSlow: 0.75, wobFast: 0.1, wobSpeed: 0.35, wobTogether: 0.5, wobVary: 0.6, wobSwing: 0.5, A: 0.003, D: 0.4, Sus: 0.3, hd: 0.6, depth: 0.6,
  envRule: 'none', envDur: 2, smooth: 0.3, merge: 0,
  };
let dryLP = null, dryG = null, conv = null, wetG = null, wetLP = null, roomNow = 0;
let thick = null, wob = null, lim = null, waves = null, envs = null, img = null, cnt = null, parts = [], ctx = null, gain = null, src = null, playing = false;

/* ---------- Analysis ---------- */
function recount() {
  if (!img) return;
  cnt = countPixels(img, { fine: S.fine, redNote: S.red, octLo: S.lo, octHi: S.hi, rect: S.rect });
  if (S.sel && (S.sel.o >= cnt.octs || S.sel.k >= cnt.cols)) S.sel = null;
  repick();
}
function repick() {
  if (!cnt) return; // no photo read yet (settings may arrive first; the photo repicks when it comes)
  parts = mergeClose(harmonize(toPartials(cnt, { gamma: S.gamma, thr: S.thr, max: S.merge > 0 ? 400 : S.max, redNote: S.red, octLo: S.lo, perm: S.perm }), { mode: S.harm, amount: S.harmAmt, chord: S.chord }), S.merge, S.max);
  $('.js-harm-info').textContent = S.harm === 'normal' || !parts.length ? '' : `基準の音(一番強い成分): ${noteName(parts[0].midi)}`;
  envs = envelopes(img, cnt, parts, { rule: S.envRule, rect: S.rect, smooth: S.smooth, circular: true });
  waves = S.src === 'row' ? rowWaves(img, cnt, parts, { rect: S.rect }) : null;
  wob = wobbles(img, cnt, parts, { rect: S.rect });
  thick = thickness(cnt, parts);
  $('.js-wob-info').textContent = wob ? `この範囲のザラつき ${Math.round(wob.grain * 100)}%(ザラつくほどよく揺れる)` : '';
  const cTot = cnt.tone.reduce((s, v) => s + v, 0), gTot = cnt.gray.reduce((s, v) => s + v, 0);
  const area = S.rect ? `選んだ範囲 ${S.rect.x1 - S.rect.x0}×${S.rect.y1 - S.rect.y0}` : `写真全体 ${img.width}×${img.height}`;
  $('.js-stat').textContent = `${area} = ${cnt.total.toLocaleString()} ピクセル / 色のある分 ${Math.round((cTot / (cnt.total || 1)) * 100)}% → 音の成分、灰色の分 ${Math.round((gTot / (cnt.total || 1)) * 100)}% → 鳴らない`;
  drawGrid(); drawSpec(); peakList(); drawOverlay(); drawEnv(); drawWaves();
  noteDirty(); // re-render on next use (held keys keep the old sound)
  syncActive();
  if (playing) restart();
}

/* ---------- Drawing ---------- */
const hueCol = (h, l = 55) => `hsl(${h * 360},85%,${l}%)`;
const G = { top: 18, left: 34, grayW: 64 };
function gridGeom() {
  const cv = $('.js-grid'), W = cv.width, H = cv.height;
  const cw = (W - G.left - G.grayW - 8) / cnt.cols, ch = (H - G.top) / cnt.octs;
  return { cv, W, H, cw, ch };
}
function drawGrid() {
  const { cv, W, H, cw, ch } = gridGeom(), g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  let top = 0; for (const v of cnt.tone) top = Math.max(top, v);
  const gTop = Math.max(...cnt.gray);
  for (let k = 0; k < cnt.cols; k++) { g.fillStyle = hueCol(k / cnt.cols); g.fillRect(G.left + k * cw, 0, Math.ceil(cw), G.top - 4); }
  const picked = new Set(parts.map((p) => p.cell));
  for (let o = 0; o < cnt.octs; o++) {
    const y = H - (o + 1) * ch;
    for (let k = 0; k < cnt.cols; k++) {
      const v = cnt.tone[o * cnt.cols + k] / (top || 1);
      if (v <= 0) continue;
      g.fillStyle = hueCol(k / cnt.cols, 8 + 62 * Math.sqrt(v));
      g.globalAlpha = 0.25 + 0.75 * Math.sqrt(v);
      g.fillRect(G.left + k * cw, y + 1, Math.ceil(cw), ch - 2);
      g.globalAlpha = 1;
      if (picked.has(o * cnt.cols + k) && cw >= 4) { g.fillStyle = '#fff'; g.fillRect(G.left + k * cw + cw / 2 - 1, y + ch / 2 - 1, 2, 2); }
    }
    const gv = cnt.gray[o] / (gTop || 1), l = Math.round(20 + 200 * Math.sqrt(gv));
    g.fillStyle = `rgb(${l},${l},${l})`; g.fillRect(W - G.grayW, y + 1, G.grayW, ch - 2);
    g.fillStyle = '#888'; g.font = '13px sans-serif'; g.fillText('C' + (S.lo + o), 2, y + ch / 2 + 4);
  }
  g.fillStyle = 'rgba(255,255,255,.18)';
  for (let s = 0; s <= 12; s++) g.fillRect(G.left + s * cnt.fine * cw, G.top, 1, H - G.top);
  g.fillStyle = '#ccc'; g.font = '12px sans-serif';
  for (let s = 0; s < 12; s++) g.fillText(NAMES[(S.red + (S.perm ? S.perm[s] : s)) % 12], G.left + s * cnt.fine * cw + 3, G.top + 13);
  g.fillText('灰(無音)', W - G.grayW + 6, G.top + 13);
  if (S.sel) {
    const { o, k } = S.sel, y = H - (o + 1) * ch;
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    if (k < 0) g.strokeRect(W - G.grayW + 1, y + 1, G.grayW - 2, ch - 2);
    else g.strokeRect(G.left + k * cw, y + 1, Math.max(cw, 3), ch - 2);
  }
}

const F0 = 30, F1 = 16000, lx = (f, W) => (Math.log(f / F0) / Math.log(F1 / F0)) * W;
function drawSpec() {
  const cv = $('.js-spec'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.font = '12px sans-serif';
  for (let oc = 1; oc <= 9; oc++) { const x = lx(mtof(12 * (oc + 1)), W); g.fillStyle = '#1e1e1e'; g.fillRect(x, 0, 1, H); g.fillStyle = '#555'; g.fillText('C' + oc, x + 3, H - 4); }
  for (const p of [...parts].reverse()) {
    const x = lx(p.f, W), h = p.a * (H - 30);
    g.fillStyle = hueCol(p.hue, 60); g.fillRect(x - 1, H - 16 - h, 3, h);
  }
}

function peakList() {
  $('.js-pcount').textContent = `(${parts.length}本)`;
  $('.js-peaks').innerHTML = `<table><tr><th>音名</th><th>周波数</th><th>強さ</th><th>写真の割合</th></tr>${parts.slice(0, 30).map((p) => {
    const cents = Math.round((p.midi - Math.round(p.midi)) * 100);
    return `<tr><td><i class="px__sw" style="background:${hueCol(p.hue)}"></i>${noteName(p.midi)}${cents ? (cents > 0 ? '+' : '') + cents + 'c' : ''}</td><td>${p.f >= 1000 ? (p.f / 1000).toFixed(2) + 'k' : Math.round(p.f)}Hz</td><td>${Math.round(p.a * 100)}%</td><td>${(p.share * 100).toFixed(1)}%</td></tr>`;
  }).join('')}</table>`;
}

// Dim outside the chosen area; with a grid cell selected, dim everything except that cell's pixels
function drawOverlay() {
  octx.clearRect(0, 0, ovCv.width, ovCv.height);
  if (!cnt) return;
  if (S.sel) {
    const { o, k } = S.sel, od = octx.createImageData(cnt.w, cnt.h), cell = o * cnt.cols + k;
    for (let p = 0; p < cnt.w * cnt.h; p++) {
      const c = cnt.pixCell[p], hit = c !== -2 && (k < 0 ? cnt.pixOct[p] === o && cnt.pixChroma[p] < 0.15 : c === cell);
      od.data[p * 4 + 3] = hit ? 0 : c === -2 ? 220 : 190;
    }
    octx.putImageData(od, 0, 0);
  } else if (S.rect) {
    const { x0, y0, x1, y1 } = S.rect;
    octx.fillStyle = 'rgba(0,0,0,.6)';
    octx.fillRect(0, 0, cnt.w, y0); octx.fillRect(0, y1, cnt.w, cnt.h - y1);
    octx.fillRect(0, y0, x0, y1 - y0); octx.fillRect(x1, y0, cnt.w - x1, y1 - y0);
  }
  if (waves) { // rows used as each component's waveform (dashed)
    const x0 = S.rect ? S.rect.x0 : 0, x1 = S.rect ? S.rect.x1 : cnt.w;
    octx.setLineDash([3, 3]);
    parts.slice(0, 10).forEach((p) => { if (p.waveRow == null) return; octx.strokeStyle = hueCol(p.hue, 70); octx.lineWidth = 1; octx.beginPath(); octx.moveTo(x0, p.waveRow + 0.5); octx.lineTo(x1, p.waveRow + 0.5); octx.stroke(); });
    octx.setLineDash([]);
  }
  if (envs && (S.envRule === 'row' || S.envRule === 'rank')) { // the rows being read
    const x0 = S.rect ? S.rect.x0 : 0, x1 = S.rect ? S.rect.x1 : cnt.w;
    parts.slice(0, 10).forEach((p) => { if (p.row == null) return; octx.fillStyle = hueCol(p.hue, 60); octx.fillRect(x0, p.row, x1 - x0, 1.5); });
  }
  if (flash && flash.rect && performance.now() - flash.t < 650) { // the nudged area the last press used
    const r = flash.rect; octx.lineWidth = 1.5; octx.strokeStyle = 'rgba(120,220,255,.95)'; octx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
  }
  if (S.rect) {
    const { x0, y0, x1, y1 } = S.rect;
    octx.setLineDash([4, 3]); octx.lineWidth = 1.5; octx.strokeStyle = '#f0b44c';
    octx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1); octx.setLineDash([]);
  }
}
$('.js-grid').addEventListener('click', (e) => {
  if (!cnt) return;
  const { cv, W, H, cw, ch } = gridGeom(), r = cv.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
  if (y < G.top) return;
  const o = Math.floor((H - y) / ch);
  const k = x >= W - G.grayW ? -1 : Math.floor((x - G.left) / cw);
  S.sel = o >= 0 && o < cnt.octs && (k === -1 || (k >= 0 && k < cnt.cols)) ? { o, k } : null;
  drawGrid(); drawOverlay();
});

/* ---------- Choosing an area by dragging on the photo ---------- */
let drag = null, dragRaf = 0;
const imgPt = (e) => { const r = ovCv.getBoundingClientRect(); return { x: Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * ovCv.width), y: Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * ovCv.height) }; };
function dragRect(a, b) { return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }; }
ovCv.addEventListener('pointerdown', (e) => {
  if (!img) return;
  e.preventDefault(); try { ovCv.setPointerCapture(e.pointerId); } catch {}
  drag = { id: e.pointerId, a: imgPt(e) };
});
ovCv.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const r = dragRect(drag.a, imgPt(e));
  if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return;
  S.rect = r; S.sel = null; drag.moved = true;
  if (!dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; recount(); }); // live: count while dragging
});
function endDrag(e) {
  if (!drag || drag.id !== e.pointerId) return;
  const moved = drag.moved; drag = null;
  if (!moved) { // a plain click: clear the cell highlight first, then the area
    if (S.sel) S.sel = null; else S.rect = null;
  }
  recount();
}
ovCv.addEventListener('pointerup', endDrag);
ovCv.addEventListener('pointercancel', endDrag);

/* ---------- Sound ---------- */
let ctxReady = null;
function ensureCtx() {
  if (!ctxReady) ctxReady = (async () => {
    const c = new AudioContext();
    gain = c.createGain(); gain.gain.value = +$('.js-volume').value;
    // limiter: when several keys add up past the ceiling it turns the level down instead of letting it crack
    lim = c.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    // space: dry path darkens and drops with distance, wet path = reverb
    dryLP = c.createBiquadFilter(); dryLP.type = 'lowpass'; dryG = c.createGain();
    conv = c.createConvolver(); wetG = c.createGain(); wetLP = c.createBiquadFilter(); wetLP.type = 'lowpass';
    // the finishing rack (tube comp -> tape echo -> EQ) right after the voices, then the space
    const fin = await rack.connect(c);
    gain.connect(fin.input);
    fin.output.connect(dryLP).connect(dryG).connect(lim);
    fin.output.connect(conv).connect(wetLP).connect(wetG).connect(lim);
    ctx = c;
    applySpace(true);
    noteDirty(); // start preparing all the versions of the note
    // test mode (?mute): connect through a zero gain so the graph still runs, but nothing is heard
    lim.connect(await speakerOut(c, MUTE)); // last: the safety limiter (-1 dBFS), then the speakers
  })();
  return ctxReady.then(async () => { if (ctx.state !== 'running') await ctx.resume(); });
}
// Notes are rendered in workers (pixels.js runs there too), several at once.
// "Slightly different every time": 8 versions of the note — #0 = the chosen area, #1..#7 = the area nudged a little.
// Presses play #1, #2 ... #7, and every 8th press goes back to #0 (the original position). After each round, #1..#7 get new nudges.
// Fast answer to a change: a short draft of #0 (4 s loop) comes first, then the full #0, then #1..#7.
// Until the new sound is ready, presses play the previous one (no silence).
// The key envelope (Attack / Decay / Sustain / High Decay) is applied live in voice(), so changing it needs no re-render.
const VARS = 8, NW = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let gen = 0, variants = new Array(VARS).fill(null), rects = new Array(VARS).fill(null), queue = [], prev = [];
let press = 0, noteInfo = '打鍵の形(ADSR)× 写真の時間の形。水色線から先は押している間くり返す', noteTimer = 0, flash = null;
const waiters = [];
const pool = [];
function spawn(k) {
  const w = { wk: new Worker('note-worker.js?v=13', { type: 'module' }), busy: false, gen: -1, img: null };
  w.wk.onmessage = ({ data: d }) => { w.busy = false; done(d); pump(); };
  pool[k] = w;
}
for (let k = 0; k < NW; k++) spawn(k);
function done(d) {
  if (d.gen !== gen || d.error) return;
  if (d.draft && variants[0] && !variants[0].draft) return; // the full one came first
  const b = ctx.createBuffer(2, d.L.length, ctx.sampleRate);
  b.copyToChannel(d.L, 0); b.copyToChannel(d.R, 1);
  b.loopStart = d.loopStart / ctx.sampleRate; b.loopEnd = d.loopEnd / ctx.sampleRate; b.draft = !!d.draft;
  variants[d.idx] = b; rects[d.idx] = d.rect;
  if (d.idx === 0) {
    drawStrike(d.L, b.loopStart); waiters.splice(0).forEach((w) => w(b));
    if (!d.draft && playing && src && src.buffer.draft) restart(); // the drone moves from the draft to the full sound
  }
  $('.js-vary-info').textContent = `用意できた音: ${variants.filter((v) => v && !v.draft).length} / ${S.vary ? VARS : 1}`;
}
function pump() {
  for (const w of pool) {
    if (w.busy || !queue.length) continue;
    const job = queue.shift();
    if (w.img !== img) { w.wk.postMessage({ type: 'img', id: 'cur', img }); w.img = img; }
    w.busy = true; w.gen = job.gen; w.wk.postMessage(job);
  }
}
function workerSettings() {
  const k = ['fine', 'red', 'lo', 'hi', 'gamma', 'thr', 'max', 'envRule', 'smooth', 'envDur', 'src', 'nh', 'fund', 'depth',
    'wobAmt', 'wobCents', 'wobAmpD', 'wobSlow', 'wobFast', 'wobSpeed', 'wobVary', 'wobSwing', 'wobTogether', 'noiseAmt', 'noiseWidth', 'noiseWob', 'noiseWobW', 'spread', 'harm', 'harmAmt', 'chord', 'perm', 'merge'];
  // rendered flat (instant start, full sustain); the key envelope is added live
  return { ...Object.fromEntries(k.map((x) => [x, S[x]])), A: 0.001, D: 1, Sus: 1, hd: 0, loopSec: 20 }; // 20 s loop: room for slow drone-like swells
}
// the area for version idx: #0 = as chosen; others nudged by up to "shift" of the photo size (no selection: a 92% crop that wanders)
function variantRect(idx) {
  const W = img.width, H = img.height, base = S.rect || { x0: 0, y0: 0, x1: W, y1: H };
  if (idx === 0) return S.rect ? { ...S.rect } : null;
  let { x0, y0, x1, y1 } = base;
  if (!S.rect) { const cw = Math.round(W * 0.92), ch = Math.round(H * 0.92); x0 = Math.round((W - cw) / 2); y0 = Math.round((H - ch) / 2); x1 = x0 + cw; y1 = y0 + ch; }
  const mx = Math.round(W * S.shift), my = Math.round(H * S.shift), dx = Math.round((Math.random() * 2 - 1) * mx), dy = Math.round((Math.random() * 2 - 1) * my);
  const w = x1 - x0, h = y1 - y0, nx = Math.max(0, Math.min(W - w, x0 + dx)), ny = Math.max(0, Math.min(H - h, y0 + dy));
  return { x0: nx, y0: ny, x1: nx + w, y1: ny + h };
}
function request(idxs, draft) {
  if (!ctx || !img) return;
  const set = workerSettings();
  if (draft) queue.push({ type: 'render', gen, idx: 0, draft: 1, rect: variantRect(0), set: { ...set, loopSec: 4 }, sr: ctx.sampleRate });
  for (const idx of idxs) queue.push({ type: 'render', gen, idx, rect: variantRect(idx), set, sr: ctx.sampleRate });
  pump();
}
function noteDirty() {
  if (variants.some(Boolean)) prev = variants; // keep the last sound for presses while the new one is made
  gen++; variants = new Array(VARS).fill(null); queue = []; clearTimeout(noteTimer);
  pool.forEach((w, k) => { if (w.busy && w.gen !== gen) { w.wk.terminate(); spawn(k); } }); // drop work on the old settings
  if (ctx) noteTimer = setTimeout(() => { request(S.vary ? [0, 1, 2, 3, 4, 5, 6, 7] : [0], true); if (playing) restart(); }, 80);
}
function original() { return variants[0] ? Promise.resolve(variants[0]) : new Promise((r) => { waiters.push(r); if (!queue.length && !pool.some((w) => w.busy)) request([0], true); }); }
const ready0 = () => variants[0] || prev[0] || prev.find(Boolean) || null;
// which version this press plays
async function nextBuf() {
  if (!S.vary) return { buf: ready0() || await original(), idx: 0 };
  press++;
  const idx = press % VARS;
  if (idx === 0) { queue = queue.filter((q) => q.idx === 0); request([1, 2, 3, 4, 5, 6, 7]); } // round done: new nudges for the next round
  const b = variants[idx] && !variants[idx].draft ? variants[idx] : null;
  if (b) return { buf: b, idx };
  const old = variants[0] || prev[idx] || ready0(); // not ready yet: the draft / the previous sound, right away
  return { buf: old || await original(), idx: 0 };
}
const liveSrc = new Set(); // every sound that is playing (including release tails), for the panic button
const VOICE_GAIN = 0.45; // one note leaves headroom for chords; the limiter catches the rest
// Key envelope, live: attack ramp, then decay toward Sustain. The decaying part goes through a lowpass that closes,
// so higher partials die sooner (High Decay) — as the old pre-rendered notes did. Times follow the key (higher = faster).
function keyEnv(s, rate, vel) {
  const t = ctx.currentTime, A = Math.max(0.002, S.A / rate), D = Math.max(0.005, S.D / rate), Su = S.Sus;
  const env = ctx.createGain(), sus = ctx.createGain(), dec = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.5;
  s.connect(sus).connect(env); s.connect(lp).connect(dec).connect(env);
  sus.gain.value = Su;
  dec.gain.setValueAtTime(1 - Su, t); dec.gain.setTargetAtTime(0, t + A, D);
  if (S.hd > 0.01 && Su < 0.999) { // cutoff where a partial has lost 1/e more than middle C: 261 * (1 + D/t)^(1/hd)
    const N = 48, T = 5 * D, cv = new Float32Array(N), top = ctx.sampleRate * 0.45;
    for (let i = 0; i < N; i++) { const u = ((i + 1) / N) * T; cv[i] = Math.min(top, 261.63 * rate * Math.pow(1 + D / u, 1 / S.hd)); }
    lp.frequency.setValueAtTime(top, t); lp.frequency.setValueCurveAtTime(cv, t + A, T);
  } else lp.frequency.value = ctx.sampleRate * 0.45;
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vel * VOICE_GAIN, t + A);
  if (Su < 0.001) s.stop(t + A + 8 * D); // no sustain: the note ends by itself
  return env;
}
async function voice(rate, vel, fixed) {
  const { buf, idx } = fixed ? { buf: ready0() || await original(), idx: 0 } : await nextBuf();
  const s = ctx.createBufferSource();
  s.buffer = buf; s.playbackRate.value = rate;
  if (buf.loopEnd > buf.loopStart) { s.loop = true; s.loopStart = buf.loopStart; s.loopEnd = buf.loopEnd; }
  const env = fixed ? ctx.createGain() : keyEnv(s, rate, vel);
  if (fixed) { s.connect(env); env.gain.value = vel * VOICE_GAIN; } // the Play drone: steady
  env.connect(gain); s.start(); s.env = env;
  liveSrc.add(s); s.onended = () => liveSrc.delete(s);
  if (!fixed && S.vary) { flash = { rect: rects[idx], idx, t: performance.now() }; drawOverlay(); setTimeout(drawOverlay, 700); $('.js-vary-now').textContent = idx === 0 ? '今: 元の位置' : `今: ずらし ${idx} / 7`; }
  return s;
}
function fadeOut(s, rel = 0.6) {
  if (!s) return;
  const t = ctx.currentTime;
  s.env.gain.cancelScheduledValues(t); s.env.gain.setValueAtTime(s.env.gain.value, t);
  s.env.gain.setTargetAtTime(0, t, rel / 4); s.stop(t + rel + 0.1);
}
let restartTimer = 0;
function restart() { clearTimeout(restartTimer); restartTimer = setTimeout(async () => { if (!playing) return; fadeOut(src); const s = await voice(1, 1, true); if (playing) src = s; else fadeOut(s, 0.1); }, 150); }
$('.js-play').addEventListener('click', async () => {
  if (!cnt) return;
  await ensureCtx();
  playing = !playing;
  if (playing) { const s = await voice(1, 1, true); if (playing) src = s; else fadeOut(s, 0.1); } else { fadeOut(src); src = null; }
  $('.js-play').textContent = playing ? '■ 止める' : '▶ 鳴らす';
  $('.js-play').classList.toggle('is-on', playing);
});

/* ---------- Space ---------- */
function makeIR(sec) { // decaying stereo noise, darker toward the tail
  const sr = ctx.sampleRate, n = Math.max(1, Math.floor(sr * sec)), b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / n; lp += (Math.random() * 2 - 1 - lp) * (0.15 + 0.75 * (1 - t)); d[i] = lp * Math.pow(1 - t, 2.4) * Math.min(1, i / (sr * 0.01)); }
  }
  return b;
}
function applySpace(force) {
  if (!ctx) return;
  const t = ctx.currentTime, d = S.dist;
  dryLP.frequency.setTargetAtTime(18000 * Math.pow(2500 / 18000, d), t, 0.05); // farther = duller
  dryG.gain.setTargetAtTime(1 - 0.7 * d, t, 0.05);
  wetG.gain.setTargetAtTime(S.rvb * (0.5 + 0.8 * d), t, 0.05);
  wetLP.frequency.setTargetAtTime(9000 * Math.pow(0.4, d), t, 0.05);
  if (force || Math.abs(S.room - roomNow) > 0.05) { roomNow = S.room; conv.buffer = makeIR(S.room); }
}

/* ---------- Finishing rack (shared with the other pages): tube comp -> tape echo -> EQ ---------- */
// echo modes 5-12 are "with reverb": they use this page's room, so turn it up a little if it is almost off
const rack = finishRack($('.js-finish'), {
  defaults: { tcOn: 1, teOn: 1 },
  onEchoMode: (m) => { if (m >= 5 && S.rvb < 0.2) { S.rvb = 0.35; $('.js-rvb').value = 0.35; $('.js-rvb-v').textContent = '35%'; applySpace(); } },
  echoNote: 'モード5〜12のリバーブは、下の「空間」の響きを使います(選ぶと響きを自動で入れます)。',
});

/* ---------- Scenes: favorite areas (photo + area), in the order the loop visits them ---------- */
let scenes = []; // { pid, rect }
const photoOf = (pid) => photos.find((p) => p.pid === pid);
const fullRect = (p) => ({ x0: 0, y0: 0, x1: p.img.width, y1: p.img.height });
function saveScenes() { DB.setMeta('pixelScenes', scenes.map(({ pid, rect, t }) => ({ pid, rect, t }))).catch(() => {}); }
async function loadScenes() { const l = await DB.getMeta('pixelScenes').catch(() => null); scenes = (l || []).filter((sc) => photoOf(sc.pid)); renderScenes(); }
addEventListener("focus", () => { if (!loopOn) loadScenes(); }); // Quake shares this list (another tab may have added scenes)
async function addScene() {
  const p = photos[active]; if (!p) return;
  if (!p.blob) { $('.js-loop-msg').textContent = '見本の色相環はシーンにできません(写真を追加してください)'; return; }
  // Quake shares this list: keep what it added meanwhile (appended, so a running loop's order is not disturbed)
  const key = (sc) => sc.pid + JSON.stringify(sc.rect);
  const fresh = ((await DB.getMeta('pixelScenes').catch(() => null)) || []).filter((sc) => photoOf(sc.pid));
  const have = new Set(scenes.map(key)); for (const sc of fresh) if (!have.has(key(sc))) scenes.push(sc);
  scenes.push({ pid: p.pid, rect: S.rect ? { ...S.rect } : null, t: Date.now() }); saveScenes(); renderScenes();
}
// for the screen frame (js/shell.js): saved loop combinations read / replace the scene list (= the loop's order)
window.__sceneOverwrite = async (i) => {
  const p = photos[active]; if (!p || !p.blob || !scenes[i]) return;
  scenes[i] = { ...scenes[i], pid: p.pid, rect: S.rect ? { ...S.rect } : null, t: Date.now() }; saveScenes(); renderScenes();
};
window.__airScenes = {
  get: () => scenes.map(({ pid, rect, t }) => ({ pid, rect: rect ? { ...rect } : null, t })),
  set: (list) => { scenes = (list || []).filter((sc) => photoOf(sc.pid)).map((sc) => ({ ...sc, rect: sc.rect ? { ...sc.rect } : null })); saveScenes(); renderScenes(); },
};
function renderScenes() {
  const box = $('.js-scenes'); box.innerHTML = '';
  scenes.forEach((sc, i) => {
    const p = photoOf(sc.pid); if (!p) return;
    const el = document.createElement('div'); el.className = 'pcard scard'; el.dataset.i = i; el.dataset.t = sc.t || '';
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240; cv.className = 'pcard__cv scard__cv';
    drawSceneSquare(cv, p.cv, sc.rect);
    const top = document.createElement('div'); top.className = 'pcard__top';
    const nm = document.createElement('span'); nm.textContent = `${i + 1}. ${p.name}`;
    const mk = (t, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pcard__btn'; b.textContent = t; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
    top.append(nm,
      mk('←', '前へ', () => { if (i > 0) { [scenes[i - 1], scenes[i]] = [scenes[i], scenes[i - 1]]; saveScenes(); renderScenes(); } }),
      mk('→', '後ろへ', () => { if (i < scenes.length - 1) { [scenes[i + 1], scenes[i]] = [scenes[i], scenes[i + 1]]; saveScenes(); renderScenes(); } }),
      mk('×', 'シーンから外す', () => { scenes.splice(i, 1); saveScenes(); renderScenes(); }));
    el.append(cv, top);
    el.addEventListener('click', () => { const k = photos.indexOf(p); if (k >= 0) { selectPhoto(k); S.rect = sc.rect ? { ...sc.rect } : null; recount(); } });
    box.append(el);
  });
  $('.js-loop-msg').textContent = scenes.length ? '' : '気に入った範囲を選んで「＋ シーンに追加」。2つ以上でシーン間を移動します。';
}
// scene card: only the chosen area, as a square (the shorter side of the area = 100%, centred)
function drawSceneSquare(cv, src, rect) {
  const r = rect || { x0: 0, y0: 0, x1: src.width, y1: src.height };
  const w = r.x1 - r.x0, h = r.y1 - r.y0, side = Math.min(w, h), sx = r.x0 + (w - side) / 2, sy = r.y0 + (h - side) / 2;
  const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, sx, sy, side, side, 0, 0, cv.width, cv.height);
}
function drawSceneThumb(cv, p, rect) {
  const g = cv.getContext('2d'), sc = Math.min(cv.width / p.cv.width, cv.height / p.cv.height);
  const dw = p.cv.width * sc, dh = p.cv.height * sc, ox = (cv.width - dw) / 2, oy = (cv.height - dh) / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(p.cv, ox, oy, dw, dh);
  const r = rect || fullRect(p);
  g.strokeStyle = '#f0b44c'; g.lineWidth = 2; g.strokeRect(ox + r.x0 * sc, oy + r.y0 * sc, (r.x1 - r.x0) * sc, (r.y1 - r.y0) * sc);
}
$('.js-addscene').addEventListener('click', addScene);

/* ---------- Ambient loop: the area travels scene -> scene, rendered a little ahead and cross-faded ---------- */
// Each scene: first half stays on its area, second half glides to the next scene's area (same photo) or fades to it (other photo).
// The loop is cut into steps; each step is one rendered snapshot that fades in over one step and out over the next.
const loopWorker = new Worker('note-worker.js?v=13', { type: 'module' });
let loopOn = false, loopT0 = 0, loopIdx = 0, loopNext = 0, loopTimer = 0, loopBus = null, loopReqId = 0;
const loopReq = new Map(), loopSrc = new Set(), loopImgSent = new Set();
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
function loopStep() { return Math.max(2, Math.min(6, S.loopLen / (Math.max(1, scenes.length) * 4))); }
function sceneState(t) { // t: 0..1 through the loop
  const n = scenes.length, pos = t * n, i = Math.floor(pos) % n, u = pos - Math.floor(pos), A = scenes[i], B = scenes[(i + 1) % n];
  const pa = photoOf(A.pid), ra = A.rect || fullRect(pa);
  if (n === 1 || u < 0.5) return { pid: A.pid, rect: ra, i, u };
  const k = ease((u - 0.5) / 0.5), pb = photoOf(B.pid), rb = B.rect || fullRect(pb);
  if (A.pid !== B.pid) return k < 0.5 ? { pid: A.pid, rect: ra, i, u } : { pid: B.pid, rect: rb, i, u };
  const L = (a, b) => Math.round(a + (b - a) * k);
  return { pid: A.pid, rect: { x0: L(ra.x0, rb.x0), y0: L(ra.y0, rb.y0), x1: L(ra.x1, rb.x1), y1: L(ra.y1, rb.y1) }, i, u };
}
loopWorker.onmessage = ({ data: d }) => {
  const r = loopReq.get(d.idx); loopReq.delete(d.idx);
  if (!r || !loopOn || d.error) return;
  const step = r.step, now = ctx.currentTime, when = Math.max(r.when, now + 0.05), late = when - r.when;
  const b = ctx.createBuffer(2, d.L.length, ctx.sampleRate); b.copyToChannel(d.L, 0); b.copyToChannel(d.R, 1);
  const src = ctx.createBufferSource(), g = ctx.createGain(), N = 64;
  src.buffer = b; src.loop = true; src.loopStart = d.loopStart / ctx.sampleRate; src.loopEnd = d.loopEnd / ctx.sampleRate;
  const fin = Math.max(0.2, step - late);
  g.gain.setValueAtTime(0, when);
  g.gain.setValueCurveAtTime(Float32Array.from({ length: N }, (_, i) => Math.sin((Math.PI / 2) * (i / (N - 1)))), when, fin); // equal-power fades
  g.gain.setValueCurveAtTime(Float32Array.from({ length: N }, (_, i) => Math.cos((Math.PI / 2) * (i / (N - 1)))), when + fin, step);
  src.connect(g).connect(loopBus);
  src.start(when, d.loopStart / ctx.sampleRate); src.stop(when + fin + step + 0.05);
  loopSrc.add(src); src.onended = () => loopSrc.delete(src);
};
function loopTick() {
  if (!loopOn) return;
  if (S.loopMode === 'wander') return wanderTick();
  if (!scenes.length) return;
  const step = loopStep();
  while (loopNext - ctx.currentTime < 3.5 && loopReq.size < 3) { // render about 3 seconds ahead
    const t = (((loopIdx + 1) * step) % S.loopLen) / S.loopLen, st = sceneState(t), p = photoOf(st.pid);
    if (!loopImgSent.has(st.pid)) { loopWorker.postMessage({ type: 'img', id: st.pid, img: p.img }); loopImgSent.add(st.pid); }
    const set = { ...workerSettings(), A: 0.01, D: 1, Sus: 1, loopSec: 2 * step + 1 }; // steady drone: the ADSR is for the keys
    const id = ++loopReqId;
    loopReq.set(id, { when: loopNext, step });
    loopWorker.postMessage({ type: 'render', gen: 0, idx: id, imgId: st.pid, rect: st.rect, set, sr: ctx.sampleRate });
    loopIdx++; loopNext += step;
  }
}
async function startLoop() {
  if (S.loopMode === 'wander') { if (!photos[active]) return; }
  else if (!scenes.length) { $('.js-loop-msg').textContent = '先にシーンを1つ以上追加してください'; return; }
  await ensureCtx();
  if (S.loopMode === 'wander') wanderStart();
  if (!loopBus) { loopBus = ctx.createGain(); loopBus.connect(gain); }
  loopBus.gain.setValueAtTime(S.loopVol * VOICE_GAIN, ctx.currentTime);
  loopOn = true; loopIdx = 0; loopNext = ctx.currentTime + 0.3; loopT0 = loopNext; // snapshot j is fully in at start + (j+1)*step, which is loop time (j+1)*step
  loopTick(); clearInterval(loopTimer); loopTimer = setInterval(loopTick, 250);
  $('.js-loop').textContent = '■ ループ停止'; $('.js-loop').classList.add('is-on');
  requestAnimationFrame(drawLoopView);
}
function stopLoop(fast) {
  loopOn = false; clearInterval(loopTimer); loopReq.clear();
  if (ctx) for (const src of loopSrc) { try { src.stop(ctx.currentTime + (fast ? 0.05 : 1.5)); } catch {} }
  if (loopBus && ctx) { const t = ctx.currentTime; loopBus.gain.cancelScheduledValues(t); loopBus.gain.setValueAtTime(loopBus.gain.value, t); loopBus.gain.linearRampToValueAtTime(0, t + (fast ? 0.04 : 1.4)); }
  setTimeout(() => { if (!loopOn && loopBus) loopBus.gain.value = S.loopVol * VOICE_GAIN; }, 1600);
  $('.js-loop').textContent = '▶ ループ再生'; $('.js-loop').classList.remove('is-on');
  $$('.scard').forEach((el) => el.classList.remove('is-now'));
}
$('.js-loop').addEventListener('click', () => (loopOn ? stopLoop() : startLoop()));
// where the loop is now: the photo with the moving area, and which scene
function drawLoopView() {
  if (!loopOn) return;
  if (S.loopMode === 'wander') { drawWanderView(); requestAnimationFrame(drawLoopView); return; }
  const t = ((((ctx.currentTime - loopT0) % S.loopLen) + S.loopLen) % S.loopLen) / S.loopLen, st = sceneState(t), p = photoOf(st.pid), cv = $('.js-loopview');
  if (p) drawSceneThumb(cv, p, st.rect);
  const g = cv.getContext('2d'); g.fillStyle = '#f0b44c'; g.fillRect(0, cv.height - 4, cv.width * t, 4);
  $$('.scard').forEach((el) => el.classList.toggle('is-now', +el.dataset.i === st.i));
  $('.js-loop-pos').textContent = `${Math.floor(t * S.loopLen)}秒 / ${S.loopLen}秒・シーン${st.i + 1}${st.u >= 0.5 && scenes.length > 1 ? ` → ${((st.i + 1) % scenes.length) + 1}` : ''}`;
  requestAnimationFrame(drawLoopView);
}

/* ---------- Wandering loop (Perlin): only the start area is chosen; noise moves the area's position and size ---------- */
// The start area (the current selection, or the whole photo) is the home. Seven noises of the chosen kind (js/noise.js):
//  0,1 = position x / y, 2 = size, 3 = width:height, 4 = when to visit a saved scene, 5 = which scene, 6 = travel speed.
// Travel position tau moves at wSpeed bumps per minute, its speed itself swaying by noise 6 (fast / lingering stretches).
// Visits: while noise 4 is high the area is pulled toward one saved scene (all in 0..1 photo coordinates, so other photos
// work too; past half way the sound switches to that scene's photo). Home pull (wHome) shrinks how far it can drift.
// Every W_STEP seconds one snapshot is rendered and cross-faded, exactly like the scene loop.
const W_STEP = 3;
let wander = null;
const clamp01 = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const toNorm = (p, r) => { const W = p.img.width, H = p.img.height; return { x: (r.x0 + r.x1) / 2 / W, y: (r.y0 + r.y1) / 2 / H, w: (r.x1 - r.x0) / W, h: (r.y1 - r.y0) / H }; };
function wanderNoises() { return noiseSet(7, { type: S.wType, seed: S.wSeed, octaves: 3, rough: 0.5 }); }
function wanderStart() {
  const p = photos[active], home = S.rect ? toNorm(p, S.rect) : { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }; // no selection: start from the middle 40%
  if (!S.wKeep) { S.wSeed = 1 + Math.floor(Math.random() * 9999); showSeed(); }
  wander = { p, home, N: wanderNoises(), tau: 0, vi: -1, hist: [] };
}
function wanderState(w) {
  const { N, home } = w, tau = w.tau, amp = S.wRange * (1 - 0.8 * S.wHome);
  let x = home.x + N[0](tau) * amp * 0.5, y = home.y + N[1](tau * 0.93 + 50) * amp * 0.5;
  const sz = Math.pow(2, S.wSize * 1.6 * N[2](tau * 0.8 + 100)), asp = Math.pow(2, S.wSize * 0.5 * N[3](tau * 0.7 + 150));
  let ww = home.w * sz * asp, hh = home.h * sz / asp, a = 0, sp = null;
  if (S.wVisit > 0 && scenes.length) { // visits to saved scenes
    const thr = 0.65 - 0.65 * S.wVisit; a = smoothstep(thr, thr + 0.3, N[4](tau * 0.35 + 200)); // stronger = more often and longer
    if (a < 0.02 || w.vi < 0 || w.vi >= scenes.length) w.vi = Math.min(scenes.length - 1, Math.floor(((N[5](tau * 0.2 + 300) + 1) / 2) * scenes.length)); // pick only while not visiting
    const sc = scenes[w.vi], ps = sc && photoOf(sc.pid);
    if (ps) { const t = toNorm(ps, sc.rect || fullRect(ps)); x += (t.x - x) * a; y += (t.y - y) * a; ww += (t.w - ww) * a; hh += (t.h - hh) * a; sp = ps; } else a = 0;
  }
  const p = a > 0.5 && sp ? sp : w.p, W = p.img.width, H = p.img.height;
  ww = clamp01(ww, 0.06, 1); hh = clamp01(hh, 0.06, 1); x = clamp01(x, ww / 2, 1 - ww / 2); y = clamp01(y, hh / 2, 1 - hh / 2);
  const rect = { x0: Math.round((x - ww / 2) * W), y0: Math.round((y - hh / 2) * H), x1: Math.round((x + ww / 2) * W), y1: Math.round((y + hh / 2) * H) };
  return { p, rect, visit: a > 0.5 ? w.vi : -1, a };
}
function wanderTick() {
  const w = wander; if (!w) return;
  while (loopNext - ctx.currentTime < 3.5 && loopReq.size < 3) {
    const st = wanderState(w), id0 = st.p.pid;
    if (!loopImgSent.has(id0)) { loopWorker.postMessage({ type: 'img', id: id0, img: st.p.img }); loopImgSent.add(id0); }
    const set = { ...workerSettings(), A: 0.01, D: 1, Sus: 1, loopSec: 2 * W_STEP + 1 };
    const id = ++loopReqId;
    loopReq.set(id, { when: loopNext, step: W_STEP });
    loopWorker.postMessage({ type: 'render', gen: 0, idx: id, imgId: id0, rect: st.rect, set, sr: ctx.sampleRate });
    w.hist.push({ when: loopNext + W_STEP, ...st }); if (w.hist.length > 12) w.hist.shift(); // fully in one step later
    const speed = Math.max(0.1, 1 + S.wSpeedVar * 1.2 * w.N[6](loopIdx * W_STEP * 0.02 + 400)); // lingering / rushing stretches
    w.tau += (S.wSpeed / 60) * W_STEP * speed;
    loopIdx++; loopNext += W_STEP;
  }
}
function drawWanderView() {
  const w = wander; if (!w) return;
  const now = ctx.currentTime, h = w.hist.filter((e) => e.when <= now + W_STEP * 0.5).pop() || w.hist[0]; if (!h) return;
  drawSceneThumb($('.js-loopview'), h.p, h.rect);
  const sec = Math.max(0, Math.floor(now - loopT0));
  $('.js-loop-pos').textContent = `さまよって ${Math.floor(sec / 60)}分${sec % 60}秒・${h.p.name}` + (h.visit >= 0 ? `・シーン${h.visit + 1}に立ち寄り中` : h.a > 0.05 ? '・シーンに近づいている' : '') + `(種 ${S.wSeed})`;
  $$('.scard').forEach((el) => el.classList.toggle('is-now', +el.dataset.i === h.visit));
}
function showSeed() { $('.js-wseed').textContent = '種 ' + S.wSeed; }
const wanderRedo = () => { if (wander) wander.N = wanderNoises(); };
$('.js-wtype').innerHTML = Object.entries(NOISE_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('.js-wtype').addEventListener('change', (e) => { S.wType = e.target.value; wanderRedo(); });
$('.js-wnewseed').addEventListener('click', () => { S.wSeed = 1 + Math.floor(Math.random() * 9999); showSeed(); wanderRedo(); });
$$('[data-wkeep]').forEach((b) => b.addEventListener('click', () => { S.wKeep = +b.dataset.wkeep; $$('[data-wkeep]').forEach((x) => x.classList.toggle('is-on', x === b)); }));
$$('[data-loopmode]').forEach((b) => b.addEventListener('click', () => {
  if (loopOn) stopLoop(true);
  S.loopMode = b.dataset.loopmode; $$('[data-loopmode]').forEach((x) => x.classList.toggle('is-on', x === b));
  $$('[data-scenesopt]').forEach((el) => (el.hidden = S.loopMode !== 'scenes')); $$('[data-wanderopt]').forEach((el) => (el.hidden = S.loopMode !== 'wander'));
}));
document.querySelector('[data-loopmode="scenes"]').click(); document.querySelector('[data-wkeep="0"]').click(); showSeed();
$$('[data-looplen]').forEach((b) => b.addEventListener('click', () => { S.loopLen = +b.dataset.looplen; $$('[data-looplen]').forEach((x) => x.classList.toggle('is-on', x === b)); }));

/* ---------- Keyboard / MIDI: C4 = the photo's own pitches, other keys transpose the whole chord ---------- */
const held = new Map(); // id -> { midi, s }
const KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
// A note may still be waiting for its sound to be ready when the key is released.
// Each press gets a ticket; releasing cancels the ticket, and a cancelled note is faded out as soon as it starts.
const pending = new Map(); // id -> { cancel }
async function noteOn(id, midi, vel = 1) {
  if (!cnt) return;
  if (held.has(id) || pending.has(id)) noteOff(id);
  const tk = { cancel: false };
  pending.set(id, tk);
  await ensureCtx();
  const rate = Math.pow(2, (midi - 60) / 12);
  const s = await voice(rate, vel);
  if (pending.get(id) === tk) pending.delete(id);
  if (tk.cancel) { fadeOut(s, S.release); return; } // released while waiting
  if (held.has(id)) noteOff(id);
  held.set(id, { midi, s });
  keyStatus();
}
function noteOff(id) {
  const tk = pending.get(id); if (tk) { tk.cancel = true; pending.delete(id); }
  const h = held.get(id); if (!h) return;
  held.delete(id); fadeOut(h.s, S.release); keyStatus();
}
function allOff() { for (const id of [...pending.keys(), ...held.keys()]) noteOff(id); }
// panic: stop everything now (Esc or the button)
function panic() {
  stopLoop(true);
  for (const tk of pending.values()) tk.cancel = true;
  pending.clear(); held.clear();
  if (playing) { playing = false; src = null; $('.js-play').textContent = '▶ 鳴らす'; $('.js-play').classList.remove('is-on'); }
  for (const s of liveSrc) fadeOut(s, 0.04); // everything, release tails included
  keyStatus();
}
$('.js-panic').addEventListener('click', panic);
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') panic(); });
function keyStatus() {
  $('.js-status').textContent = held.size ? '♪ ' + [...held.values()].map((h) => noteName(h.midi) + ((h.midi - 60) ? ` (${h.midi > 60 ? '+' : ''}${h.midi - 60})` : '')).join(' ') : '';
}
function setKeyOct(o) { S.keyOct = Math.min(7, Math.max(1, o)); $('.js-koct').textContent = 'C' + S.keyOct; }
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, select'))) return;
  if (e.code === 'KeyZ' || e.code === 'KeyX') { setKeyOct(S.keyOct + (e.code === 'KeyX' ? 1 : -1)); return; }
  if (!(e.code in KEYS)) return;
  e.preventDefault(); noteOn('k' + e.code, 12 * (S.keyOct + 1) + KEYS[e.code]);
});
window.addEventListener('keyup', (e) => noteOff('k' + e.code));
window.addEventListener('blur', allOff);
$('.js-midi').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) { $('.js-midi').textContent = 'MIDI 非対応'; return; }
  try {
    const acc = await navigator.requestMIDIAccess();
    const bind = () => { for (const inp of acc.inputs.values()) inp.onmidimessage = onMidi; $('.js-midi').textContent = `MIDI: ${acc.inputs.size}台`; };
    acc.onstatechange = bind; bind();
  } catch { $('.js-midi').textContent = 'MIDI 不可'; }
});
function onMidi({ data: [st, n, v] }) {
  const t = st & 0xf0;
  if (t === 0x90 && v > 0) noteOn('m' + n, n, v / 127);
  else if (t === 0x80 || (t === 0x90 && v === 0)) noteOff('m' + n);
}
$('.js-volume').addEventListener('input', (e) => gain && gain.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.02));

/* ---------- Each component's material: the strongest components' one-cycle waveforms ---------- */
function drawWaves() {
  const box = $('.js-wavesbox'); box.hidden = !waves;
  if (!waves) return;
  const cv = $('.js-waves'), g = cv.getContext('2d'), W = cv.width, H = cv.height, n = Math.min(6, parts.length), cw = W / 6;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < n; k++) {
    const p = parts[k], t = buildTable(waves[k], Math.max(1, Math.min(S.nh, Math.floor(22000 / (2 * p.f)))), 512, S.fund), x0 = k * cw;
    g.fillStyle = '#1a1a1a'; g.fillRect(x0 + cw - 1, 0, 1, H); g.fillRect(x0, H / 2, cw - 8, 1);
    g.beginPath();
    for (let c = 0; c < 2; c++) for (let i = 0; i <= 512; i += 4) { const x = x0 + 8 + ((c * 512 + i) / 1024) * (cw - 24), y = H / 2 + 8 - t[i] * (H / 2 - 20); c || i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = hueCol(p.hue, 60); g.lineWidth = 2; g.stroke();
    g.fillStyle = '#bbb'; g.font = '12px sans-serif'; g.fillText(noteName(p.midi), x0 + 8, 14);
  }
}
$$('[data-src]').forEach((b) => b.addEventListener('click', () => setSrc(b.dataset.src)));
function setSrc(v) { S.src = v; $$('[data-src]').forEach((b) => b.classList.toggle('is-on', b.dataset.src === v)); $$('[data-srcopt]').forEach((el) => (el.hidden = v !== 'row')); if (cnt) repick(); }

/* ---------- Time shape display: the strongest components' level over the area's width ---------- */
function drawEnv() {
  const cv = $('.js-env'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  $('.js-env-note').textContent = envs ? `範囲の左端→右端 = ${S.envDur.toFixed(2)}秒(押している間くり返す)。線=強い成分10本、太いほど強い成分` : '「なし」: 成分はずっと同じ強さ';
  if (!envs) return;
  for (let k = Math.min(9, parts.length - 1); k >= 0; k--) {
    const e = envs[k], p = parts[k];
    g.beginPath();
    for (let b = 0; b < e.length; b++) { const x = (b / (e.length - 1)) * W, y = H - 8 - e[b] * (H - 24); b ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = hueCol(p.hue, 60); g.lineWidth = 1 + 2.5 * p.a; g.stroke();
    let pk = 0; for (let b = 1; b < e.length; b++) if (e[b] > e[pk]) pk = b;
    g.fillStyle = '#ccc'; g.font = '11px sans-serif'; g.fillText(noteName(p.midi), (pk / (e.length - 1)) * W + 3, 14);
  }
}
$$('[data-env]').forEach((b) => b.addEventListener('click', () => setEnvRule(b.dataset.env)));
function setEnvRule(r) { S.envRule = r; $$('[data-env]').forEach((b) => b.classList.toggle('is-on', b.dataset.env === r)); $$('[data-envopt]').forEach((el) => (el.hidden = r === 'none')); if (cnt) repick(); }

// the note (first 1.5s), with the loop start marked
let lastStrike = null;
function redrawStrike() { if (lastStrike) drawStrike(...lastStrike); }
function drawStrike(y0, loopStart) {
  lastStrike = [y0, loopStart];
  const cv = $('.js-strike'), g = cv.getContext('2d'), W = cv.width, H = cv.height, sr = ctx.sampleRate;
  const n = Math.min(y0.length, Math.round(sr * 1.5)), y = new Float32Array(n), A = Math.max(0.002, S.A), D = Math.max(0.005, S.D);
  for (let i = 0; i < n; i++) { const t = i / sr; y[i] = y0[i] * (t < A ? t / A : S.Sus + (1 - S.Sus) * Math.exp(-(t - A) / D)); }
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const wave = (a, n, y0, hh, col) => {
    g.fillStyle = col;
    const per = n / W;
    for (let c = 0; c < W; c++) {
      let mn = 0, mx = 0;
      for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per) + 1 && i < a.length; i++) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; }
      g.fillRect(c, y0 + hh / 2 - mx * hh * 0.45, 1, Math.max(1, (mx - mn) * hh * 0.45));
    }
  };
  const yTop = 0, yH = H;
  wave(y, Math.round(sr * 1.5), yTop, yH, '#ddd');
  if (loopStart > 0 && loopStart < 1.5) { g.fillStyle = 'rgba(120,220,255,.8)'; g.fillRect((loopStart / 1.5) * W, yTop, 1, yH); g.font = '11px sans-serif'; g.fillText('ここから持続(くり返し)', (loopStart / 1.5) * W + 4, H - 6); }
  g.fillStyle = '#888'; g.font = '12px sans-serif';
  g.fillText('1音の形(最初の1.5秒)', 6, yTop + 14);
  $('.js-strike-info').textContent = noteInfo;
}
$('.js-hit').addEventListener('click', async () => { await noteOn('hit', 60); setTimeout(() => noteOff('hit'), 2500); });

/* ---------- Controls ---------- */
// Color -> note order (default / random / saved), shared component with the lead page
S.perm = null;
// photo reading (red = which note, color -> note order): shared by every mode, lives in the left column
noteOrderUI($('.js-noteorder'), { oldKey: 'pixelPerm', onChange: (red, p) => { S.red = red; S.perm = p; recount(); } });
$('.js-fine').addEventListener('change', (e) => { S.fine = +e.target.value; recount(); });
function bind(sel, key, fmt, re) {
  const el = $(sel), out = $(sel + '-v');
  const show = () => { if (out) out.textContent = fmt(S[key]); };
  el.value = S[key]; show();
  el.addEventListener('input', () => { S[key] = +el.value; fixOct(); show(); re(); });
}
function fixOct() {
  if (S.hi <= S.lo) { if (document.activeElement === $('.js-lo')) S.hi = S.lo + 1; else S.lo = S.hi - 1; }
  $('.js-lo').value = S.lo; $('.js-hi').value = S.hi; $('.js-lo-v').textContent = 'C' + S.lo; $('.js-hi-v').textContent = 'C' + S.hi;
}
bind('.js-lo', 'lo', (v) => 'C' + v, recount);
bind('.js-hi', 'hi', (v) => 'C' + v, recount);
bind('.js-gamma', 'gamma', (v) => v.toFixed(2), repick);
bind('.js-thr', 'thr', (v) => Math.round(v * 100) + '%', repick);
bind('.js-max', 'max', (v) => v + '本', repick);
bind('.js-merge', 'merge', (v) => (v > 0 ? Math.round(v * 100) + '%' : 'Off'), repick);
const sec = (v) => (v >= 1 ? v.toFixed(1) + 's' : Math.round(v * 1000) + 'ms');
bind('.js-release', 'release', sec, () => {});
bind('.js-envdur', 'envDur', sec, () => { noteDirty(); drawEnv(); });
bind('.js-smooth', 'smooth', (v) => Math.round(v * 100) + '%', repick);
setEnvRule('none');
bind('.js-a', 'A', sec, redrawStrike); // live: no re-render
bind('.js-wrange', 'wRange', (v) => Math.round(v * 100) + '%', () => {});
bind('.js-wsize', 'wSize', (v) => Math.round(v * 100) + '%', () => {});
bind('.js-wspeed', 'wSpeed', (v) => v.toFixed(1) + '回/分', () => {});
bind('.js-wspeedvar', 'wSpeedVar', (v) => Math.round(v * 100) + '%', () => {});
bind('.js-whome', 'wHome', (v) => Math.round(v * 100) + '%', () => {});
bind('.js-wvisit', 'wVisit', (v) => Math.round(v * 100) + '%', () => {});
bind('.js-loopvol', 'loopVol', (v) => Math.round(v * 100) + '%', () => { if (loopBus && loopOn) loopBus.gain.setTargetAtTime(S.loopVol * VOICE_GAIN, ctx.currentTime, 0.1); });
$$('[data-looplen="60"]').forEach((b) => b.classList.add('is-on'));
bind('.js-harmamt', 'harmAmt', (v) => Math.round(v * 100) + '%', repick);
$$('[data-harm]').forEach((b) => b.addEventListener('click', () => setHarm(b.dataset.harm)));
function setHarm(v) { S.harm = v; $$('[data-harm]').forEach((b) => b.classList.toggle('is-on', b.dataset.harm === v)); $$('[data-harmopt]').forEach((el) => (el.hidden = v === 'normal')); $$('[data-chordopt]').forEach((el) => (el.hidden = v !== 'consonant')); if (cnt) repick(); }
$('.js-chord').addEventListener('change', (e) => { S.chord = e.target.value; if (cnt) repick(); });
setHarm('normal');
bind('.js-shift', 'shift', (v) => Math.round(v * 100) + '%', noteDirty);
$$('[data-vary]').forEach((b) => b.addEventListener('click', () => setVary(+b.dataset.vary)));
function setVary(on) { S.vary = on; press = 0; $$('[data-vary]').forEach((b) => b.classList.toggle('is-on', +b.dataset.vary === on)); $$('[data-varyopt]').forEach((el) => (el.hidden = !on)); noteDirty(); }
setVary(1);
bind('.js-noise', 'noiseAmt', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-nwidth', 'noiseWidth', (v) => '×' + v.toFixed(2), noteDirty);
bind('.js-spread', 'spread', (v) => Math.round(v * 100) + '%', noteDirty); // how far the components are placed left / right (0 = mono; see renderNote)
bind('.js-nwob', 'noiseWob', (v) => '±' + Math.round(v * 100) + '%', noteDirty);
bind('.js-nwobw', 'noiseWobW', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-rvb', 'rvb', (v) => Math.round(v * 100) + '%', () => applySpace());
bind('.js-dist', 'dist', (v) => Math.round(v * 100) + '%', () => applySpace());
bind('.js-room', 'room', sec, () => applySpace());
bind('.js-wobcents', 'wobCents', (v) => '±' + Math.round(v) + 'c', noteDirty);
bind('.js-wobampd', 'wobAmpD', (v) => '±' + Math.round(v * 100) + '%', noteDirty);
bind('.js-wobslow', 'wobSlow', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-wobfast', 'wobFast', (v) => Math.round(v * 100) + '%', noteDirty);
$$('[data-wob]').forEach((b) => b.addEventListener('click', () => setWob(+b.dataset.wob)));
function setWob(on) { S.wobAmt = on; $$('[data-wob]').forEach((b) => b.classList.toggle('is-on', +b.dataset.wob === on)); $$('[data-wobopt]').forEach((el) => (el.hidden = !on)); noteDirty(); }
setWob(1);
bind('.js-wobspeed', 'wobSpeed', (v) => '×' + v.toFixed(2), noteDirty);
bind('.js-wobtog', 'wobTogether', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-wobvary', 'wobVary', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-wobswing', 'wobSwing', (v) => Math.round(v * 100) + '%', noteDirty);
bind('.js-nh', 'nh', (v) => v + '本', () => { noteDirty(); drawWaves(); });
bind('.js-fund', 'fund', (v) => Math.round(v * 100) + '%', () => { noteDirty(); drawWaves(); });
setSrc('sine');
bind('.js-d', 'D', sec, redrawStrike); // live: no re-render
bind('.js-s', 'Sus', (v) => Math.round(v * 100) + '%', redrawStrike); // live: no re-render
bind('.js-hd', 'hd', (v) => v.toFixed(2), redrawStrike); // live: no re-render
bind('.js-depth', 'depth', (v) => Math.round(v * 100) + '%', noteDirty);
setKeyOct(S.keyOct);

/* ---------- Photos (several, side by side; one is active) ---------- */
const photos = []; // { img: ImageData, cv: canvas, rect, name, blob }
let active = -1;
let pidSeq = 1;
function addPhoto(srcImg, name, blob, rect = null, quiet = false, pid = 0) {
  const sc = Math.min(1, 480 / Math.max(srcImg.width, srcImg.height));
  const w = Math.max(1, Math.round(srcImg.width * sc)), h = Math.max(1, Math.round(srcImg.height * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(srcImg, 0, 0, w, h);
  pid = pid || pidSeq; pidSeq = Math.max(pidSeq, pid + 1);
  photos.push({ img: g.getImageData(0, 0, w, h), cv, rect, name: name || '写真' + (photos.length + 1), blob, pid });
  if (!quiet) { selectPhoto(photos.length - 1); savePhotos(); }
}
function selectPhoto(i) {
  if (!photos[i]) return;
  active = i;
  const p = photos[i];
  imgCv.width = ovCv.width = p.cv.width; imgCv.height = ovCv.height = p.cv.height;
  ictx.drawImage(p.cv, 0, 0);
  img = p.img; S.rect = p.rect; S.sel = null;
  recount();
  renderCards();
}
function removePhoto(i) {
  photos.splice(i, 1);
  if (!photos.length) { addPhoto(fallbackImage(), '色相環(見本)'); return; }
  selectPhoto(Math.min(i, photos.length - 1)); savePhotos();
}
// keep the active photo's area in sync (called after every recount)
function syncActive() {
  const p = photos[active]; if (!p) return;
  if (p.rect !== S.rect) { p.rect = S.rect; savePhotosSoon(); }
  drawCard(active);
}
let saveTimer = 0;
const savePhotosSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(savePhotos, 400); };
function savePhotos() { DB.setMeta('pixelPhotos', photos.filter((p) => p.blob).map((p) => ({ blob: p.blob, name: p.name, rect: p.rect, pid: p.pid }))).catch(() => {}); }

// download every photo in the list as image files (the originals as they were added)
$('.js-export').addEventListener('click', async () => {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' };
  const list = photos.filter((p) => p.blob);
  for (const [i, p] of list.entries()) {
    const base = String(p.name || 'photo-' + (i + 1)).replace(/[\\/:*?"<>|]/g, '_');
    const name = /\.[a-z0-9]{2,5}$/i.test(base) ? base : base + (ext[p.blob.type] || '.png');
    const url = URL.createObjectURL(p.blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await new Promise((r) => setTimeout(r, 300)); // a short gap so the browser takes each one
  }
});

function renderCards() {
  const box = $('.js-cards'); box.innerHTML = '';
  photos.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'pcard' + (i === active ? ' is-on' : '');
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 134; cv.className = 'pcard__cv';
    const top = document.createElement('div'); top.className = 'pcard__top';
    const nm = document.createElement('span'); nm.textContent = `${i < 9 ? i + 1 + '. ' : ''}${p.name}`;
    const play = document.createElement('button'); play.type = 'button'; play.className = 'pcard__btn'; play.textContent = '▶'; play.title = 'この写真を選んで C4 で鳴らす';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pcard__btn'; del.textContent = '×'; del.title = '一覧から外す';
    top.append(nm, play, del);
    const chips = document.createElement('div'); chips.className = 'pcard__chips';
    el.append(cv, top, chips);
    el.addEventListener('click', () => selectPhoto(i));
    play.addEventListener('click', (e) => { e.stopPropagation(); selectPhoto(i); audition(); });
    del.addEventListener('click', (e) => { e.stopPropagation(); removePhoto(i); });
    box.append(el);
    drawCard(i);
  });
}
// thumbnail + area outline + the strongest components as color chips
function drawCard(i) {
  const el = $('.js-cards').children[i], p = photos[i]; if (!el || !p) return;
  const cv = el.querySelector('canvas'), g = cv.getContext('2d'), sc = Math.min(cv.width / p.cv.width, cv.height / p.cv.height);
  const dw = p.cv.width * sc, dh = p.cv.height * sc, ox = (cv.width - dw) / 2, oy = (cv.height - dh) / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(p.cv, ox, oy, dw, dh);
  if (p.rect) { g.setLineDash([3, 2]); g.strokeStyle = '#f0b44c'; g.lineWidth = 1.5; g.strokeRect(ox + p.rect.x0 * sc, oy + p.rect.y0 * sc, (p.rect.x1 - p.rect.x0) * sc, (p.rect.y1 - p.rect.y0) * sc); g.setLineDash([]); }
  if (i === active) el.querySelector('.pcard__chips').innerHTML = parts.slice(0, 8).map((q) => `<i style="background:${hueCol(q.hue)}" title="${noteName(q.midi)}"></i><small>${noteName(q.midi)}</small>`).join('');
}
async function audition() {
  await noteOn('aud', 60);
  setTimeout(() => noteOff('aud'), 2000);
}

async function loadFiles(files) {
  files = await readableImages(files); // HEIC -> JPEG
  for (const f of files) if (f && f.type.startsWith('image/')) addPhoto(await createImageBitmap(f), f.name.replace(/\.[^.]+$/, '').slice(0, 24), f);
}
$('.js-file').addEventListener('change', (e) => { loadFiles([...e.target.files]); e.target.value = ''; });
const drop = $('.js-drop');
for (const el of [drop, $('.js-cards')]) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
  el.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  el.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-drag'); loadFiles([...e.dataTransfer.files]); });
}
window.addEventListener('keydown', (e) => { // 1-9: switch photos while playing
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, select'))) return;
  const m = /^Digit([1-9])$/.exec(e.code); if (m && photos[+m[1] - 1]) selectPhoto(+m[1] - 1);
});

function fallbackImage() { // color wheel when there is nothing saved
  const c = document.createElement('canvas'); c.width = 480; c.height = 320;
  const g = c.getContext('2d');
  for (let x = 0; x < 480; x++) { const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, `hsl(${(x / 480) * 360},90%,85%)`); gr.addColorStop(0.5, `hsl(${(x / 480) * 360},90%,50%)`); gr.addColorStop(1, `hsl(${(x / 480) * 360},90%,10%)`); g.fillStyle = gr; g.fillRect(x, 0, 1, 320); }
  return c;
}
const loadSource = (srcImg, name) => addPhoto(srcImg, name || 'テスト');
// start: the saved list, else the photo synth's last image, else the color wheel
(async () => {
  const list = await DB.getMeta('pixelPhotos').catch(() => null);
  if (list && list.length) {
    for (const p of list) { try { addPhoto(await createImageBitmap(p.blob), p.name, p.blob, p.rect, true, p.pid); } catch { /* skip broken */ } }
    if (photos.length) { selectPhoto(0); loadScenes(); return; }
  }
  const last = await DB.getLast().catch(() => null);
  if (last) addPhoto(await createImageBitmap(last), '写真シンセの最後の画像', last);
  else addPhoto(fallbackImage(), '色相環(見本)');
  loadScenes();
})();

window.__px = { ensureCtx, get wander() { return wander; }, wanderState, get scenes() { return scenes; }, addScene, startLoop, stopLoop, get loopSrc() { return loopSrc; }, get loopOn() { return loopOn; }, get echo() { return echo; }, get pending() { return pending; }, get variants() { return variants; }, get rects() { return rects; }, get press() { return press; }, get tube() { return tube; }, get lim() { return lim; }, photos, selectPhoto, get active() { return active; }, get gain() { return gain; }, S, noteOn, noteOff, get held() { return held; }, get ctx() { return ctx; }, get cnt() { return cnt; }, get parts() { return parts; }, loadSource, fallbackImage };

/* ---------- Presets: save / load this page's sound settings by name ---------- */
bindBpm($('.js-bpm'), $('.js-bpm-v')); // shared tempo (used here by the tape echo's 16th-note sync)
presetBar($('.js-presets'), { page: 'pixel' });
