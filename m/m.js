// IMG SOUND — the phone screen. Few controls; each moves several settings of the mode page behind it (not shown).
// The sound itself comes from the mode pages (pixel/ = AIR, lead/ = Bolt, bass/ = Quake), loaded unseen in frames:
// a photo goes into the page's own photo input, the keys call its note functions, the controls set its sliders.
// Centre of every knob = the mode's Basic sound (js/default-sounds.js), which the pages load on start.
import { DEFAULT_SOUNDS } from '../js/default-sounds.js?v=5';
import { readableImages } from '../js/heic.js?v=2';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODES = {
  AIR: { page: 'pixel', api: '__px', adsr: ['.js-a', '.js-d', '.js-s', '.js-release'],
    on: (a, id, m, v) => a.noteOn(id, m, v), off: (a, id) => a.noteOff(id),
    knobs: [
      ['Bright', [['.js-nh', 0.35], ['.js-fund', -0.4], ['.js-dist', -0.3], ['.js-gamma', -0.15]]],
      ['Drift', [['.js-wobcents', 0.5], ['.js-wobampd', 0.4], ['.js-spread', 0.4], ['.js-shift', 0.25]], { tab: ['[data-wob="1"]', '[data-wob="0"]'], above: 0.53 }],
      ['Breath', [['.js-noise', 0.5], ['.js-nwidth', 0.3], ['[data-k="teAge"]', 0.5]]],
      ['Space', [['.js-rvb', 0.5], ['.js-room', 0.35], ['[data-k="teEcho"]', 0.4], ['[data-k="teInt"]', 0.3]]],
    ] },
  Bolt: { page: 'lead', api: '__ld', adsr: ['.js-a', '.js-d', '.js-s', '.js-r'],
    on: (a, id, m, v) => a.press(id, m, v), off: (a, id) => a.release(id),
    knobs: [
      ['Bright', [['.js-cutoff', 0.6, 'log'], ['.js-envamt', 0.3], ['.js-res', 0.2]]],
      ['Move', [['.js-lfoamt', 0.5], ['.js-togamt', 0.4], ['.js-detune', 0.3], ['.js-glide', 0.3]]],
      ['Bite', [['.js-drive', 0.4], ['.js-accent', 0.4], ['.js-clickamt', 0.4], ['.js-sub', -0.2]]],
      ['Space', [['.js-rvb', 0.5], ['[data-k="teEcho"]', 0.4], ['[data-k="teInt"]', 0.3], ['.js-width', 0.4]], { tab: ['[data-te="1"]', '[data-te="0"]'], above: 0.55 }],
    ] },
  Quake: { page: 'bass', api: '__bs', adsr: ['.js-a', '.js-d', '.js-s', '.js-r'],
    on: (a, id, m) => a.press(id, m), off: (a, id) => a.release(id),
    knobs: [
      ['Bright', [['.js-bf', 0.6, 'log'], ['.js-gtone', 0.4, 'log'], ['.js-pamt', 0.3]]],
      ['Wobble', [['.js-wamt', 0.5], ['.js-wres', 0.4], ['.js-wphoto', 0.3]]],
      ['Grit', [['.js-gamt', 0.5], ['.js-gdrive', 0.5], ['.js-noiseamt', 0.3], ['.js-sublv', -0.2]]],
      ['Space', [['[data-k="teEcho"]', 0.4], ['[data-k="teInt"]', 0.3], ['[data-k="teWidth"]', 0.4]], { tab: ['[data-te="1"]', '[data-te="0"]'], above: 0.55 }],
    ] },
};
const KEY = 'photoSynth.m';
const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
st.mode ||= 'AIR'; st.oct ??= 4; st.knobs ||= {}; st.env ||= {}; st.area ??= null; st.row ??= null; // row: Bolt's row (0 top .. 1 bottom; none = its Basic)
const usesRow = (m) => m === 'Bolt';
const save = () => localStorage.setItem(KEY, JSON.stringify(st));
const knobsOf = (m) => (st.knobs[m] ||= [0.5, 0.5, 0.5, 0.5]);

