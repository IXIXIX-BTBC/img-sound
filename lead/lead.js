// Techno lead page: photo -> row table -> real-time mono lead -> finishing rack (tube comp -> tape echo -> EQ) -> space
import { countRows, rowTable } from './rows.js?v=7';
import { presetBar } from '../js/presets.js?v=2';
import { finishRack } from '../js/finish.js?v=9';
import { getBpm, setBpm, onBpm } from '../js/tempo.js?v=1';
import { speakerOut } from '../js/out.js?v=4';
import { noteName, countPixels, rowWaves, buildTable } from '../pixel/pixels.js?v=23';
let waveRows = [];
import * as DB from '../js/store.js?v=6';
import { readableImages } from '../js/heic.js?v=2';
import { noteOrderUI } from '../js/note-order.js?v=3';
import * as V1 from './v1-analysis.js?v=3';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MUTE = new URLSearchParams(location.search).has('mute');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const imgCv = $('.js-img'), ovCv = $('.js-ov'), ictx = imgCv.getContext('2d', { willReadFrequently: true }), octx = ovCv.getContext('2d');

const S = {
  rowBase: 0.5, band: 2, smooth: 0.02, rowEnv: 0, rowD: 0.3, lfoAmt: 0, lfoDiv: 1, bpm: getBpm(),
  cutoff: 1200, res: 0.6, envAmt: 3, fD: 0.25, keyTrack: 0.5,
  glide: 0.06, legato: 1, A: 0.002, D: 0.25, S: 0.6, R: 0.12, accent: 0.5, drive: 1.5, clickAmt: 0, clickTone: 3000, clickLen: 0.006,
  red: 0, fine: 1, lo: 3, hi: 6, gamma: 2, thr: 0.08, max: 8, base: 0.6, harm: 'normal', harmAmt: 0.8, chord: 'major',
  rvb: 0.15,
  keyOct: 3, src: 'sine', nh: 12, fund: 0.3, fuse: 0, tdiff: 0.7, hLen: 0.5, hdev: 0.35, hstr: 0.2, bodyAmt: 0.8, bodyQ: 12, togAmt: 0, togRate: 4, sub: 0, poly: 0, voices: 8, vary: 1, shift: 0.03, filt: 0, mix: 0.5, conn: 0, ser: 0.5, uni: 7, detune: 22, width: 0.8, waveLv: 1, wblur: 0,
};
let ctx = null, ready = null, lead = null, gain = null, wetG = null, conv = null;
let photos = [], active = -1, img = null, rc = null, rcKey = '', table = null, liveRow = null, cntFull = null, waveTabs = null;

/* ---------- Audio ---------- */
function ensureCtx() {
  if (!ready) ready = (async () => {
    const c = new AudioContext();
    await c.audioWorklet.addModule('lead-worklet.js?v=18');
    lead = new AudioWorkletNode(c, 'lead-synth', { numberOfInputs: 0, outputChannelCount: [2] });
    gain = c.createGain(); gain.gain.value = +$('.js-volume').value;
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    conv = c.createConvolver(); conv.buffer = makeIR(c, 2.2); wetG = c.createGain();
    const fin = await rack.connect(c);
    lead.connect(gain).connect(fin.input);
    fin.output.connect(lim); fin.output.connect(conv).connect(wetG).connect(lim);
    lim.connect(await speakerOut(c, MUTE)); // last: the safety limiter (-1 dBFS), then the speakers
    lead.port.onmessage = ({ data }) => { liveRow = data.row; };
    ctx = c;
    sendParams(); sendTable(); sendWaves(); sendStack(); sendInst(); sendFx();
    $('.js-start').textContent = '音: ON'; $('.js-start').classList.add('is-on');
  })();
  return ready.then(async () => { if (ctx.state !== 'running') await ctx.resume(); });
}
function makeIR(c, sec) {
  const sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n; lp += (Math.random() * 2 - 1 - lp) * (0.2 + 0.7 * (1 - t)); d[i] = lp * Math.pow(1 - t, 2.4) * Math.min(1, i / (sr * 0.01)); } }
  return b;
}
const LEADP = ['hdev', 'hstr', 'sub', 'fuse', 'tdiff', 'hLen', 'bodyAmt', 'bodyQ', 'togAmt', 'togRate', 'poly', 'voices', 'filt', 'mix', 'conn', 'ser', 'uni', 'detune', 'width', 'waveLv', 'glide', 'legato', 'A', 'D', 'S', 'R', 'cutoff', 'res', 'envAmt', 'fD', 'keyTrack', 'rowBase', 'rowEnv', 'rowD', 'lfoAmt', 'smooth', 'base', 'drive', 'accent', 'clickAmt', 'clickTone', 'clickLen'];
function sendParams() { if (lead) lead.port.postMessage({ type: 'params', p: { ...Object.fromEntries(LEADP.map((k) => [k, S[k]])), lfoRate: (S.bpm / 60) * S.lfoDiv } }); }
function sendTable() { if (lead && table) lead.port.postMessage({ type: 'table', K: table.K, ratio: table.ratio, amp: table.amp, rows: table.rows }); }
function sendFx() {
  if (!ctx) return;
  wetG.gain.setTargetAtTime(S.rvb * 0.6, ctx.currentTime, 0.05);
}

