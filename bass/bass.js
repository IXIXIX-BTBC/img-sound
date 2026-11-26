// Bass page, step 1: a sine whose character comes from the chosen photo area.
// Photos: the same shared list as the lead / ambient pages (IndexedDB meta 'pixelPhotos').
import * as DB from '../js/store.js?v=6';
import { readableImages } from '../js/heic.js?v=2';
import { presetBar } from '../js/presets.js?v=2';
import { finishRack } from '../js/finish.js?v=9';
import { getBpm, setBpm, onBpm } from '../js/tempo.js?v=1';
import { speakerOut } from '../js/out.js?v=4';
import { measure, toCharacter, CHAR_LABELS, areaWaves, gritFromArea, PLAIN_GRIT, wobblePaths, wobbleSource, wobbleFrames, SAW_TABLE } from './readarea.js?v=9';
import { makeEq, eqResponse, bandResponse, EQ_TYPES, EQ_DEFAULT } from '../js/eq.js?v=3';
import { PHRASES, toSteps, RATE_LABEL } from './phrases.js?v=1';
import { Osc, Bass } from './bass-worklet.js?v=23';

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const MUTE = new URLSearchParams(location.search).has('mute'); // tests: run silently
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const S = { eq: EQ_DEFAULT(), eqOn: 1, amount: 1, noiseAmt: 1, pAmt: 7, pDec: 0.06, clickAmt: 0.4, keySync: 1, shimAmt: 1, bpm: getBpm(), shimBars: 1, gAmt: 0.5, gDrive: 0.5, gTone: 1500, gLen: 1, gStr: 1, gHoldBars: 1 / 8, gDrop: 0.04, xyMode: 0, xyHold: 0, xyFlip: 0, bLp: 0, bF: 1200, bQ: 0.3, mode: 0, wSrc: 'photo', wCore: 1, subLv: 0.8, wPhoto: 0.5, wGlide: 0.06, wScan: 0.4, wAmt: 1.2, wBars: 1 / 8, wShape: 'sine', wMin: 70, wMax: 3000, wRes: 0.8, wSmooth: 0.01, wDet: 8, wDrive: 0.5, wJit: 0.15, wDrift: 0.2, A: 0.005, D: 0.3, S: 0.85, R: 0.15, glide: 0, legato: 1, keyOct: 2, rect: null };
let eq = null, ctx = null, node = null, gain = null, an = null, ready = null, curMidi = 36, hold = false;
let photos = [], active = -1, img = null, meas = null, ch = toCharacter({ bright: 0.5, contrast: 0, chroma: 0, grain: 0, hueSpread: 0 }, 0);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12), noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

/* ---------- Audio ---------- */
function ensureCtx() {
  if (ready) return ready.then(() => ctx.state !== 'running' && ctx.resume());
  ready = (async () => {
    const c = new AudioContext();
    await c.audioWorklet.addModule('bass-worklet.js?v=23');
    node = new AudioWorkletNode(c, 'bass-synth', { numberOfInputs: 0, outputChannelCount: [2] });
    gain = c.createGain(); gain.gain.value = +$('.js-volume').value;
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -6; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    an = c.createAnalyser(); an.fftSize = 16384; an.smoothingTimeConstant = 0.6;
    const fin = await rack.connect(c);
    eq = makeEq(c); node.connect(eq.input); eq.output.connect(gain).connect(fin.input); fin.output.connect(lim); lim.connect(an); // synth -> EQ -> volume -> finishing rack -> limiter
    eq.set(S.eq, S.eqOn);
    lim.connect(await speakerOut(c, MUTE)); // last: the safety limiter (-1 dBFS), then the speakers
    node.port.onmessage = ({ data }) => { if (data.wph != null) wNow = data; if (data.seqPos != null) showSeqPos(data.seqPos); };
    ctx = c; sendParams(); sendChar();
    $('.js-start').textContent = '音: ON'; $('.js-start').classList.add('is-on');
  })();
  return ready;
}
const sendParams = () => { if (node) node.port.postMessage({ type: 'params', p: { A: S.A, D: S.D, S: S.S, R: S.R, glide: S.mode ? S.wGlide : 0, legato: S.legato, pAmt: S.pAmt, pDec: S.pDec, clickAmt: S.clickAmt, keySync: S.keySync, shimAmt: S.mode ? 0 : S.shimAmt, shimRate: S.shimBars * 4 * (60 / S.bpm), gAmt: S.mode ? 0 : S.gAmt, gDrive: S.gDrive, gTone: S.gTone, gLen: S.gLen, gStr: S.gStr, gHold: S.gHoldBars * 4 * (60 / S.bpm), gDrop: S.gDrop, wAmt: S.mode ? S.wAmt : 0, wRate: S.wBars * 4 * (60 / S.bpm), wShape: S.wShape, wMin: S.wMin, wMax: S.wMax, wRes: S.wRes, wSmooth: S.wSmooth, wDet: S.wDet, wDrive: S.wDrive, wJit: S.wJit, wDrift: S.wDrift, wScan: S.wScan, wSaw: S.wSrc !== 'photo' ? 1 : 0, mode: S.mode, wCore: S.wCore, subLv: S.subLv, wReese: S.wSrc === 'reese' ? 1 : 0, bLp: S.bLp, bF: S.bF, bQ: S.bQ, xyMode: S.mode ? S.xyMode : 0, xyBar: 4 * (60 / S.bpm) } }); drawGrit(); drawAttack(); };
// A/B: "photo on" plays the character, "off" plays the plain sine (same loudness) so the two can be compared
const PLAIN = { shape: 0, drift: 0, jitter: 0, noise: 0, sat: 0, asym: 0, resist: 0, gain: 1, clickLen: 0.005, clickCut: 2000 };
let photoOn = true;
let shim = null, grit = null, wpath = null, wsrc = null, wframes = null, wNow = null;
const FLAT_PATH = (() => { const c = Float32Array.from({ length: 128 }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 128)); return { cut: c, res: new Float32Array(128).fill(0.6) }; })();
const sendChar = () => { if (!node) return; node.port.postMessage({ type: 'char', c: photoOn ? ch : PLAIN }); if (shim) node.port.postMessage({ type: 'shim', waves: shim.waves, depth: photoOn ? shim.depth : 0 }); node.port.postMessage({ type: 'grit', g: photoOn && grit ? grit : PLAIN_GRIT }); sendWob(); };
const sendWob = () => { if (!node) return; const on = photoOn && wsrc && wpath; node.port.postMessage({ type: 'wob', w: { saw: SAW_TABLE, frames: on ? wframes : null, F: 16, table: on ? wsrc : SAW_TABLE, cut: on ? wpath.cut : FLAT_PATH.cut, res: on ? wpath.res : FLAT_PATH.res, grain: on ? meas.grain : 0, hue: on ? meas.hueSpread : 0 } }); };
function setPhotoOn(on) { photoOn = on; $$('[data-ab]').forEach((b) => b.classList.toggle('is-on', +b.dataset.ab === (on ? 1 : 0))); sendChar(); drawScope(); drawAttack(); drawGrit(); drawWPath(); }