/* ---------- the mode pages (unseen) ---------- */
const eng = {}; let photoFile = null, photoVer = 0;
function frameFor(mode) {
  if (eng[mode]) return eng[mode];
  const q = new URLSearchParams(location.search); q.set('m', '1');
  const f = document.createElement('iframe'); f.src = `../${MODES[mode].page}/?${q}`; f.allow = 'autoplay; midi'; f.tabIndex = -1;
  $('.js-engines').append(f);
  const e = (eng[mode] = { f, api: null, base: {}, photoVer: 0, ready: null });
  e.ready = (async () => { // the page's screen is built and its Basic sound applied
    for (let k = 0; k < 300; k++) { const w = f.contentWindow, d = f.contentDocument; if (w && w[MODES[mode].api] && d?.body?.classList.contains('ui-on') && w.__soundReady) break; await sleep(50); } // its Basic sound in place
    await sleep(100);
    e.api = f.contentWindow[MODES[mode].api]; e.doc = f.contentDocument;
    readBase(mode, e);
    applyAll(mode);
    e.ok = true; drawReady();
    return e;
  })();
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} }; // follow this finger (fails quietly when the pointer is already gone)
// the Basic value of a control: from the default sound, else what the page shows at start
function readBase(mode, e) {
  const D = DEFAULT_SOUNDS[MODES[mode].page]?.v || {};
  const sels = [...MODES[mode].knobs.flatMap(([, t]) => t.map(([s]) => s)), ...MODES[mode].adsr];
  for (const s of sels) { const el = e.doc.querySelector(s); if (!el) continue; const v = D[s + '#0'] ?? el.value; e.base[s] = +v; }
  const tabs = MODES[mode].knobs.map(([, , o]) => o?.tab).filter(Boolean);
  for (const [onSel, offSel] of tabs) e.base[onSel] = !!e.doc.querySelector(onSel)?.classList.contains('is-on');
}
function setControl(e, sel, v) {
  const el = e.doc.querySelector(sel); if (!el) return;
  const old = el.value; el.value = String(v); if (el.value === old) return;
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}
function knobTargets(mode, i, k, e) { // knob 0..1 (0.5 = Basic) -> each setting it moves
  const [, targets, opt] = MODES[mode].knobs[i], d = (k - 0.5) * 2;
  for (const [sel, depth, curve] of targets) {
    const el = e.doc.querySelector(sel); if (!el || e.base[sel] == null) continue;
    const lo = +el.min, hi = +el.max, b = e.base[sel];
    const v = curve === 'log' && lo > 0 ? b * Math.pow(hi / lo, d * depth * 0.5) : b + d * depth * (hi - lo);
    setControl(e, sel, clamp(v, lo, hi));
  }
  if (opt?.tab) { const [onSel, offSel] = opt.tab, want = k > opt.above || e.base[onSel]; const b = e.doc.querySelector(want ? onSel : offSel); if (b && !b.classList.contains('is-on')) b.click(); }
}
// ADSR sliders 0..1: times on a log scale over the control's range, sustain straight
const envPos = (el, v, i) => (i === 2 ? (v - el.min) / (el.max - el.min) : Math.log(v / el.min) / Math.log(el.max / el.min));
const envVal = (el, p, i) => (i === 2 ? +el.min + p * (el.max - el.min) : el.min * Math.pow(el.max / el.min, p));
function envTargets(mode, e) {
  const env = st.env[mode]; if (!env) return;
  MODES[mode].adsr.forEach((sel, i) => { const el = e.doc.querySelector(sel); if (el && env[i] != null) setControl(e, sel, envVal(el, env[i], i)); });
}
function applyAll(mode) {
  const e = eng[mode]; if (!e?.doc) return;
  knobsOf(mode).forEach((k, i) => { if (k !== 0.5) knobTargets(mode, i, k, e); });
  envTargets(mode, e);
  feedPhoto(mode);
}
function applyPlace(mode, e) { if (!e?.api?.hasImage) return; if (usesRow(mode)) { if (st.row != null) setControl(e, '.js-rowbase', st.row); } else e.api.setArea(st.area); }
async function feedPhoto(mode) {
  const e = eng[mode]; if (!e?.doc || !photoFile || e.photoVer === photoVer) { applyPlace(mode, e); return; }
  e.photoVer = photoVer;
  const inp = e.doc.querySelector('.js-file'); if (!inp) return;
  const dt = new DataTransfer(); dt.items.add(photoFile); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  for (let k = 0; k < 100 && !e.api.hasImage; k++) await sleep(50);
  await sleep(200); applyPlace(mode, e);
}