/* ---------- Row table ---------- */
let rebuildT = 0;
function rebuild(recount) {
  clearTimeout(rebuildT);
  rebuildT = setTimeout(() => {
    if (!img) return;
    const key = `${active}|${S.fine}|${S.lo}|${S.hi}`;
    if (recount || key !== rcKey) { rc = countRows(img, { fine: S.fine, octLo: S.lo, octHi: S.hi }); rcKey = key; }
    table = rowTable(rc, { band: S.band, gamma: S.gamma, thr: S.thr, max: S.max, red: S.red, octLo: S.lo, harm: S.harm, harmAmt: S.harmAmt, chord: S.chord, perm: S.perm });
    sendTable(); buildWaves(); drawTable(); rowNotes();
  }, 60);
}
const hueCol = (h, l = 55) => `hsl(${h * 360},85%,${l}%)`;
function drawTable() { // rows (down) x components (across), brightness = strength
  const cv = $('.js-tab'), g = cv.getContext('2d'); if (!table) return;
  const K = Math.max(1, table.K), H = table.rows; cv.width = K * 6; cv.height = H;
  const im = g.createImageData(cv.width, H);
  for (let y = 0; y < H; y++) for (let k = 0; k < K; k++) {
    const a = Math.min(1, table.amp[y * table.K + k] * 1.6), hue = table.parts[k]?.hue ?? 0;
    const [r, gg, b] = hsl(hue, 0.85, 0.08 + 0.5 * a);
    for (let x = 0; x < 6; x++) { const i = (y * cv.width + k * 6 + x) * 4; im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = 255; }
  }
  g.putImageData(im, 0, 0);
}
function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; }
function rowNotes() {
  if (!table) return;
  const y = Math.round(S.rowBase * (table.rows - 1)), K = table.K;
  const list = table.parts.map((p, k) => ({ p, a: table.amp[y * K + k] })).filter((x) => x.a > 0.05).sort((a, b) => b.a - a.a).slice(0, 6);
  drawWaves();
  $('.js-rownotes').textContent = `基準の行(${Math.round(S.rowBase * 100)}%)のピーク: ` + (list.length ? list.map((x) => `${noteName(x.p.midi)}(${Math.round(x.a * 100)}%)`).join(' ') : 'なし(灰色の行=基音だけ)') + ` / 成分 ${K}本`;
}