/* ---------- Photo area -> character ---------- */
// The 1st and 2nd harmonics of this character, measured against the oscillator's own phase (so the synth can rebuild them
// exactly and keep them still while the upper harmonics wobble). No jitter / drift / noise while measuring.
function lowParts(c) {
  const o = new Osc(), dt = 1 / 48000, f = 110, q = { ...c, jitter: 0, drift: 0, noise: 0 }, N = Math.round((48000 / f) * 40);
  for (let i = 0; i < 4800; i++) o.next(f, q, dt);
  const r = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) { const y = o.next(f, q, dt), th = 2 * Math.PI * o.ph; r[0] += y * Math.cos(th); r[1] += y * Math.sin(th); r[2] += y * Math.cos(2 * th); r[3] += y * Math.sin(2 * th); }
  return r.map((v) => (2 * v) / N);
}
// Level match: run the same oscillator for a moment and scale it to a plain sine's loudness (rms 0.707).
function levelMatch(c) {
  const o = new Osc(), dt = 1 / 48000, f = 110; let s = 0; const q = { ...c, gain: 1 };
  for (let i = 0; i < 2400; i++) o.next(f, q, dt);
  for (let i = 0; i < 9600; i++) { const y = o.next(f, q, dt); s += y * y; }
  return Math.max(0.3, Math.min(3, 0.7071 / Math.sqrt(s / 9600 || 1e-9)));
}
function update() {
  if (!img) return;
  meas = measure(img, S.rect); ch = toCharacter(meas, S.amount, S.noiseAmt); ch.gain = levelMatch(ch); ch.lc = lowParts(ch); shim = areaWaves(img, S.rect); grit = gritFromArea(img, S.rect, meas); wpath = wobblePaths(img, S.rect); wsrc = wobbleSource(img, S.rect); wframes = wobbleFrames(img, S.rect); sendChar(); drawShim(); drawGrit(); drawWPath(); drawOverlay(); if (typeof drawPad === 'function') drawPad();
  const pc = (v) => Math.round(v * 100) + '%';
  $('.js-measure').textContent = `${S.rect ? `選んだ範囲 ${S.rect.x1 - S.rect.x0}×${S.rect.y1 - S.rect.y0}` : '写真全体'}:明るさ ${pc(meas.bright)} / コントラスト ${pc(meas.contrast)} / 色の濃さ ${pc(meas.chroma)} / ザラつき ${pc(meas.grain)} / 色のばらつき ${pc(meas.hueSpread)}`;
  $('.js-chars').innerHTML = CHAR_LABELS.map(([k, name, src, hint]) => `<div class="bs__char"><b>${name}</b><span class="bs__bar"><i style="width:${Math.round(ch[k] * 100)}%"></i></span><span>${pc(ch[k])}</span><span class="bs__src">← ${src}:${hint}</span></div>`).join('');
  $('.js-clickinfo').textContent = `クリックの硬さ(写真の輪郭のくっきり度) ${Math.round((meas.hard ?? 0) * 100)}% → 長さ ${(ch.clickLen * 1000).toFixed(1)}ms・明るさ ${Math.round(ch.clickCut)}Hzまで`;
  drawScope(); drawAttack();
}

/* ---------- Photo canvas: drag to choose an area ---------- */
const imgCv = $('.js-img'), ovCv = $('.js-ov'), ictx = imgCv.getContext('2d', { willReadFrequently: true }), octx = ovCv.getContext('2d');
let drag = null;
const toImg = (e) => { const r = ovCv.getBoundingClientRect(); return { x: Math.round(((e.clientX - r.left) / r.width) * ovCv.width), y: Math.round(((e.clientY - r.top) / r.height) * ovCv.height) }; };
ovCv.addEventListener('pointerdown', (e) => { drag = { a: toImg(e), b: toImg(e) }; try { ovCv.setPointerCapture(e.pointerId); } catch {} });
ovCv.addEventListener('pointermove', (e) => { if (!drag) return; drag.b = toImg(e); drawOverlay(); });
ovCv.addEventListener('pointerup', () => {
  if (!drag) return; const { a, b } = drag; drag = null;
  const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(ovCv.width, Math.max(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(ovCv.height, Math.max(a.y, b.y));
  S.rect = x1 - x0 < 4 || y1 - y0 < 4 ? null : { x0, y0, x1, y1 }; // a click (no drag) = whole photo
  drawOverlay(); update(); savePhotoRect();
});
function drawOverlay() {
  octx.clearRect(0, 0, ovCv.width, ovCv.height);
  const r = drag ? { x0: Math.min(drag.a.x, drag.b.x), y0: Math.min(drag.a.y, drag.b.y), x1: Math.max(drag.a.x, drag.b.x), y1: Math.max(drag.a.y, drag.b.y) } : S.rect;
  if (!r) { if (wpath) [['#f0b44c', wpath.ys[0]], ['#f6c', wpath.ys[1]]].forEach(([c, y]) => { octx.strokeStyle = c; octx.setLineDash([6, 4]); octx.lineWidth = 1.5; octx.beginPath(); octx.moveTo(0, y + 0.5); octx.lineTo(ovCv.width, y + 0.5); octx.stroke(); }); octx.setLineDash([]); return; }
  octx.fillStyle = 'rgba(0,0,0,.45)'; octx.fillRect(0, 0, ovCv.width, ovCv.height); octx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  octx.strokeStyle = '#f0b44c'; octx.lineWidth = 2; octx.strokeRect(r.x0 + 1, r.y0 + 1, r.x1 - r.x0 - 2, r.y1 - r.y0 - 2);
  if (wpath && !drag) { [['#f0b44c', wpath.ys[0]], ['#f6c', wpath.ys[1]]].forEach(([c, y]) => { octx.strokeStyle = c; octx.setLineDash([6, 4]); octx.lineWidth = 1.5; octx.beginPath(); octx.moveTo(r.x0, y + 0.5); octx.lineTo(r.x1, y + 0.5); octx.stroke(); }); octx.setLineDash([]); }
}
function useImage(srcImg, rect) {
  const sc = Math.min(1, 480 / Math.max(srcImg.width, srcImg.height));
  const w = Math.max(1, Math.round(srcImg.width * sc)), h = Math.max(1, Math.round(srcImg.height * sc));
  imgCv.width = ovCv.width = w; imgCv.height = ovCv.height = h;
  ictx.drawImage(srcImg, 0, 0, w, h); img = ictx.getImageData(0, 0, w, h);
  S.rect = rect && rect.x1 <= w && rect.y1 <= h ? { ...rect } : null; drawOverlay(); update();
}

/* ---------- Photos (shared list with the lead / ambient pages) ---------- */
async function selectPhoto(i) { const p = photos[i]; if (!p) return; active = i; useImage(await createImageBitmap(p.blob), p.bassRect); renderCards(); }
function renderCards() {
  const box = $('.js-cards'); box.innerHTML = '';
  photos.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'pcard' + (i === active ? ' is-on' : '');
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 134; cv.className = 'pcard__cv';
    createImageBitmap(p.blob).then((bm) => { const g = cv.getContext('2d'), sc = Math.min(200 / bm.width, 134 / bm.height); g.drawImage(bm, (200 - bm.width * sc) / 2, (134 - bm.height * sc) / 2, bm.width * sc, bm.height * sc); });
    const top = document.createElement('div'); top.className = 'pcard__top'; const nm = document.createElement('span'); nm.textContent = `${i + 1}. ${p.name}`; top.append(nm);
    el.append(cv, top); el.addEventListener('click', () => selectPhoto(i)); box.append(el);
  });
}
// the bass page remembers its own area per photo (bassRect), without touching the other pages' areas
async function savePhotoRect() {
  const p = photos[active]; if (!p) return; p.bassRect = S.rect;
  const list = (await DB.getMeta('pixelPhotos').catch(() => null)) || []; const q = list.find((x) => x.pid === p.pid);
  if (q) { q.bassRect = S.rect; await DB.setMeta('pixelPhotos', list).catch(() => {}); }
}
async function addFiles(files) {
  files = await readableImages(files); // HEIC -> JPEG
  const list = (await DB.getMeta('pixelPhotos').catch(() => null)) || [];
  let pid = list.reduce((m, p) => Math.max(m, p.pid || 0), 0);
  for (const f of files) if (f && f.type.startsWith('image/')) list.push({ blob: f, name: f.name.replace(/\.[^.]+$/, '').slice(0, 24), rect: null, pid: ++pid });
  await DB.setMeta('pixelPhotos', list).catch(() => {});
  photos = list.filter((p) => p.blob); selectPhoto(photos.length - 1);
}
$('.js-file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
const drop = $('.js-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-drag'); addFiles([...e.dataTransfer.files]); });