/* ---------- screen ---------- */
const name = () => { const m = st.mode, changed = knobsOf(m).some((k) => k !== 0.5) || !!st.env[m]; $('.js-name').textContent = `${m}-Basic${changed ? ' *' : ''}`; };
function drawTabs() { $$('.js-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode)); }
const arc = (v) => { const a0 = 135, a1 = 405, a = a0 + (a1 - a0) * v, r = 22, c = 26, p = (deg, rr = r) => [c + rr * Math.cos((deg * Math.PI) / 180), c + rr * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a), [x2, y2] = p(a1), [px, py] = p(a, 13);
  return `<path d="M${x1} ${y1} A${r} ${r} 0 ${a1 - a > 180 ? 1 : 0} 1 ${x2} ${y2}" stroke="#c8d08f" stroke-width="4" stroke-linecap="round" fill="none"/>${v > 0.002 ? `<path d="M${x0} ${y0} A${r} ${r} 0 ${a - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}" stroke="#1b2a13" stroke-width="4" stroke-linecap="round" fill="none"/>` : ''}<circle cx="26" cy="26" r="15" fill="#fff" stroke="#1b2a13" stroke-width="1.5"/><path d="M26 26 L${px} ${py}" stroke="#1b2a13" stroke-width="2.5" stroke-linecap="round"/>`; };
function drawKnobs() {
  const m = st.mode, ks = knobsOf(m);
  $('.js-knobs').innerHTML = MODES[m].knobs.map(([label], i) => `<div class="knob" data-k="${i}"><svg viewBox="0 0 52 52">${arc(ks[i])}</svg><span>${label}</span></div>`).join('');
}
function drawEnv() {
  const m = st.mode, e = eng[m];
  const pos = MODES[m].adsr.map((sel, i) => { const el = e?.doc?.querySelector(sel); if (st.env[m]?.[i] != null) return st.env[m][i]; return el && e.base[sel] != null ? clamp(envPos(el, e.base[sel], i), 0, 1) : 0.5; });
  $('.js-env').innerHTML = ['A', 'D', 'S', 'R'].map((l, i) => `<label class="sl"><input type="range" min="0" max="1" step="0.001" value="${pos[i]}" data-e="${i}" style="--p:${pos[i] * 100}%"><span>${l}</span></label>`).join('');
  const [a, d, s, r] = pos, x1 = 2 + a * 10, x2 = x1 + 2 + d * 12, x3 = 33, y = 26 - s * 22;
  $('.js-shape path').setAttribute('d', `M2 26 L${x1} 3 L${x2} ${y} L${x3} ${y} L${Math.min(44, x3 + 2 + r * 10)} 26`);
}
function drawAll() { drawTabs(); drawKnobs(); drawEnv(); name(); drawOct(); }

// knobs: drag up / down (or sideways); a double tap goes back to Basic. The sound follows when the finger lifts
// (AIR makes its notes again after a change, so it is not redone on every move)
let kd = null;
$('.js-knobs').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.knob'); if (!el) return;
  const i = +el.dataset.k, now = performance.now();
  if (kd?.i === i && now - kd.t < 300) { knobsOf(st.mode)[i] = 0.5; commitKnob(i); kd = null; return; }
  kd = { i, y: e.clientY, x: e.clientX, v: knobsOf(st.mode)[i], t: now, id: e.pointerId }; capture(el, e.pointerId);
});
$('.js-knobs').addEventListener('pointermove', (e) => {
  if (!kd || kd.id !== e.pointerId) return;
  const v = clamp(kd.v + ((kd.y - e.clientY) + (e.clientX - kd.x)) / 180, 0, 1); knobsOf(st.mode)[kd.i] = v;
  $(`.knob[data-k="${kd.i}"] svg`).innerHTML = arc(v);
});
$('.js-knobs').addEventListener('pointerup', (e) => { if (!kd || kd.id !== e.pointerId) return; commitKnob(kd.i); kd = { i: kd.i, t: kd.t }; });
async function commitKnob(i) { save(); drawKnobs(); name(); const e = await frameFor(st.mode).ready; knobTargets(st.mode, i, knobsOf(st.mode)[i], e); }
$('.js-env').addEventListener('input', (e) => { const i = +e.target.dataset.e; (st.env[st.mode] ||= [null, null, null, null])[i] = +e.target.value; e.target.style.setProperty('--p', e.target.value * 100 + '%'); drawEnv(); name(); });
$('.js-env').addEventListener('change', async () => { save(); envTargets(st.mode, await frameFor(st.mode).ready); });
// Basic: the knobs back to the middle and the strike shape as it was = the mode's Basic sound
$('.js-basic').addEventListener('click', async () => {
  const m = st.mode, e = await frameFor(m).ready;
  st.knobs[m] = [0.5, 0.5, 0.5, 0.5]; delete st.env[m]; save(); drawAll();
  [0, 1, 2, 3].forEach((i) => knobTargets(m, i, 0.5, e));
  MODES[m].adsr.forEach((sel) => { if (e.base[sel] != null) setControl(e, sel, e.base[sel]); });
});
// Random: the four knobs and the strike shape, within a range that still sounds good
$('.js-rnd').addEventListener('click', async () => {
  const m = st.mode, e = await frameFor(m).ready;
  st.knobs[m] = [0, 1, 2, 3].map(() => 0.15 + Math.random() * 0.7);
  const base = MODES[m].adsr.map((sel, i) => { const el = e.doc.querySelector(sel); return el ? clamp(envPos(el, e.base[sel], i), 0, 1) : 0.5; });
  st.env[m] = base.map((p) => clamp(p + (Math.random() * 2 - 1) * 0.2, 0, 1));
  save(); drawAll(); st.knobs[m].forEach((k, i) => knobTargets(m, i, k, e)); envTargets(m, e);
});
$('.js-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === st.mode) return; allOff(); st.mode = b.dataset.mode; save(); drawAll(); drawArea(); show(); });
const drawReady = () => { const ok = !!eng[st.mode]?.ok; $('.js-kb').classList.toggle('is-wait', !ok); $('.js-status').textContent = ok ? '' : 'Loading…'; };
async function show() { drawReady(); const e = await frameFor(st.mode).ready; drawEnv(); drawArea(); applyAll(st.mode); drawReady(); return e; }

/* ---------- photo + reading area ---------- */
const cv = $('.js-cv'), area = $('.js-area'); let bmp = null, fit = null;
function drawPhoto() {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'); g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, cv.width, cv.height);
  $('.js-empty').hidden = !!bmp; if (!bmp) { area.hidden = true; return; }
  const s = Math.min(cv.width / bmp.width, cv.height / bmp.height), w = bmp.width * s, h = bmp.height * s, x = (cv.width - w) / 2, y = (cv.height - h) / 2;
  g.drawImage(bmp, x, y, w, h); fit = { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr };
  drawArea();
}
function drawArea() {
  const row = $('.js-row'), isRow = usesRow(st.mode); $('.js-hint').textContent = isRow ? 'Tap to choose the row' : 'Drag to choose the area';
  row.hidden = !isRow || !fit; if (isRow && fit) { const y = st.row ?? (eng.Bolt?.base['.js-rowbase'] ?? 0.206); row.style.top = fit.y + y * fit.h + 'px'; row.style.left = fit.x + 'px'; row.style.right = 'auto'; row.style.width = fit.w + 'px'; }
  const a = isRow ? null : st.area; area.hidden = !a || !fit; if (!a || !fit) return;
  Object.assign(area.style, { left: fit.x + a.x0 * fit.w + 'px', top: fit.y + a.y0 * fit.h + 'px', width: (a.x1 - a.x0) * fit.w + 'px', height: (a.y1 - a.y0) * fit.h + 'px' });
}
async function setPhoto(file, keepArea) {
  photoFile = file; photoVer++; bmp = await createImageBitmap(file); if (!keepArea) st.area = null; save(); drawPhoto();
  const e = await frameFor(st.mode).ready; feedPhoto(st.mode);
}
$('.js-file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const [img] = await readableImages([f]); if (img) setPhoto(img); });
let ad = null;
const frac = (e) => { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left - fit.x) / fit.w, 0, 1), y: clamp((e.clientY - r.top - fit.y) / fit.h, 0, 1) }; };
const setRow = (e) => { st.row = frac(e).y; drawArea(); };
$('.js-photo').addEventListener('pointerdown', (e) => { if (!bmp || !fit || e.target.closest('.photo__btn')) return; if (usesRow(st.mode)) setRow(e); ad = { a: frac(e), id: e.pointerId, moved: false }; capture(e.currentTarget, e.pointerId); });
$('.js-photo').addEventListener('pointermove', (e) => {
  if (!ad || ad.id !== e.pointerId) return; if (usesRow(st.mode)) { setRow(e); return; } const b = frac(e);
  if (Math.abs(b.x - ad.a.x) < 0.03 && Math.abs(b.y - ad.a.y) < 0.03 && !ad.moved) return;
  ad.moved = true; st.area = { x0: Math.min(ad.a.x, b.x), y0: Math.min(ad.a.y, b.y), x1: Math.max(ad.a.x, b.x), y1: Math.max(ad.a.y, b.y) }; drawArea();
});
$('.js-photo').addEventListener('pointerup', async (e) => {
  if (!ad || ad.id !== e.pointerId) return; const moved = ad.moved; ad = null;
  if (!usesRow(st.mode) && !moved) st.area = null; // a tap: the whole photo
  save(); drawArea(); const en = await frameFor(st.mode).ready; applyPlace(st.mode, en);
});
addEventListener('resize', drawPhoto);