/* ---------- Component material: sine, or the photo row's waveform (same as the ambient page) ---------- */
// Each component reads the row near the current row position where its own color is most common: the photo is cut into
// WP horizontal bands (each band = its row +- WIN rows); per band, every component takes the row inside that band where its
// color is most common, its brightness = one cycle, smoothed to nh harmonics (fewer up high so nothing aliases even two
// octaves up) and mixed with a sine (fund) to keep the pitch. The synth crossfades between the two nearest bands.
const TAB = 2048, WP = 16;
function buildWaves() {
  if (S.src !== 'row' || !table || !img) { waveTabs = null; sendWaves(); drawWaves(); return; }
  if (!cntFull || cntFull.key !== rcKey + '|' + S.red) { cntFull = countPixels(img, { fine: S.fine, redNote: S.red, octLo: S.lo, octHi: S.hi }); cntFull.key = rcKey + '|' + S.red; }
  const K = table.K, h = img.height, win = Math.max(2, Math.round(h / WP));
  waveTabs = new Float32Array(WP * K * (TAB + 1)); waveRows = [];
  for (let p = 0; p < WP; p++) {
    const yc = Math.round((p / (WP - 1)) * (h - 1));
    const wv = rowWaves(img, cntFull, table.parts, { rect: { x0: 0, x1: img.width, y0: Math.max(0, yc - win), y1: Math.min(h, yc + win + 1) } });
    waveRows.push(table.parts.map((q) => q.waveRow));
    table.parts.forEach((q, k) => {
      const fTop = 1046.5 * table.ratio[k] * 2; // highest key we expect (C6) one octave of headroom
      const nh = Math.max(1, Math.min(S.nh, Math.floor(20000 / fTop)));
      waveTabs.set(buildTable(wv[k], nh, TAB, S.fund), (p * K + k) * (TAB + 1));
    });
  }
  sendWaves(); drawWaves();
}
function sendWaves() { if (lead) lead.port.postMessage({ type: 'waves', tabs: waveTabs, TAB, P: WP, K: table ? table.K : 0 }); }
function drawWaves() {
  const box = $('.js-ldwaves'); box.hidden = !waveTabs; if (!waveTabs) return;
  const cv = $('.js-ldwavecv'), g = cv.getContext('2d'), W = cv.width, H = cv.height, cw = W / 6, K = table.K;
  const y = Math.round(S.rowBase * (table.rows - 1)), p = Math.round(S.rowBase * (WP - 1));
  const list = [...Array(K).keys()].filter((k) => table.amp[y * K + k] > 0.05).sort((a, b) => table.amp[y * K + b] - table.amp[y * K + a]).slice(0, 6);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  list.forEach((k, i) => {
    const o = (p * K + k) * (TAB + 1), x0 = i * cw;
    g.beginPath();
    for (let i = 0; i <= 256; i++) { const x = x0 + 6 + (i / 256) * (cw - 12), y = H / 2 + 6 - waveTabs[o + Math.floor((i / 256) * TAB) % TAB] * (H / 2 - 16); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = hueCol(table.parts[k].hue, 60); g.lineWidth = 2; g.stroke();
    g.fillStyle = '#aaa'; g.font = '11px sans-serif'; g.fillText(`${noteName(table.parts[k].midi)}  ${Math.round(table.amp[y * K + k] * 100)}%`, x0 + 6, 12);
  });
  if (!list.length) { g.fillStyle = '#777'; g.font = '12px sans-serif'; g.fillText('この行は色の成分なし(灰色)', 10, 20); }
}

/* ---------- Row-waveform layer (v1 method): 64 rows top->bottom, each = one band-limited cycle ---------- */
let stack = null, stackT = 0;
function buildStack() {
  clearTimeout(stackT);
  stackT = setTimeout(() => { if (!img) return; stack = V1.buildStack(V1.toChannels(img), { scan: 'row', mix: { r: 1, g: 1, b: 1 }, proportional: true, blur: S.wblur }); sendStack(); }, 30);
}
/* ---------- Instrument type: per row, the harmonic strengths of the row (one cycle) + brightness per harmonic ---------- */
// IF rows from top to bottom (same spacing as the stack). H[f][h] = strength of harmonic h (1..IH) of the row's brightness
// read left->right as one cycle (peak 1). Bh[f][h] = mean brightness of the h-th of IH equal pieces of that row: the synth
// turns it into that harmonic's own timing (bright piece = starts at once and stays long, dark = late and short).
const IF = 64, IH = 48;
let inst = null;
function buildInst() {
  const { data, width: w, height: h } = img, N = 512, H = new Float32Array(IF * (IH + 1)), Bh = new Float32Array(IF * (IH + 1)), Dh = new Float32Array(IF * (IH + 1)), G = new Float32Array(IF * 128);
  const lum = (x, y) => { const i = (y * w + x) * 4; return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; };
  const cs = Float32Array.from({ length: N }, (_, i) => Math.cos((2 * Math.PI * i) / N)), sn = Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / N));
  for (let f = 0; f < IF; f++) {
    const y = Math.round((f / (IF - 1)) * (h - 1)), row = new Float32Array(N);
    for (let i = 0; i < N; i++) { const fx = (i / N) * (w - 1), x0 = fx | 0, x1 = Math.min(w - 1, x0 + 1), t = fx - x0; row[i] = lum(x0, y) * (1 - t) + lum(x1, y) * t; }
    let mx = 0;
    for (let k = 1; k <= IH; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const j = (k * i) % N; re += row[i] * cs[j]; im += row[i] * sn[j]; } const a = Math.hypot(re, im); H[f * (IH + 1) + k] = a; mx = Math.max(mx, a); }
    for (let k = 1; k <= IH; k++) {
      H[f * (IH + 1) + k] /= mx || 1;
      const a = Math.floor(((k - 1) / IH) * w), b = Math.max(a + 1, Math.floor((k / IH) * w)); let s = 0, R = 0, Gg = 0, Bb = 0;
      for (let x = a; x < b; x++) { s += lum(x, y); const i = (y * w + x) * 4; R += data[i]; Gg += data[i + 1]; Bb += data[i + 2]; }
      Bh[f * (IH + 1) + k] = s / (b - a);
      // pitch offset of this harmonic: the piece's color. hue -> direction (sin of the hue angle), chroma -> how far; gray = none
      const n = (b - a) * 255, r = R / n, g2 = Gg / n, bl = Bb / n, mxc = Math.max(r, g2, bl), mnc = Math.min(r, g2, bl), c = mxc - mnc;
      let hue = 0; if (c > 1e-3) { hue = mxc === r ? ((g2 - bl) / c) % 6 : mxc === g2 ? (bl - r) / c + 2 : (r - g2) / c + 4; hue = (((hue / 6) % 1) + 1) % 1; }
      Dh[f * (IH + 1) + k] = k === 1 ? 0 : Math.sin(2 * Math.PI * hue) * Math.min(1, c * 1.5); // the played pitch itself never moves
    }
    // move-together wobble: the same row's brightness, 128 points, smoothed a little, zero mean, peak 1
    const g = Float32Array.from({ length: 128 }, (_, i) => row[Math.floor((i / 128) * N)]), sm = new Float32Array(128);
    for (let i = 0; i < 128; i++) { let s = 0; for (let d = -3; d <= 3; d++) s += g[(i + d + 128) & 127]; sm[i] = s / 7; }
    const mean = sm.reduce((s, v) => s + v, 0) / 128; let pk = 0; for (let i = 0; i < 128; i++) { sm[i] -= mean; pk = Math.max(pk, Math.abs(sm[i])); }
    for (let i = 0; i < 128; i++) G[f * 128 + i] = sm[i] / (pk || 1);
  }
  inst = { H, Bh, Dh, G, frames: IF, IH }; sendInst();
}
function sendInst() { if (lead && inst) lead.port.postMessage({ type: 'inst', ...inst }); }
function sendStack() { if (lead && stack) lead.port.postMessage({ type: 'stack', data: stack.data, frames: stack.frames, levels: stack.levels, N: V1.N }); }