/* ---------- Controls ---------- */
const sec = (v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'), pct = (v) => Math.round(v * 100) + '%';
const KN = { amount: ['.js-amount', pct, update], noiseAmt: ['.js-noiseamt', pct, update], gAmt: ['.js-gamt', pct, sendParams], gDrive: ['.js-gdrive', pct, sendParams], gTone: ['.js-gtone', (v) => Math.round(v) + 'Hz', sendParams], gLen: ['.js-glen', sec, sendParams], gStr: ['.js-gstr', pct, sendParams], gDrop: ['.js-gdrop', sec, sendParams], wAmt: ['.js-wamt', pct, sendParams], wMin: ['.js-wmin', (v) => Math.round(v) + 'Hz', sendParams], wMax: ['.js-wmax', (v) => Math.round(v) + 'Hz', sendParams], wRes: ['.js-wres', pct, sendParams], wSmooth: ['.js-wsmooth', sec, sendParams], wDet: ['.js-wdet', (v) => '±' + v.toFixed(0) + 'c', sendParams], wDrive: ['.js-wdrive', pct, sendParams], wJit: ['.js-wjit', pct, sendParams], wDrift: ['.js-wdrift', pct, sendParams], wScan: ['.js-wscan', pct, sendParams], wGlide: ['.js-wglide', sec, sendParams], wCore: ['.js-wcore', pct, sendParams], bF: ['.js-bf', (v) => (v >= 1000 ? (v / 1000).toFixed(2) + 'kHz' : Math.round(v) + 'Hz'), sendParams], bQ: ['.js-bq', pct, sendParams], subLv: ['.js-sublv', pct, sendParams], wPhoto: ['.js-wphoto', pct, () => { setPhotoMove(); sendParams(); }], shimAmt: ['.js-shimamt', pct, () => { sendParams(); drawShim(); }], bpm: ['.js-bpm', (v) => Math.round(v) + ' BPM', () => { sendParams(); showBars(); }], pAmt: ['.js-pamt', (v) => '+' + v.toFixed(1) + '半音', sendParams], pDec: ['.js-pdec', sec, sendParams], clickAmt: ['.js-clickamt', pct, sendParams], A: ['.js-a', sec, sendParams], D: ['.js-d', sec, sendParams], S: ['.js-s', pct, sendParams], R: ['.js-r', sec, sendParams] };
for (const [k, [sel, fmt, fn]] of Object.entries(KN)) { const el = $(sel); el.value = S[k]; $(sel + '-v').textContent = fmt(S[k]); el.addEventListener('input', () => { S[k] = +el.value; $(sel + '-v').textContent = fmt(S[k]); fn(); }); }
$$('[data-legato]').forEach((b) => b.addEventListener('click', () => { S.legato = +b.dataset.legato; $$('[data-legato]').forEach((x) => x.classList.toggle('is-on', x === b)); sendParams(); }));
$('[data-legato="1"]').classList.add('is-on');
$$('[data-ksync]').forEach((b) => b.addEventListener('click', () => { S.keySync = +b.dataset.ksync; $$('[data-ksync]').forEach((x) => x.classList.toggle('is-on', x === b)); sendParams(); }));
$('[data-ksync="1"]').classList.add('is-on');
$('.js-volume').addEventListener('input', (e) => { if (gain) gain.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.02); });
// shared tempo (every page uses the same BPM): moving it here moves it everywhere, and another page's change arrives here
$('.js-bpm').addEventListener('input', () => setBpm(S.bpm));
onBpm((v) => { if (S.bpm === v) return; const el = $('.js-bpm'); el.value = v; el.dispatchEvent(new Event('input')); });
$('.js-start').addEventListener('click', ensureCtx);
// finishing rack (shared with the other pages): comp + echo; this page's own EQ above already does the EQ part
const rack = finishRack($('.js-finish'), { eq: true, defaults: { tcOn: 0, teOn: 0 } }); // 11/20: the common EQ (below) is Quake's EQ; the page's own 4-band EQ is kept but left flat and out of the new screen

/* ---------- Keyboard ---------- */
const KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
const down = new Map();
async function press(id, midi) {
  if (seqOn && id !== 'hold') { seqRoot = midi; curMidi = midi; if (node) node.port.postMessage({ type: 'seqRoot', root: midi }); $('.js-seqroot').value = midi; status(); return; } // while a phrase plays, keys move its root
  down.set(id, midi); curMidi = midi; status(); drawScope(); drawAttack(); drawGrit(); await ensureCtx(); if (down.get(id) === midi) node.port.postMessage({ type: 'noteOn', midi }); }
function release(id) { if (seqOn && id !== 'hold' && !down.has(id)) return; const m = down.get(id); if (m == null) return; down.delete(id); status(); if (node) node.port.postMessage({ type: 'noteOff', midi: m }); }
function panic() { stopSeq(); down.clear(); setHold(false); status(); if (node) node.port.postMessage({ type: 'allOff' }); }
function status() { $('.js-status').textContent = down.size ? '♪ ' + [...down.values()].map(noteName).join(' ') : ''; $('.js-note').textContent = noteName(curMidi); }
function setHold(on) { hold = on; $('.js-hold').classList.toggle('is-on', on); if (on) press('hold', 36); else release('hold'); }
$('.js-hold').addEventListener('click', () => setHold(!hold));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { panic(); return; }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, select'))) return;
  if (e.code === 'KeyB') { setPhotoOn(!photoOn); return; }
  if (e.code === 'KeyZ' || e.code === 'KeyX') { S.keyOct = Math.min(5, Math.max(0, S.keyOct + (e.code === 'KeyX' ? 1 : -1))); $('.js-koct').textContent = 'C' + S.keyOct; return; }
  if (!(e.code in KEYS)) return;
  e.preventDefault(); press('k' + e.code, 12 * (S.keyOct + 1) + KEYS[e.code]);
});
window.addEventListener('keyup', (e) => release('k' + e.code));
window.addEventListener('blur', () => { for (const id of [...down.keys()]) if (id !== 'hold') release(id); });
$('.js-panic').addEventListener('click', panic);