/* ---------- keyboard ---------- */
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16], BLACK = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5], [13, 7], [15, 8]]; // [semitone, after white n]
function buildKeys() {
  const kb = $('.js-kb'), ww = 100 / WHITE.length;
  kb.innerHTML = WHITE.map((s, n) => `<div class="key key--w" data-s="${s}" style="left:calc(${n * ww}% + 1px);width:calc(${ww}% - 2px)">${n === 0 ? '<i class="js-c"></i>' : ''}</div>`).join('') +
    BLACK.map(([s, n]) => `<div class="key key--b" data-s="${s}" style="left:calc(${(n + 1) * ww - ww * 0.31}%);width:${ww * 0.62}%"></div>`).join('');
}
function drawOct() { $('.js-octname').textContent = 'C' + st.oct; const c = $('.js-c'); if (c) c.textContent = 'C' + st.oct; }
$('.js-octdn').addEventListener('click', () => { st.oct = clamp(st.oct - 1, 1, 7); save(); drawOct(); });
$('.js-octup').addEventListener('click', () => { st.oct = clamp(st.oct + 1, 1, 7); save(); drawOct(); });
const held = new Map(); // pointerId -> { el, id }
let seq = 0;
function unlock() { // sound may only start from a touch: wake the page's audio within this touch
  const e = eng[st.mode]; if (!e?.api) return;
  try { e.api.ensureCtx(); const c = e.api.ctx; if (c && c.state !== 'running') c.resume(); } catch {}
}
function keyOn(pid, el) {
  const e = eng[st.mode]; if (!e?.ok || !el) return; // not before the settings are in place
  const id = 'm' + (seq++), midi = 12 * (st.oct + 1) + +el.dataset.s;
  held.set(pid, { el, id, mode: st.mode }); el.classList.add('on');
  MODES[st.mode].on(e.api, id, midi, 0.9);
}
function keyOff(pid) {
  const h = held.get(pid); if (!h) return; held.delete(pid);
  if (![...held.values()].some((x) => x.el === h.el)) h.el.classList.remove('on');
  const e = eng[h.mode]; if (e?.api) MODES[h.mode].off(e.api, h.id);
}
function allOff() { for (const pid of [...held.keys()]) keyOff(pid); }
const keyAt = (x, y) => document.elementsFromPoint(x, y).find((n) => n.classList?.contains('key'));
$('.js-kb').addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); capture(e.currentTarget, e.pointerId); keyOn(e.pointerId, keyAt(e.clientX, e.clientY)); });
$('.js-kb').addEventListener('pointermove', (e) => { const h = held.get(e.pointerId); if (!h) return; const k = keyAt(e.clientX, e.clientY); if (k && k !== h.el) { keyOff(e.pointerId); keyOn(e.pointerId, k); } }); // sliding across the keys
for (const ev of ['pointerup', 'pointercancel']) $('.js-kb').addEventListener(ev, (e) => keyOff(e.pointerId));
addEventListener('pointerdown', unlock, true);
addEventListener('blur', allOff);
document.addEventListener('visibilitychange', () => { if (document.hidden) allOff(); });