/* ---------- Drawing ---------- */
function drawOverlay() {
  const w = ovCv.width, h = ovCv.height;
  octx.clearRect(0, 0, w, h);
  if (!img) { requestAnimationFrame(drawOverlay); return; }
  const by = S.rowBase * (h - 1), bh = Math.max(1, S.band * 2 + 1);
  octx.fillStyle = 'rgba(255,255,255,.9)'; octx.fillRect(0, by, w, 1);
  if (liveRow != null) { const y = liveRow * (h - 1); octx.fillStyle = 'rgba(110,220,255,.35)'; octx.fillRect(0, y - bh / 2, w, bh); octx.fillStyle = 'rgba(110,220,255,.95)'; octx.fillRect(0, y, w, 1); }
  requestAnimationFrame(drawOverlay);
}

/* ---------- Photos (shared list with the ambient page) ---------- */
function useImage(srcImg) {
  const sc = Math.min(1, 480 / Math.max(srcImg.width, srcImg.height));
  const w = Math.max(1, Math.round(srcImg.width * sc)), h = Math.max(1, Math.round(srcImg.height * sc));
  imgCv.width = ovCv.width = w; imgCv.height = ovCv.height = h;
  ictx.drawImage(srcImg, 0, 0, w, h); img = ictx.getImageData(0, 0, w, h);
  buildStack(); buildInst();
  requestAnimationFrame(() => { $('.js-tab').style.height = imgCv.clientHeight + 'px'; }); // rows line up with the photo
  rebuild(true);
}
async function selectPhoto(i) { const p = photos[i]; if (!p) return; active = i; useImage(await createImageBitmap(p.blob)); renderCards(); }
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
async function addFiles(files) {
  files = await readableImages(files); // HEIC -> JPEG
  const list = (await DB.getMeta('pixelPhotos').catch(() => null)) || [];
  let pid = list.reduce((m, p) => Math.max(m, p.pid || 0), 0);
  for (const f of files) if (f && f.type.startsWith('image/')) list.push({ blob: f, name: f.name.replace(/\.[^.]+$/, '').slice(0, 24), rect: null, pid: ++pid });
  await DB.setMeta('pixelPhotos', list).catch(() => {});
  photos = list; selectPhoto(photos.length - 1);
}
$('.js-file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
const drop = $('.js-drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-drag'); addFiles([...e.dataTransfer.files]); });
// click / drag on the photo = base row
let dragging = false;
const setRowFromEvent = (e) => { const r = ovCv.getBoundingClientRect(); setKnob('rowBase', Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); };
ovCv.addEventListener('pointerdown', (e) => { dragging = true; try { ovCv.setPointerCapture(e.pointerId); } catch {} setRowFromEvent(e); });
ovCv.addEventListener('pointermove', (e) => { if (dragging) setRowFromEvent(e); });
ovCv.addEventListener('pointerup', () => (dragging = false));