// wobble speed as a musical length: one pass over the shape = this many bars (4 beats each) at the BPM
const BARS = [[8, '8小節'], [4, '4小節'], [2, '2小節'], [1, '1小節'], [1 / 2, '1/2小節(2分)'], [1 / 3, '1/3小節(2分3連)'], [1 / 4, '1/4小節(4分)'], [1 / 6, '1/6小節(4分3連)'], [1 / 8, '1/8小節(8分)'], [1 / 12, '1/12小節(8分3連)'], [1 / 16, '1/16小節(16分)']];
function showBars() { const el = document.querySelector('.js-shimbars-v'); if (el) el.textContent = `1巡 ${(S.shimBars * 4 * (60 / S.bpm)).toFixed(2)}秒`; const ew = document.querySelector('.js-wbars-v'); if (ew) ew.textContent = `1周期 ${Math.round(S.wBars * 4 * (60 / S.bpm) * 1000)}ms`; const eh = document.querySelector('.js-ghold-v'); if (eh) eh.textContent = S.gHoldBars ? `${Math.round(S.gHoldBars * 4 * (60 / S.bpm) * 1000)}ms` : 'すぐ落ちる'; }
document.querySelector('.js-shimbars').innerHTML = BARS.map(([v, l]) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${l}</option>`).join('');
document.querySelector('.js-shimbars').addEventListener('change', (e) => { S.shimBars = +e.target.value; sendParams(); showBars(); });
const HOLDS = [[0, 'なし'], [1 / 32, '1/32小節'], [1 / 16, '1/16小節(16分)'], [1 / 12, '1/12小節(8分3連)'], [1 / 8, '1/8小節(8分)'], [1 / 6, '1/6小節(4分3連)'], [1 / 4, '1/4小節(4分)'], [1 / 3, '1/3小節(2分3連)'], [1 / 2, '1/2小節(2分)'], [1, '1小節']];
document.querySelector('.js-ghold').innerHTML = HOLDS.map(([v, l]) => `<option value="${v}"${v === 1 / 8 ? ' selected' : ''}>${l}</option>`).join('');
document.querySelector('.js-ghold').addEventListener('change', (e) => { S.gHoldBars = +e.target.value; sendParams(); showBars(); });
const wb = document.querySelector('.js-wbars'); wb.innerHTML = BARS.map(([v, l]) => `<option value="${v}"${v === 1 / 8 ? ' selected' : ''}>${l}</option>`).join('');
wb.addEventListener('change', (e) => { S.wBars = +e.target.value; sendParams(); showBars(); });
// Two instruments on one core: bass (grit, upper-harmonic wobble) / wobble (sub + everything else through the moving filter).
// Switching shows only that instrument's sections; it does not rewrite the other sections.
// Each instrument keeps its own Photo (photo on/off, photo amount, noise amount), Attack and Envelope (ADSR): switching puts
// the other one's values away and brings this one's back (the wobble starts with a softer click and push).
const PER = ['amount', 'noiseAmt', 'pAmt', 'pDec', 'clickAmt', 'A', 'D', 'S', 'R'];
const mem = { 0: null, 1: { pAmt: 3, pDec: 0.04, clickAmt: 0.1 } }; // the values of the instrument NOT showing
const grabMode = () => ({ ...Object.fromEntries(PER.map((k) => [k, S[k]])), photoOn });
function putMode(v) {
  const was = { amount: S.amount, noiseAmt: S.noiseAmt };
  setKnobs(Object.fromEntries(PER.filter((k) => k in v).map((k) => [k, v[k]])));
  if ('photoOn' in v && v.photoOn !== photoOn) setPhotoOn(v.photoOn);
  if (img && (S.amount !== was.amount || S.noiseAmt !== was.noiseAmt)) update(); // the photo character is rebuilt with this amount
}
// Sound save / load: the instrument that is not showing travels along too (js/presets.js asks for it)
window.__presetExtra = { get: () => ({ quakeOther: { m: 1 - S.mode, v: mem[1 - S.mode] } }), set: (x) => { const o = x?.quakeOther; if (o && o.m === 1 - S.mode) mem[o.m] = o.v ? { ...o.v } : null; } };
function setKnobs(v) { for (const [k, x] of Object.entries(v)) { S[k] = x; if (KN[k]) { const [sel, fmt] = KN[k], el = $(sel); if (el) { el.value = x; const o = $(sel + '-v'); if (o) o.textContent = fmt(x); } } } }
function setMode(m) {
  if (m !== S.mode) { const out = grabMode(); S.mode = m; putMode({ ...out, ...(mem[m] || {}) }); mem[1 - m] = out; }
  $$('[data-mode]').forEach((x) => x.classList.toggle('is-on', +x.dataset.mode === m));
  $$('[data-only]').forEach((el) => (el.hidden = el.dataset.only !== (m ? 'wob' : 'bass')));
  if (!m) stopSeq();
  sendParams(); drawWPath();
}
// "photo in the movement": one knob for the three photo-made motions of the wobble (running waveform, jitter, drift)
function setPhotoMove() { setKnobs({ wScan: 0.8 * S.wPhoto, wJit: 0.3 * S.wPhoto, wDrift: 0.4 * S.wPhoto }); }
$$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(+b.dataset.mode)));
$$('[data-blp]').forEach((b) => b.addEventListener('click', () => { S.bLp = +b.dataset.blp; $$('[data-blp]').forEach((x) => x.classList.toggle('is-on', x === b)); sendParams(); }));
document.querySelector('[data-blp="0"]').classList.add('is-on');
$$('[data-wsrc]').forEach((b) => b.addEventListener('click', () => { S.wSrc = b.dataset.wsrc; $$('[data-wsrc]').forEach((x) => x.classList.toggle('is-on', x === b)); sendParams(); }));
document.querySelector('[data-wsrc="photo"]').classList.add('is-on');
document.querySelector('.js-wshape').addEventListener('change', (e) => { S.wShape = e.target.value; sendParams(); });
showBars();

/* ---------- 4-band parametric EQ: panel rows + handles on the spectrum ---------- */
// Each band: type, frequency (where), gain (how much), width (Q). The curve and the four handles are drawn on top of the
// real spectrum (drawSpec); drag a handle = frequency (left/right) and gain (up/down), mouse wheel on it = width, double click = gain 0.
const EQ_COLS = ['#6cf', '#9e6', '#f0b44c', '#f6c'];
const EQ_LO = Math.log(20), EQ_HI = Math.log(16000), EQ_DB = 15;
const fToK = (f) => (Math.log(f) - EQ_LO) / (EQ_HI - EQ_LO), kToF = (k) => Math.exp(EQ_LO + k * (EQ_HI - EQ_LO));
const fmtF = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : Math.round(f)) + 'Hz';
function setEq() { if (eq) eq.set(S.eq, S.eqOn); syncEqPanel(); }
function syncEqPanel() {
  S.eq.forEach((b, i) => {
    const r = document.querySelector(`[data-eqrow="${i}"]`); if (!r) return;
    r.querySelector('.js-eqtype').value = b.type; r.querySelector('.js-eqf').value = fToK(b.f); r.querySelector('.js-eqg').value = b.g; r.querySelector('.js-eqq').value = b.q;
    r.querySelector('.js-eqf-v').textContent = fmtF(b.f); r.querySelector('.js-eqg-v').textContent = (b.g > 0 ? '+' : '') + b.g.toFixed(1) + 'dB';
    r.querySelector('.js-eqq-v').textContent = b.type === 'peaking' ? 'Q ' + b.q.toFixed(2) : '固定'; r.querySelector('.js-eqq').disabled = b.type !== 'peaking';
  });
}
{
  const box = document.querySelector('.js-eq');
  box.innerHTML = S.eq.map((b, i) => `<div class="peq" data-eqrow="${i}"><div class="peq__hd"><i style="background:${EQ_COLS[i]}">${i + 1}</i><select class="js-eqtype">${Object.entries(EQ_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="row"><span>帯域</span><input type="range" class="js-eqf" min="0" max="1" step="0.001"><b class="js-eqf-v"></b></div>
    <div class="row"><span>高さ</span><input type="range" class="js-eqg" min="-15" max="15" step="0.5"><b class="js-eqg-v"></b></div>
    <div class="row"><span>幅</span><input type="range" class="js-eqq" min="0.3" max="8" step="0.05"><b class="js-eqq-v"></b></div></div>`).join('');
  box.addEventListener('input', (e) => {
    const r = e.target.closest('[data-eqrow]'); if (!r) return; const b = S.eq[+r.dataset.eqrow];
    if (e.target.matches('.js-eqf')) b.f = kToF(+e.target.value); else if (e.target.matches('.js-eqg')) b.g = +e.target.value; else if (e.target.matches('.js-eqq')) b.q = +e.target.value;
    setEq();
  });
  box.addEventListener('change', (e) => { if (!e.target.matches('.js-eqtype')) return; S.eq[+e.target.closest('[data-eqrow]').dataset.eqrow].type = e.target.value; setEq(); });
  document.querySelector('.js-eqreset').addEventListener('click', () => { S.eq = EQ_DEFAULT(); setEq(); });
  $$('[data-eqon]').forEach((b) => b.addEventListener('click', () => { S.eqOn = +b.dataset.eqon; $$('[data-eqon]').forEach((x) => x.classList.toggle('is-on', x === b)); setEq(); }));
  document.querySelector('[data-eqon="1"]').classList.add('is-on');
  syncEqPanel();
  // handles on the spectrum
  const sc = document.querySelector('.js-spec'); let grab = -1;
  const toCv = (e) => { const r = sc.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * sc.width, y: ((e.clientY - r.top) / r.height) * sc.height }; };
  const handleXY = (b) => ({ x: fToK(b.f) * sc.width, y: sc.height / 2 - (b.g / EQ_DB) * (sc.height / 2 - 14) });
  const pick = (p) => { let best = -1, bd = 18; S.eq.forEach((b, i) => { const h = handleXY(b), d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = i; } }); return best; };
  sc.addEventListener('pointerdown', (e) => { grab = pick(toCv(e)); if (grab >= 0) try { sc.setPointerCapture(e.pointerId); } catch {} });
  sc.addEventListener('pointermove', (e) => {
    const p = toCv(e); sc.style.cursor = grab >= 0 || pick(p) >= 0 ? 'grab' : 'default'; if (grab < 0) return;
    const b = S.eq[grab]; b.f = Math.min(16000, Math.max(20, kToF(p.x / sc.width))); b.g = Math.round(Math.max(-EQ_DB, Math.min(EQ_DB, ((sc.height / 2 - p.y) / (sc.height / 2 - 14)) * EQ_DB)) * 2) / 2; setEq();
  });
  sc.addEventListener('pointerup', () => { grab = -1; });
  sc.addEventListener('wheel', (e) => { const i = pick(toCv(e)); if (i < 0 || S.eq[i].type !== 'peaking') return; e.preventDefault(); const b = S.eq[i]; b.q = Math.min(8, Math.max(0.3, b.q * (e.deltaY > 0 ? 0.9 : 1.1))); setEq(); }, { passive: false });
  sc.addEventListener('dblclick', (e) => { const i = pick(toCv(e)); if (i >= 0) { S.eq[i].g = 0; setEq(); } });
}

// colors for a graph: on the light-green screen (inside .ui) the screen's own colors (dark green / mid green at different strengths), else the old dark look
const PAL = (cv) => cv.closest('.ui')
  ? { bg: '', grid: 'rgba(160,179,87,.45)', text: '#a0b357', line: '#1b2a13', line2: 'rgba(27,42,19,.55)', fill: (a) => `rgba(160,179,87,${a})`, veil: 'rgba(225,231,177,.72)', now: '#1b2a13' }
  : { bg: '#000', grid: '#2a2a2a', text: '#888', line: '#f0b44c', line2: '#f6c', fill: (a) => `rgba(240,180,76,${a})`, veil: 'rgba(0,0,0,.6)', now: '#fff' };
/* ---------- Wobble path preview: what the two bands of the area become (one LFO cycle) ---------- */
window.__drawWPath = () => drawWPath(); // the screen redraws it once the graph sits on the light-green screen
function drawWPath() {
  const cv = document.querySelector('.js-wpath'); if (!cv || !wpath) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, N = wpath.cut.length, top = 16, ch = H - top - 18;
  const P = PAL(cv); // the light-green screen's colors (or the old dark ones)
  if (P.bg) { g.fillStyle = P.bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
  g.font = '11px sans-serif';
  for (let q = 0; q <= 4; q++) { const x = (q / 4) * W; g.fillStyle = P.grid; g.fillRect(x, top, 1, ch); g.fillStyle = P.text; g.fillText(q ? `${q}/4` : '0', x + 3, H - 5); }
  // the filter opening as a filled shape (closed = bottom, open = top), resonance as its strength
  for (let x = 0; x < W; x++) { const i = Math.floor((x / W) * N), c = wpath.cut[i], r = wpath.res[i]; const y = top + (1 - c) * ch; g.fillStyle = P.fill(0.15 + 0.5 * r); g.fillRect(x, y, 1, top + ch - y); }
  g.strokeStyle = P.line; g.lineWidth = 2; g.beginPath(); for (let x = 0; x < W; x++) { const y = top + (1 - wpath.cut[Math.floor((x / W) * N)]) * ch; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  g.strokeStyle = P.line2; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); for (let x = 0; x < W; x++) { const y = top + (1 - wpath.res[Math.floor((x / W) * N)]) * ch; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]);
  g.fillStyle = P.line; g.fillText('━ filter opening (upper band)', 6, 12); g.fillStyle = P.line2; g.fillText('┅ resonance (lower band)', 190, 12);
  g.fillStyle = P.text; g.fillText(`brightness range: upper ${Math.round(wpath.cutRange * 100)}% / lower ${Math.round(wpath.resRange * 100)}%`, 380, 12);
  if (S.wShape !== 'photo') { g.fillStyle = P.veil; g.fillRect(0, top, W, ch); g.fillStyle = P.line; g.fillText('Used only when LFO Shape is Photo Path', 12, top + ch / 2); }
  if (wNow && down.size) { const x = wNow.wph * W; g.fillStyle = P.now; g.fillRect(x, top, 2, ch); } // where the LFO is now
  drawWSrc();
}
// the wobble's sound source: the area's columns read as one cycle (2 cycles shown)
function drawWSrc() {
  for (const sel of ['.js-wsrc', '.js-m-wsrc']) {
    const cv = document.querySelector(sel); if (!cv) continue;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, tab = photoOn && wsrc ? wsrc : SAW_TABLE;
    const P = PAL(cv);
    if (P.bg) { g.fillStyle = P.bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
    g.strokeStyle = P.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = P.bg ? '#9e6' : P.line; g.lineWidth = 1.5; g.beginPath(); for (let x = 0; x < W; x++) { const v = tab[Math.floor(((x / W) * 2 % 1) * 2048)]; const y = H / 2 - v * (H / 2 - 4); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  }
}

/* ---------- Grit layer: its harmonics at the strike (where they sit and how strong), as bars ---------- */
function drawGrit() {
  const cv = document.querySelector('.js-gritcv'); if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, lo = Math.log(100), hi = Math.log(8000), xOf = (f) => ((Math.log(f) - lo) / (hi - lo)) * W;
  const src = photoOn && grit ? grit : PLAIN_GRIT, f = 440 * Math.pow(2, (curMidi - 69) / 12), B = src.stretch * S.gStr * 0.0004, tone = Math.log2(S.gTone);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif';
  for (const fr of [200, 400, 1000, 2000, 4000]) { g.fillStyle = '#333'; g.fillRect(xOf(fr), 0, 1, H); g.fillStyle = '#666'; g.fillText(fr >= 1000 ? fr / 1000 + 'k' : fr, xOf(fr) + 2, H - 4); }
  g.fillStyle = 'rgba(240,180,76,.25)'; g.fillRect(xOf(S.gTone) - 1, 0, 3, H);
  let mx = 0; const bars = [];
  for (let h = Math.max(1, Math.ceil(400 / f)); h <= 64; h++) { const fh = h * f * Math.sqrt(1 + B * h * h); if (fh > 8000) break; const a = src.H[h] * (0.15 + 1 / (1 + ((Math.log2(fh) - tone) / 0.9) ** 2)); bars.push([fh, a, h]); mx = Math.max(mx, a); }
  for (const [fh, a, h] of bars) { const x = xOf(fh), bh = (a / (mx || 1)) * (H - 22); g.fillStyle = '#f0b44c'; g.fillRect(x - 1, H - 16 - bh, 3, bh); const pure = xOf(h * f); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(pure, H - 16, 1, 6); }
  const cents = bars.length ? Math.round(1200 * Math.log2(bars[bars.length - 1][0] / (bars[bars.length - 1][2] * f))) : 0;
  const info = document.querySelector('.js-gritinfo'); if (info) info.textContent = `写真から: 伸び(輪郭のくっきり度) ${Math.round(src.stretch * 100)}%・歪みの元(コントラスト) ${Math.round(src.drive * 100)}% → 一番上の倍音は ${cents > 0 ? '+' : ''}${cents}セントずれ`;
}

/* ---------- Upper-harmonic wobble: the three shapes from the area ---------- */
function drawShim() {
  const cv = $('.js-shimcv'); if (!cv || !shim) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, cols = ['#6cf', '#f0b44c', '#f6c'], rowH = H / 3;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif';
  shim.waves.forEach((wv, j) => {
    const y0 = rowH * j + rowH / 2; g.strokeStyle = '#222'; g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke();
    g.strokeStyle = cols[j]; g.lineWidth = 1.5; g.beginPath(); for (let x = 0; x < W; x++) { const v = wv[Math.floor((x / W) * wv.length)]; const y = y0 - v * (rowH / 2 - 6); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.fillStyle = cols[j]; g.fillText(['3–4th harmonics (top of the area)', '5–8th (middle)', '9th + (bottom)'][j], 6, rowH * j + 13);
  });
  $('.js-shiminfo').textContent = `範囲の明暗の変化から決まった揺れの深さ ${Math.round(shim.depth * 100)}% × 揺れの量 ${Math.round(S.shimAmt * 100)}%`;
}

/* ---------- The strike: the first 120 ms of a note, run with the synth itself (no sound) ---------- */
function drawAttack() {
  const cv = $('.js-attack'); if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, sr = 48000, N = Math.round(0.12 * sr);
  const b = new Bass(); b.sr = sr; Object.assign(b.p, { A: S.A, D: S.D, S: S.S, R: S.R, glide: 0, legato: 1, pAmt: S.pAmt, pDec: S.pDec, clickAmt: S.clickAmt });
  Object.assign(b.c, photoOn ? ch : PLAIN); b.msg({ type: 'noteOn', midi: curMidi });
  const L = new Float32Array(N), out = [[L, new Float32Array(N)]]; b.process([], out);
  let pk = 0.01; for (const v of L) pk = Math.max(pk, Math.abs(v));
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.strokeStyle = '#222'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.fillStyle = '#555'; g.font = '11px sans-serif'; for (const ms of [0, 20, 40, 60, 80, 100]) { const x = (ms / 120) * W; g.fillRect(x, 0, 1, H); g.fillText(ms + 'ms', x + 3, H - 4); }
  g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); for (let x = 0; x < W; x++) { const v = L[Math.floor((x / W) * N)] / pk; const y = H / 2 - v * (H / 2 - 10); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
}

/* ---------- Waveform (same oscillator, run here) and the real spectrum ---------- */
window.__drawScope = () => drawScope(); // the screen's zoom buttons set window.__scopeCycles and redraw
function drawScope() {
  const cv = $('.js-scope'), g = cv.getContext('2d'), W = cv.width, H = cv.height, f = mtof(curMidi), sr = 48000, dt = 1 / sr;
  const cyc = window.__scopeCycles || 3, o = new Osc(), N = Math.round((cyc / f) * sr), warm = Math.round((4 / f) * sr);
  const cc = photoOn ? ch : PLAIN; for (let i = 0; i < warm; i++) o.next(f, cc, dt); // let the filters settle
  o.ph = 0; const ys = Float32Array.from({ length: N }, () => o.next(f, cc, dt));
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.strokeStyle = '#222'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  if (!document.body.dataset.uiMode) { g.strokeStyle = '#555'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x < W; x++) { const y = H / 2 - Math.sin(2 * Math.PI * 3 * (x / W)) * (H / 2 - 12); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  const yOf = (s) => H / 2 - Math.max(-1.2, Math.min(1.2, s * (cc.gain || 1))) * (H / 2 - 12);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
  if (N <= W * 1.5) { for (let x = 0; x < W; x++) { const y = yOf(ys[Math.floor((x / W) * N)]); x ? g.lineTo(x, y) : g.moveTo(x, y); } }
  else for (let x = 0; x < W; x++) { const a = Math.floor((x / W) * N), b = Math.max(a + 1, Math.floor(((x + 1) / W) * N)); let lo = Infinity, hi = -Infinity; for (let j = a; j < b; j++) { lo = Math.min(lo, ys[j]); hi = Math.max(hi, ys[j]); } x ? g.lineTo(x, yOf(hi)) : g.moveTo(x, yOf(hi)); g.lineTo(x, yOf(lo)); } // many cycles: each column shows its highest and lowest point
  g.stroke();
}
const spec = new Float32Array(8192);
function drawSpec() {
  requestAnimationFrame(drawSpec);
  if (wNow && down.size) drawWPath();
  const cv = $('.js-spec'), g = cv.getContext('2d'), W = cv.width, H = cv.height, xOf = (f) => fToK(f) * W;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif';
  for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) { g.fillStyle = '#333'; g.fillRect(xOf(f), 0, 1, H); g.fillStyle = '#666'; g.fillText(f >= 1000 ? f / 1000 + 'k' : f, xOf(f) + 2, H - 4); }
  const f0 = mtof(curMidi);
  for (let h = 1; h <= 8; h++) { const x = xOf(f0 * h); g.fillStyle = h % 2 ? 'rgba(110,200,255,.35)' : 'rgba(240,180,76,.4)'; g.fillRect(x, 14, 1, H - 30); g.fillText(h + '倍', x + 2, 12); }
  if (an && ctx) { // ctx is set a moment after the analyser (the audio setup waits for the output stage)
    an.getFloatFrequencyData(spec); const bin = ctx.sampleRate / an.fftSize;
    g.strokeStyle = '#ddd'; g.lineWidth = 1.2; g.beginPath(); let st = false;
    for (let k = 1; k < spec.length; k++) { const f = k * bin; if (f < 20 || f > 16000) continue; const y = H - 18 - ((spec[k] + 110) / 100) * (H - 30); st ? g.lineTo(xOf(f), Math.min(H - 18, y)) : (g.moveTo(xOf(f), y), (st = true)); }
    g.stroke();
  }
  // EQ on top: 0 dB line, each band's own shape (thin), the total (thick), and the handles
  const yOf = (db) => H / 2 - (db / EQ_DB) * (H / 2 - 14);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, yOf(0), W, 1);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText('+' + EQ_DB + 'dB', W - 40, yOf(EQ_DB) + 4); g.fillText('-' + EQ_DB + 'dB', W - 40, yOf(-EQ_DB) - 2);
  if (S.eqOn) S.eq.forEach((b, i) => { if (!b.g) return; g.strokeStyle = EQ_COLS[i]; g.globalAlpha = 0.45; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= W; x += 3) { const y = yOf(bandResponse(b, kToF(x / W))); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.globalAlpha = 1; });
  g.strokeStyle = S.eqOn ? '#f0b44c' : '#666'; g.lineWidth = 2.5; g.beginPath();
  for (let x = 0; x <= W; x += 2) { const y = yOf(S.eqOn ? eqResponse(S.eq, kToF(x / W)) : 0); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  S.eq.forEach((b, i) => { const x = xOf(b.f), y = yOf(b.g); g.fillStyle = EQ_COLS[i]; g.beginPath(); g.arc(x, y, 9, 0, 2 * Math.PI); g.fill(); g.fillStyle = '#000'; g.font = 'bold 11px sans-serif'; g.fillText(i + 1, x - 3.5, y + 4); g.font = '11px sans-serif'; });
}

/* ---------- Classic wobble phrases: pick one and it plays with the current sound ---------- */
let seqOn = false, seqSel = 0, seqRoot = 36;
const TOK = { C: 'C', c: 'c', G: 'G', E: 'E♭', '-': '', '.': '' };
function renderPhrases() {
  const box = $('.js-phrases'); box.innerHTML = '';
  PHRASES.forEach((ph, k) => {
    const el = document.createElement('div'); el.className = 'phr' + (k === seqSel ? ' is-on' : ''); el.dataset.k = k;
    const cells = ph.bars.map((bar, b) => `<div class="phr__bar">${[...bar].map((ch, i) => `<i class="phr__c ${ch === '-' ? 'is-tie' : ch === '.' ? 'is-rest' : 'is-on'}" data-s="${b * 16 + i}">${TOK[ch]}</i>`).join('')}</div><div class="phr__rates">${ph.rates[b].map((r) => `<span>${RATE_LABEL(r)}</span>`).join('')}</div>`).join('');
    el.innerHTML = `<div class="phr__hd"><b>${ph.name}</b><span>${ph.hint}${ph.shape ? '(LFOは矩形)' : ''}</span></div>${cells}`;
    el.addEventListener('click', () => { seqSel = k; renderPhrases(); if (seqOn) startSeq(); });
    box.append(el);
  });
}
function showSeqPos(pos) { $$('.phr.is-on .phr__c').forEach((c) => c.classList.toggle('is-now', +c.dataset.s === pos)); }
async function startSeq() {
  await ensureCtx(); if (hold) setHold(false);
  const ph = PHRASES[seqSel], bar = 4 * (60 / S.bpm);
  node.port.postMessage({ type: 'seq', steps: toSteps(ph), root: seqRoot, step: bar / 16, bar, shape: S.seqShape && ph.shape ? ph.shape : null });
  seqOn = true; curMidi = seqRoot; status(); $('.js-seqplay').textContent = '■ 止める'; $('.js-seqplay').classList.add('is-on');
}
function stopSeq() { if (!seqOn) return; seqOn = false; if (node) node.port.postMessage({ type: 'seqStop' }); $('.js-seqplay').textContent = '▶ フレーズを鳴らす'; $('.js-seqplay').classList.remove('is-on'); showSeqPos(-1); }
$('.js-seqplay').addEventListener('click', () => (seqOn ? stopSeq() : startSeq()));
$('.js-seqroot').innerHTML = Array.from({ length: 25 }, (_, i) => 24 + i).map((m) => `<option value="${m}"${m === 36 ? ' selected' : ''}>${noteName(m)}</option>`).join('');
$('.js-seqroot').addEventListener('change', (e) => { seqRoot = +e.target.value; curMidi = seqRoot; if (node && seqOn) node.port.postMessage({ type: 'seqRoot', root: seqRoot }); status(); });
S.seqShape = 1;
$$('[data-seqshape]').forEach((b) => b.addEventListener('click', () => { S.seqShape = +b.dataset.seqshape; $$('[data-seqshape]').forEach((x) => x.classList.toggle('is-on', x === b)); if (seqOn) startSeq(); }));
$('[data-seqshape="1"]').classList.add('is-on');
$('.js-bpm').addEventListener('input', () => { if (seqOn) startSeq(); }); // new tempo: restart the phrase in time
renderPhrases();

/* ---------- XY pad (wobble): touch and slide; A = speed x opening, B = hand wah, C = trace the photo ---------- */
const XY_RATES = ['1/4', '1/8', '1/8T', '1/16', '1/32'];
const pad = { act: 0, x: 0.5, y: 0.5 };
// D can flip its hand part (the vertical): flipped = up closes the filter (and lowers the resonance), down opens it
const padY = () => (S.xyMode === 4 && S.xyFlip ? 1 - pad.y : pad.y);
function sendXY() { if (node) node.port.postMessage({ type: 'xy', act: pad.act, x: pad.x, y: padY() }); drawPad(); }
function drawPad() {
  const cv = $('.js-xy'); if (!cv) return;
  // draw at the size it is shown (×2 for sharpness), so text and the dot are not stretched
  const cw = Math.round(cv.clientWidth), ch = Math.round(cv.clientHeight);
  if (cw > 0 && ch > 0 && (cv.width !== cw * 2 || cv.height !== ch * 2)) { cv.width = cw * 2; cv.height = ch * 2; }
  const g = cv.getContext('2d'), W = cv.width / 2, H = cv.height / 2, m = S.xyMode; g.setTransform(2, 0, 0, 2, 0, 0);
  if (!drawPad.ro && window.ResizeObserver) { drawPad.ro = new ResizeObserver(() => drawPad()); drawPad.ro.observe(cv); }
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H); g.font = '12px sans-serif';
  if (m === 3 && img) { const r = S.rect || { x0: 0, y0: 0, x1: imgCv.width, y1: imgCv.height }; g.globalAlpha = 0.75; g.drawImage(imgCv, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, 0, W, H); g.globalAlpha = 1; }
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  if (m === 1) { for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo((i / 5) * W, 0); g.lineTo((i / 5) * W, H); g.stroke(); } g.fillStyle = '#9cf'; XY_RATES.forEach((l, i) => g.fillText(l, (i / 5) * W + 6, H - 8)); g.fillStyle = '#888'; g.fillText('↑ How far it opens', 6, 16); g.textAlign = 'right'; g.fillText('LFO rate →', W - 6, 16); g.textAlign = 'left'; }
  else if (m === 2) { for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((i / 4) * W, 0); g.lineTo((i / 4) * W, H); g.stroke(); g.beginPath(); g.moveTo(0, (i / 4) * H); g.lineTo(W, (i / 4) * H); g.stroke(); } g.fillStyle = '#888'; g.fillText('Filter opening → (left closed, right open)', 6, H - 8); g.fillText('↑ Resonance', 6, 16); }
  else if (m === 4) { for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo((i / 5) * W, 0); g.lineTo((i / 5) * W, H); g.stroke(); } g.fillStyle = '#9cf'; XY_RATES.forEach((l, i) => g.fillText(l, (i / 5) * W + 6, H - 8)); g.fillStyle = '#888'; g.fillText(S.xyFlip ? '↑ Filter position (flipped: higher = more closed, less resonance)' : '↑ Filter position (higher = more open, more resonance)', 6, 16); g.textAlign = 'right'; g.fillText('LFO rate →', W - 6, 34); g.textAlign = 'left'; }
  else if (m === 3) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, H - 22, W, 22); g.fillRect(0, 0, W, 22); g.fillStyle = '#ddd'; g.fillText('← → where on the photo path (open + resonance)', 6, H - 7); g.fillText('↑ ↓ which band of the wave (top → bottom)', 6, 15); }
  else { g.fillStyle = '#777'; g.fillText('Pad off — the usual wobble LFO runs', 12, H / 2); }
  if (m) { const x = pad.x * W, y = (1 - pad.y) * H; g.fillStyle = pad.act ? '#f0b44c' : 'rgba(240,180,76,.35)'; g.beginPath(); g.arc(x, y, pad.act ? 14 : 9, 0, 2 * Math.PI); g.fill();
    const info = m === 4 ? `速さ ${XY_RATES[Math.min(4, Math.floor(pad.x * 5))]}・位置 ${Math.round(padY() * 100)}%(その周りで揺れる${S.xyFlip ? '・縦は反転中' : ''})` : m === 1 ? `速さ ${XY_RATES[Math.min(4, Math.floor(pad.x * 5))]}・開き ${Math.round(300 * Math.pow(8000 / 300, pad.y))}Hzまで` : m === 2 ? `開き ${Math.round(pad.x * 100)}%・クセ ${Math.round(pad.y * 100)}%` : `道筋 ${Math.round(pad.x * 100)}%・波形 ${Math.floor((1 - pad.y) * 15.99) + 1}段目`;
    $('.js-xyinfo').textContent = (pad.act ? '操作中: ' : '指を離しています: ') + info; }
  else $('.js-xyinfo').textContent = '';
}
{
  const cv = $('.js-xy'), pos = (e) => { const r = cv.getBoundingClientRect(); pad.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); pad.y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)); };
  cv.addEventListener('pointerdown', async (e) => { if (!S.xyMode) return; try { cv.setPointerCapture(e.pointerId); } catch {} pos(e); pad.act = 1; await ensureCtx(); sendXY(); });
  cv.addEventListener('pointermove', (e) => { if (!pad.act || !S.xyMode) return; pos(e); sendXY(); });
  const up = () => { if (!pad.act) return; if (!S.xyHold) pad.act = 0; sendXY(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  $$('[data-xy]').forEach((b) => b.addEventListener('click', () => { S.xyMode = +b.dataset.xy; $$('[data-xy]').forEach((x) => x.classList.toggle('is-on', x === b)); document.querySelector('.js-xyflip').hidden = S.xyMode !== 4; pad.act = 0; sendParams(); sendXY(); }));
  $$('[data-xyhold]').forEach((b) => b.addEventListener('click', () => { S.xyHold = +b.dataset.xyhold; $$('[data-xyhold]').forEach((x) => x.classList.toggle('is-on', x === b)); if (!S.xyHold) { pad.act = 0; sendXY(); } }));
  $$('[data-xyflip]').forEach((b) => b.addEventListener('click', () => { S.xyFlip = +b.dataset.xyflip; $$('[data-xyflip]').forEach((x) => x.classList.toggle('is-on', x === b)); sendXY(); }));
  document.querySelector('[data-xyflip="0"]').classList.add('is-on');
  document.querySelector('[data-xy="0"]').classList.add('is-on'); document.querySelector('[data-xyhold="0"]').classList.add('is-on');
  drawPad();
}

/* ---------- Small windows in the panel: the photo-made waveform of each item ---------- */
const MINIS = [['.js-scope', '.js-m-core'], ['.js-gritcv', '.js-m-grit'], ['.js-wpath', '.js-m-wpath'], ['.js-shimcv', '.js-m-shim'], ['.js-attack', '.js-m-attack']];
setInterval(() => { for (const [a, b] of MINIS) { const s = document.querySelector(a), d = document.querySelector(b); if (s && d) { const g = d.getContext('2d'); g.drawImage(s, 0, 0, d.width, d.height); } } }, 200);

/* ---------- Scenes (11/20): photo + the area being read, recalled with one press ---------- */
// Shared with AIR: IndexedDB meta 'pixelScenes' = [{ pid, rect }] (both pages shrink photos the same way, longest side 480,
// so an area means the same place). Re-read before changing, so the other page's additions are kept.
let scenes = [];
const SC_KEY = 'pixelScenes';
const loadScenes = async () => { scenes = ((await DB.getMeta(SC_KEY).catch(() => null)) || []).filter((x) => x && x.pid); };
const saveScenes = () => DB.setMeta(SC_KEY, scenes.map(({ pid, rect, t }) => ({ pid, rect, t }))).catch(() => {});
function renderScenes() {
  const box = $('.js-scenes'); if (!box) return; box.innerHTML = '';
  scenes.forEach((sc, i) => {
    const p = photos.find((x) => x.pid === sc.pid); if (!p) return;
    const el = document.createElement('div'); el.className = 'pcard scard'; el.dataset.i = i; el.dataset.t = sc.t || '';
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240; cv.className = 'pcard__cv scard__cv';
    createImageBitmap(p.blob).then((bm) => { // only the area, as a square (shorter side of the area = 100%, centred)
      const cs = Math.min(1, 480 / Math.max(bm.width, bm.height)), k = 1 / cs; // area is in the 480-px canvas
      const r = sc.rect || { x0: 0, y0: 0, x1: bm.width * cs, y1: bm.height * cs };
      const w = r.x1 - r.x0, h = r.y1 - r.y0, side = Math.min(w, h), sx = r.x0 + (w - side) / 2, sy = r.y0 + (h - side) / 2;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bm, sx * k, sy * k, side * k, side * k, 0, 0, 240, 240);
    });
    const top = document.createElement('div'); top.className = 'pcard__top';
    const nm = document.createElement('span'); nm.textContent = `Scene ${String(i + 1).padStart(2, '0')}`;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pcard__btn'; del.textContent = '×'; del.title = 'このシーンを消す(AIR の一覧からも消えます)';
    del.addEventListener('click', async (e) => { e.stopPropagation(); const gone = scenes[i]; await loadScenes(); const j = scenes.findIndex((x) => x.pid === gone.pid && JSON.stringify(x.rect) === JSON.stringify(gone.rect)); if (j >= 0) scenes.splice(j, 1); saveScenes(); renderScenes(); });
    top.append(nm, del); el.append(cv, top);
    el.addEventListener('click', () => recallScene(i));
    box.append(el);
  });
  const msg = $('.js-scene-msg'); if (msg) msg.textContent = scenes.length ? '' : 'まだありません。写真と範囲を決めて Scene + で保存';
}
async function recallScene(i) {
  const sc = scenes[i]; if (!sc) return;
  const k = photos.findIndex((x) => x.pid === sc.pid); if (k < 0) return;
  if (k !== active) await selectPhoto(k);
  S.rect = sc.rect ? { ...sc.rect } : null; drawOverlay(); update(); savePhotoRect();
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === i));
}
window.__sceneOverwrite = async (i) => {
  const p = photos[active]; if (!p || !p.pid) return;
  await loadScenes(); if (!scenes[i]) return;
  scenes[i] = { ...scenes[i], pid: p.pid, rect: S.rect ? { ...S.rect } : null, t: Date.now() }; saveScenes(); renderScenes();
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === i));
};
$('.js-addscene')?.addEventListener('click', async () => {
  const p = photos[active];
  if (!p || !p.pid) { const msg = $('.js-scene-msg'); if (msg) msg.textContent = '見本の色相環はシーンにできません(写真を追加してください)'; return; }
  await loadScenes();
  scenes.push({ pid: p.pid, rect: S.rect ? { ...S.rect } : null, t: Date.now() });
  saveScenes(); renderScenes();
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === scenes.length - 1));
});

/* ---------- Start ---------- */
(async () => {
  photos = ((await DB.getMeta('pixelPhotos').catch(() => null)) || []).filter((p) => p.blob);
  await loadScenes(); renderScenes();
  addEventListener('focus', async () => { await loadScenes(); renderScenes(); }); // AIR may have added scenes in another tab
  if (photos.length) { await selectPhoto(0); }
  else { // no photo yet: a color wheel
    const c = document.createElement('canvas'); c.width = 480; c.height = 320; const g = c.getContext('2d');
    for (let x = 0; x < 480; x++) { const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, `hsl(${(x / 480) * 360},90%,80%)`); gr.addColorStop(1, `hsl(${(x / 480) * 360},90%,25%)`); g.fillStyle = gr; g.fillRect(x, 0, 1, 320); }
    useImage(c);
  }
  status(); drawSpec(); setPhotoOn(true); setMode(0);
})();
$$('[data-ab]').forEach((b) => b.addEventListener('click', () => setPhotoOn(b.dataset.ab === '1')));
window.__bs = { ensureCtx, pad, sendXY, setMode, startSeq, stopSeq, get seqOn() { return seqOn; }, set seqSel(v) { seqSel = v; }, get eq() { return eq; }, eqResponse, S, press, release, panic, setHold, useImage, get ch() { return ch; }, setPhotoOn, get photoOn() { return photoOn; }, get meas() { return meas; }, get an() { return an; }, get ctx() { return ctx; }, update };

/* ---------- Presets: save / load this page's sound settings by name ---------- */
presetBar($('.js-presets'), { page: 'bass' });