/* ---------- the sound now: the desktop's Stereo view, over the whole photo ---------- */
// left / right as a trace turned 45°: up-down = the middle (L+R), sideways = the difference (L−R)
// (a thin upright line = in the middle, spreading sideways = wide left / right)
const wv = $('.js-wave'), wg = wv.getContext('2d'); let bl = null, br = null;
function drawWave() {
  requestAnimationFrame(drawWave);
  const r = wv.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (wv.width !== W || wv.height !== H) { wv.width = W; wv.height = H; }
  wg.clearRect(0, 0, W, H);
  const m = eng[st.mode]?.f.contentWindow?.__outMeter; if (!m?.l || !m?.r) return;
  if (!bl || bl.length !== m.l.fftSize) { bl = new Float32Array(m.l.fftSize); br = new Float32Array(m.r.fftSize); }
  m.l.getFloatTimeDomainData(bl); m.r.getFloatTimeDomainData(br);
  const cx = W / 2, cy = H / 2, R = H * 0.46; // in the middle of the photo
  wg.fillStyle = 'rgba(255,255,255,.25)'; wg.fillRect(cx - dpr / 2, 0, dpr, H); wg.fillRect(12 * dpr, cy - dpr / 2, W - 24 * dpr, dpr);
  wg.strokeStyle = 'rgba(255,255,255,.92)'; wg.lineWidth = 1.5 * dpr; wg.shadowColor = 'rgba(0,0,0,.45)'; wg.shadowBlur = 3 * dpr; wg.beginPath(); // a soft shadow keeps it readable on a light photo
  for (let i = 0; i < bl.length; i++) { const l = bl[i], rr = br[i], x = cx + Math.max(-2, Math.min(2, (l - rr) * 1.6)) * R, y = cy - Math.max(-1, Math.min(1, (l + rr) * 0.8)) * R; i ? wg.lineTo(x, y) : wg.moveTo(x, y); }
  wg.stroke(); wg.shadowBlur = 0;
}
requestAnimationFrame(drawWave);

/* ---------- start ---------- */
// the photo used last time (the pages keep their photos in this browser): shown again; the pages pick it up themselves
async function lastPhoto() {
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('photo-synth', 2); r.onupgradeneeded = () => { r.result.createObjectStore('slots', { keyPath: 'id', autoIncrement: true }); r.result.createObjectStore('meta'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (k) => new Promise((res) => { const q = db.transaction('meta').objectStore('meta').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    const list = (await get('pixelPhotos')) || [], blob = list.length ? list[list.length - 1].blob : await get('lastImage'); db.close();
    if (blob && !bmp) { bmp = await createImageBitmap(blob); drawPhoto(); }
  } catch {}
}
buildKeys(); drawAll(); drawPhoto(); lastPhoto(); show();
window.__m = { st, eng, MODES, setPhoto }; // for tests