/* ---------- Keyboard / MIDI ---------- */
const KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
const down = new Map(); // key id -> midi (only keys still physically down)
// "Slightly different every time" (same as the ambient page): each press reads the row nudged up/down a little.
// Presses use nudges #1..#7, every 8th press goes back to #0 (the original row); each round gets new nudges.
let pressN = 0, nudges = [];
function nextNudge() {
  if (!S.vary) { $('.js-vary-now').textContent = ''; return 0; }
  const idx = pressN++ % 8;
  if (idx === 0) nudges = [0, ...Array.from({ length: 7 }, () => (Math.random() * 2 - 1) * S.shift)];
  $('.js-vary-now').textContent = idx === 0 ? '今: 元の位置' : `今: ずらし ${idx} / 7(${nudges[idx] > 0 ? '下へ' : '上へ'}${Math.abs(Math.round(nudges[idx] * 1000) / 10)}%)`;
  return nudges[idx];
}
async function press(id, midi, vel) {
  down.set(id, midi); status();
  await ensureCtx();
  if (down.get(id) === midi) lead.port.postMessage({ type: 'noteOn', midi, vel, nudge: nextNudge() }); // still held after the audio started
}
function release(id) { const m = down.get(id); if (m == null) return; down.delete(id); status(); if (lead) lead.port.postMessage({ type: 'noteOff', midi: m }); }
function panic() { down.clear(); status(); if (lead) lead.port.postMessage({ type: 'allOff' }); }
function status() { $('.js-status').textContent = down.size ? '♪ ' + [...down.values()].map((m) => NAMES[m % 12] + (Math.floor(m / 12) - 1)).join(' ') : ''; }
function setKeyOct(o) { S.keyOct = Math.min(6, Math.max(1, o)); $('.js-koct').textContent = 'C' + S.keyOct; }
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { panic(); return; }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.target.matches && e.target.matches('input, select'))) return;
  if (e.code === 'KeyZ' || e.code === 'KeyX') { setKeyOct(S.keyOct + (e.code === 'KeyX' ? 1 : -1)); return; }
  if (!(e.code in KEYS)) return;
  e.preventDefault(); press('k' + e.code, 12 * (S.keyOct + 1) + KEYS[e.code], e.shiftKey ? 1 : 0.7);
});
window.addEventListener('keyup', (e) => release('k' + e.code));
window.addEventListener('blur', panic);
$('.js-panic').addEventListener('click', panic);
$('.js-midi').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) { $('.js-midi').textContent = 'MIDI 非対応'; return; }
  try { const acc = await navigator.requestMIDIAccess(); const bind = () => { for (const inp of acc.inputs.values()) inp.onmidimessage = onMidi; $('.js-midi').textContent = `MIDI: ${acc.inputs.size}台`; }; acc.onstatechange = bind; bind(); } catch { $('.js-midi').textContent = 'MIDI 不可'; }
});
function onMidi({ data: [st, n, v] }) { const t = st & 0xf0; if (t === 0x90 && v > 0) press('m' + n, n, v / 127); else if (t === 0x80 || (t === 0x90 && v === 0)) release('m' + n); }

/* ---------- Finishing rack (shared with the other pages): off by default here ---------- */
const rack = finishRack($('.js-finish'), { defaults: { tcOn: 0, teOn: 0, tcIn: 1.2, tcThresh: 0.4, tcRel: 0.3, teInt: 0.35, teEcho: 0.35, teWow: 0.2, teAge: 0.25 } });

/* ---------- Controls ---------- */
const sec = (v) => (v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms');
const pct = (v) => Math.round(v * 100) + '%';
const KNOBS = {
  rowBase: ['.js-rowbase', pct, 'lead'], band: ['.js-band', (v) => `±${v}行`, 'table'], smooth: ['.js-smooth', sec, 'lead'], shift: ['.js-shift', (v) => '±' + (Math.round(v * 1000) / 10) + '%', 'none'],
  rowEnv: ['.js-rowenv', (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%', 'lead'], rowD: ['.js-rowd', sec, 'lead'], lfoAmt: ['.js-lfoamt', pct, 'lead'], bpm: ['.js-bpm', (v) => v, 'lead'],
  cutoff: ['.js-cutoff', (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) + 'Hz', 'lead'], res: ['.js-res', pct, 'lead'], envAmt: ['.js-envamt', (v) => '+' + v.toFixed(1) + 'oct', 'lead'], fD: ['.js-fd', sec, 'lead'], keyTrack: ['.js-keytrack', pct, 'lead'],
  glide: ['.js-glide', sec, 'lead'], A: ['.js-a', sec, 'lead'], D: ['.js-d', sec, 'lead'], S: ['.js-s', pct, 'lead'], R: ['.js-r', sec, 'lead'], accent: ['.js-accent', pct, 'lead'], drive: ['.js-drive', (v) => '×' + v.toFixed(1), 'lead'],
  clickAmt: ['.js-clickamt', pct, 'lead'], clickTone: ['.js-clicktone', (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) + 'Hz', 'lead'], clickLen: ['.js-clicklen', (v) => (v * 1000).toFixed(1) + 'ms', 'lead'],
  lo: ['.js-lo', (v) => 'C' + v, 'table'], hi: ['.js-hi', (v) => 'C' + v, 'table'], gamma: ['.js-gamma', (v) => v.toFixed(2), 'table'], thr: ['.js-thr', pct, 'table'], max: ['.js-max', (v) => v + '本', 'table'], base: ['.js-base', pct, 'lead'], harmAmt: ['.js-harmamt', pct, 'table'],
  mix: ['.js-mix', (v) => `色→音階 ${Math.round((1 - v) * 100)} : 行の波形 ${Math.round(v * 100)}`, 'lead'], uni: ['.js-uni', (v) => v + '本', 'lead'], detune: ['.js-detune', (v) => '±' + Math.round(v) + 'c', 'lead'],
  ser: ['.js-ser', pct, 'lead'], tdiff: ['.js-tdiff', pct, 'lead'], hdev: ['.js-hdev', (v) => '±' + Math.round(v * 60) + 'c', 'lead'], hstr: ['.js-hstr', pct, 'lead'], hLen: ['.js-hlen', sec, 'lead'], bodyAmt: ['.js-bodyamt', pct, 'lead'], bodyQ: ['.js-bodyq', (v) => 'Q ' + Math.round(v), 'lead'], togAmt: ['.js-togamt', pct, 'lead'], sub: ['.js-sub', pct, 'lead'], togRate: ['.js-tograte', (v) => v.toFixed(1) + '回/秒', 'lead'], width: ['.js-width', pct, 'lead'], waveLv: ['.js-wavelv', pct, 'lead'], wblur: ['.js-wblur', (v) => v, 'stack'],
  nh: ['.js-nh', (v) => v + '本', 'waves'], fund: ['.js-fund', pct, 'waves'],
  rvb: ['.js-rvb', pct, 'fx'],
};
let wavesT = 0;
function apply(kind) { if (kind === 'lead') sendParams(); else if (kind === 'table') rebuild(); else if (kind === 'stack') buildStack(); else if (kind === 'none') pressN = 0; else if (kind === 'waves') { clearTimeout(wavesT); wavesT = setTimeout(buildWaves, 60); } else sendFx(); }
function setKnob(k, v) { S[k] = v; const [sel, fmt, kind] = KNOBS[k]; $(sel).value = v; $(sel + '-v').textContent = fmt(v); apply(kind); if (k === 'rowBase') rowNotes(); }
for (const [k, [sel, fmt, kind]] of Object.entries(KNOBS)) {
  const el = $(sel); if (!el) continue; // (beta.html has no click knobs)
  el.value = S[k]; $(sel + '-v').textContent = fmt(S[k]);
  el.addEventListener('input', () => { S[k] = +el.value; if (k === 'lo' && S.hi <= S.lo) setKnob('hi', S.lo + 1); if (k === 'hi' && S.hi <= S.lo) setKnob('lo', S.hi - 1); $(sel + '-v').textContent = fmt(S[k]); apply(kind); if (k === 'rowBase') rowNotes(); });
}
// Color -> note order (default / random / saved), shared component with the ambient page
S.perm = null;
// photo reading (red = which note, color -> note order): shared by every mode, lives in the left column
noteOrderUI($('.js-noteorder'), { oldKey: 'leadPerm', onChange: (red, p) => { S.red = red; S.perm = p; rebuild(); } });
$('.js-fine').addEventListener('change', (e) => { S.fine = +e.target.value; rebuild(true); });
$('.js-conn').addEventListener('change', (e) => { S.conn = +e.target.value; sendParams(); });
$('.js-lfodiv').addEventListener('change', (e) => { S.lfoDiv = +e.target.value; sendParams(); });
$('.js-chord').addEventListener('change', (e) => { S.chord = e.target.value; rebuild(); });
const tabs = (attr, key, after, conv = (v) => v) => {
  const set = (v) => { S[key] = conv(v); $$(`[data-${attr}]`).forEach((b) => b.classList.toggle('is-on', b.dataset[attr] === String(v))); after(); };
  $$(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => set(b.dataset[attr])));
  return set;
};
tabs('legato', 'legato', sendParams, Number)('1');
// Sound type: separate (color components = their own pitches) / one lump (components moved onto the played note's harmonics,
// one filter for everything). Each type keeps its own unison settings (one lump starts narrow: 3 copies, +-8 cents).
// Instrument starts with a small filter sweep (its harmonics already have their own timing).
const uniBy = { 0: { uni: S.uni, detune: S.detune, envAmt: S.envAmt, togAmt: S.togAmt, sub: S.sub }, 2: { uni: 5, detune: 12, envAmt: 1, togAmt: 0.35, sub: 0.4 } }; // instrument: moves together from the start (B)
let fuseNow = 0;
tabs('fuse', 'fuse', () => {
  if (S.fuse !== fuseNow) { uniBy[fuseNow] = { uni: S.uni, detune: S.detune, envAmt: S.envAmt, togAmt: S.togAmt, sub: S.sub }; fuseNow = S.fuse; for (const k of ['uni', 'detune', 'envAmt', 'togAmt', 'sub']) setKnob(k, uniBy[fuseNow][k]); }
  $$('[data-fuse2]').forEach((el) => (el.hidden = S.fuse !== 2)); $$('[data-notfuse2]').forEach((el) => (el.hidden = S.fuse === 2)); sendParams();
}, Number)('0');
tabs('poly', 'poly', () => { $$('[data-polyopt]').forEach((el) => (el.hidden = !S.poly)); $$('[data-monoopt]').forEach((el) => (el.hidden = !!S.poly)); sendParams(); }, Number)('0');
$('.js-voices').addEventListener('change', (e) => { S.voices = +e.target.value; sendParams(); });
tabs('src', 'src', () => { $$('[data-srcopt]').forEach((el) => (el.hidden = S.src !== 'row')); buildWaves(); })('sine');
const setHarm = tabs('harm', 'harm', () => { $$('[data-harmopt]').forEach((el) => (el.hidden = S.harm === 'normal')); $$('[data-chordopt]').forEach((el) => (el.hidden = S.harm !== 'consonant')); rebuild(); });
setHarm('normal');
tabs('vary', 'vary', () => { $$('[data-varyopt]').forEach((el) => (el.hidden = !S.vary)); pressN = 0; }, Number)('1');
tabs('filt', 'filt', () => { $$('[data-filtopt]').forEach((el) => (el.hidden = !S.filt)); sendParams(); }, Number)('0');
// shared tempo (every page uses the same BPM): moving it here moves it everywhere, and another page's change arrives here
$('.js-bpm').addEventListener('input', () => setBpm(S.bpm));
onBpm((v) => { if (S.bpm === v) return; const el = $('.js-bpm'); el.value = v; el.dispatchEvent(new Event('input')); });
$('.js-start').addEventListener('click', () => ensureCtx());
$('.js-volume').addEventListener('input', (e) => gain && gain.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.02));
/* ---------- Scenes (11/20): photo + the row being read (position and width), recalled with one press ---------- */
// Kept in IndexedDB meta 'leadScenes' (Bolt's own list; AIR's scenes hold a range instead of a row).
let scenes = [];
const saveScenes = () => DB.setMeta('leadScenes', scenes).catch(() => {});
function renderScenes() {
  const box = $('.js-scenes'); if (!box) return; box.innerHTML = '';
  scenes.forEach((sc, i) => {
    const p = photos.find((x) => x.pid === sc.pid); if (!p) return;
    const el = document.createElement('div'); el.className = 'pcard scard'; el.dataset.i = i; el.dataset.t = sc.t || '';
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 107; cv.className = 'pcard__cv scard__cv';
    createImageBitmap(p.blob).then((bm) => {
      const g = cv.getContext('2d'), k = Math.min(160 / bm.width, 107 / bm.height), w = bm.width * k, h = bm.height * k, ox = (160 - w) / 2, oy = (107 - h) / 2;
      g.fillStyle = '#000'; g.fillRect(0, 0, 160, 107); g.drawImage(bm, ox, oy, w, h);
      g.fillStyle = '#ff9d00'; g.fillRect(ox, oy + sc.rowBase * h - 1, w, 2); // the row
    });
    const top = document.createElement('div'); top.className = 'pcard__top';
    const nm = document.createElement('span'); nm.textContent = sc.name || `Scene ${String(i + 1).padStart(2, '0')}`;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'pcard__btn'; del.textContent = '×'; del.title = 'このシーンを消す';
    del.addEventListener('click', (e) => { e.stopPropagation(); scenes.splice(i, 1); saveScenes(); renderScenes(); });
    top.append(nm, del); el.append(cv, top);
    el.addEventListener('click', () => recallScene(i));
    box.append(el);
  });
  const msg = $('.js-scene-msg'); if (msg) msg.textContent = scenes.length ? '' : 'まだありません。写真と行を決めて Scene + で保存';
}
async function recallScene(i) {
  const sc = scenes[i]; if (!sc) return;
  const k = photos.findIndex((x) => x.pid === sc.pid); if (k < 0) return;
  if (k !== active) await selectPhoto(k);
  for (const [sel, v] of [['.js-rowbase', sc.rowBase], ['.js-band', sc.band]]) { const el = $(sel); if (el && v != null) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === i));
}
window.__sceneOverwrite = async (i) => {
  const p = photos[active]; if (!p || !p.pid || !scenes[i]) return;
  scenes[i] = { ...scenes[i], pid: p.pid, rowBase: +$('.js-rowbase').value, band: +$('.js-band').value, t: Date.now() }; saveScenes(); renderScenes();
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === i));
};
$('.js-addscene')?.addEventListener('click', () => {
  const p = photos[active];
  if (!p || !p.pid) { const msg = $('.js-scene-msg'); if (msg) msg.textContent = '見本の色相環はシーンにできません(写真を追加してください)'; return; }
  let n = scenes.length + 1; while (scenes.some((x) => x.name === `Scene ${String(n).padStart(2, '0')}`)) n++;
  scenes.push({ pid: p.pid, rowBase: +$('.js-rowbase').value, band: +$('.js-band').value, t: Date.now(), name: `Scene ${String(n).padStart(2, '0')}` });
  saveScenes(); renderScenes();
  $$('.js-scenes .scard').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === scenes.length - 1));
});

setKeyOct(S.keyOct);

/* ---------- Start ---------- */
(async () => {
  photos = ((await DB.getMeta('pixelPhotos').catch(() => null)) || []).filter((p) => p.blob);
  scenes = ((await DB.getMeta('leadScenes').catch(() => null)) || []).filter((x) => x && x.pid); renderScenes();
  if (photos.length) { await selectPhoto(0); return; }
  const last = await DB.getLast().catch(() => null);
  if (last) { photos = [{ blob: last, name: '写真シンセの最後の画像', rect: null, pid: 1 }]; await selectPhoto(0); }
  else { // no photo yet: a color wheel
    const c = document.createElement('canvas'); c.width = 480; c.height = 320; const g = c.getContext('2d');
    for (let x = 0; x < 480; x++) { const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, `hsl(${(x / 480) * 360},90%,80%)`); gr.addColorStop(1, `hsl(${(x / 480) * 360},90%,25%)`); g.fillStyle = gr; g.fillRect(x, 0, 1, 320); }
    useImage(c);
  }
})();
requestAnimationFrame(drawOverlay);

window.__ld = { S, press, release, panic, ensureCtx, get table() { return table; }, get lead() { return lead; }, get ctx() { return ctx; }, get gain() { return gain; }, useImage, get liveRow() { return liveRow; } };

/* ---------- Presets: save / load this page's sound settings by name ---------- */
presetBar($('.js-presets'), { page: 'lead' });
