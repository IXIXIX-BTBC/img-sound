// Dub: phrases. 6 tracks x 8 patterns (Figma 95:5200 "Dub フレーズ 新レイアウト案 11/19").
// Tracks 1-2 = AIR, 3-4 = Bolt, 5 = Quake, 6 = Slicer (fixed, 11/19).
// Sound sources: each of tracks 1-5 runs its mode's own page in a hidden frame (?dub). That page sends its sound
// to us as a stream (js/out.js), and we play its notes through its own functions. So a Dub track sounds exactly
// like the mode it comes from, with the Sound (= that page's preset) copied into the session.
// Patterns are kept as note data (editable later) + XY / button moves. Sound is only written out (Rec Out).
import { speakerOut, outMeter } from '../js/out.js?v=5';
import { getBpm, setBpm, onBpm } from '../js/tempo.js?v=1';
import { restore } from '../js/presets.js?v=2';
import { DEFAULT_SOUNDS } from '../js/default-sounds.js?v=5';
import { finishRack } from '../js/finish.js?v=9';
import { appLinks } from '../js/app-link.js?v=1';
import { projectButton, zip } from '../js/project.js?v=5';
appLinks('Dub'); // one-window app: the other modes open beside Dub, which keeps playing

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MUTE = new URLSearchParams(location.search).has('mute');
const LAT = 0.05; // notes are sent this much early: the frame's sound reaches us a little late

/* ---------- tracks ---------- */
const MODES = {
  AIR: { page: 'pixel', api: '__px', open: '../pixel/', macro: [['Tone', '.js-gamma'], ['Motion', '.js-wobcents'], ['Texture', '.js-noise'], ['Space', '.js-rvb']] },
  Bolt: { page: 'lead', api: '__ld', open: '../lead/', macro: [['Tone', '.js-cutoff'], ['Motion', '.js-lfoamt'], ['Texture', '.js-drive'], ['Space', '.js-rvb']] },
  Quake: { page: 'bass', api: '__bs', open: '../bass/', macro: [['Tone', '.js-bf'], ['Motion', '.js-wamt'], ['Texture', '.js-gamt'], ['Space', '[data-k="teEcho"]']] },
};
const TRACKS = [
  { n: 1, name: 'AIR', mode: 'AIR' },
  { n: 2, name: 'AIR · Ambient', mode: 'AIR', free: true, audio: true }, // records its sound (the AIR loop), not notes
  { n: 3, name: 'Bolt', mode: 'Bolt' },
  { n: 4, name: 'Bolt', mode: 'Bolt' },
  { n: 5, name: 'Quake', mode: 'Quake' },
  { n: 6, name: 'Slicer', slicer: true },
];
const INS = { phaser: 'Phaser', step: 'Step Filter', drive: 'Tape Drive' };
const RET = [['tape', 'Tape Echo'], ['dd', 'Digital Delay'], ['spring', 'Spring'], ['big', 'Big Reverb']];
const DIVS = [4, 8, 16, 32];
const LENS = [1, 2, 4, 8, 16];
const QUANT = [['Off', 0], ['1/8', 2], ['1/16', 1], ['1/32', 0.5]];
// Grid (polyrhythm): how many steps one bar of a MIDI pattern is cut into. The bar stays the same length, so 12 against
// another track's 16 is 3 against 4. Notes are kept in time (1 = a 16th) whatever the grid; the grid only sets where
// notes snap (Quantize counts in its steps: 1/16 = one step, 1/8 = two, 1/32 = half) and the lines drawn.
const GRIDS = [16, 12, 24, 20, 10, 7, 5];
const gridOf = (P) => P.grid || 16;
const snapOf = (P, q) => q * (16 / gridOf(P)); // a Quantize value -> a length in 16ths
const TIMES = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]]; // in beats

/* ---------- session (saved in this browser) ---------- */
const KEY = 'photoSynth.dub.session';
const newPat = (slicer) => (slicer ? { len: 1, seed: null, div: 16, amt: 0.7, rev: 0, src: [1, 0, 1, 0, 0] } : { len: 2, notes: [], auto: [] });
const newTrack = (t) => ({
  sound: null, macro: [null, null, null, null], vol: 0.8, pan: 0, mute: 0, solo: 0, send: [0, 0, 0, 0],
  inserts: t.slicer ? [{ type: 'step', on: 1 }] : [{ type: 'phaser', on: 1 }, { type: 'step', on: 1 }],
  fx: {
    phaser: { p: [{ man: 0.35, rate: 0.25, depth: 0.5, fb: 0.4 }, { man: 0.6, rate: 0.4, depth: 0.5, fb: 0.4 }], link: 0, wave: 'sine', route: 'series', sync: 0 },
    step: { hp: 0, lp: 0, res: 0.2 },
    drive: { drive: 0.35, tone: 0.6, wow: 0.25, gen: 1 },
  },
  pats: Array.from({ length: 8 }, () => newPat(t.slicer)), sel: 0,
});
const DEFAULT = () => ({
  v: 1, name: 'Session-01', selTrack: 2,
  tracks: TRACKS.map(newTrack),
  ret: { tape: { time: 2, fb: 0.45, tone: 0.5, wow: 0.3, level: 0.8 }, dd: { time: 3, fb: 0.4, lo: 0.2, hi: 0.7, level: 0.7 }, spring: { decay: 0.5, tone: 0.5, drive: 0.3, level: 0.7 }, big: { size: 0.6, damp: 0.5, pre: 0.2, level: 0.6 } },
  rec: { overdub: 1, quant: 2, click: 1, count: 1 },
  video: { layout: 'grid', shape: 'rect', trail: 0.5, mat: [1, 1, 1, 1, 1, 1] },
  master: null,
});
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
if (!S || S.v !== 1) S = DEFAULT();
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (rack) S.master = rack.get(); localStorage.setItem(KEY, JSON.stringify(S)); }, 400); };
const T = (i) => S.tracks[i];
const pat = (i, p = T(i).sel) => T(i).pats[p];
// a sound pattern (recorded audio, plays its take): always on Track 2; on Tracks 1, 3-5 when the pattern is set to Audio
const isAud = (i, P = pat(i)) => !TRACKS[i].slicer && (!!TRACKS[i].audio || P.kind === 'audio');
const filled = (i, p) => { const P = pat(i, p); return TRACKS[i].slicer ? P.seed != null : (isAud(i, P) ? !!P.take : P.notes.length > 0) || P.auto.length > 0; };
// sessions from before: the slicer's old Rec / From picks become plain sources (tracks)
S.tracks.forEach((tk) => tk.pats.forEach((P) => { delete P.sel; delete P.loopOn; })); // Loop Bars was replaced by the Fit range
S.tracks[5]?.pats.forEach((P) => { const k = P.pick ? P.pick[0] : P.rec != null ? 1 : -1; if (k >= 0) P.src[k] = 1; delete P.rec; delete P.pick; });

/* ---------- screen ---------- */
const ICON = {
  AIR: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">' + [9.47, 16.49, 23.51, 30.53].flatMap((y) => [9.47, 16.49, 23.51, 30.53].map((x) => `<circle cx="${x}" cy="${y}" r="1.47"/>`)).join('') + '</svg>',
  Bolt: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor"><path d="M19.9964 20H7.96387L22.9674 8H34.9999L19.9964 20Z"/><path d="M17.0325 32H5L20.0035 20H32.0361L17.0325 32Z"/></svg>',
  Quake: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3.2"><circle cx="24" cy="20" r="10.4"/><circle cx="16" cy="20" r="10.4"/></svg>',
  Dub: '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3.2"><circle cx="20" cy="20" r="10.4"/></svg>',
  midi: '<svg width="33" height="32" viewBox="0 0 33 32" fill="none"><circle cx="15" cy="17" r="12.25" fill="none" stroke="#1B2A13" stroke-width="1.5"/><g fill="#1B2A13"><circle cx="8" cy="17" r="1.6"/><circle cx="10" cy="12" r="1.6"/><circle cx="15" cy="10" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="22" cy="17" r="1.6"/></g><rect x="13" y="24" width="4" height="3" fill="#1B2A13"/></svg>',
  full: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1h5v5M13 1 8 6M6 13H1V8M1 13l5-5"/></svg>',
};
const opt = (attr, val, label, on, hint) => `<button class="ui-opt${on ? ' on' : ''}" type="button" data-${attr}="${val}"${hint ? ` title="${esc(hint)}"` : ''}>${label}</button>`;

const ui = document.createElement('div');
ui.className = 'ui';
ui.innerHTML = `
<div class="ui-stage js-ui-stage dub">
  <div class="ui-card"></div>
  <a class="ui-abs ui-logo" href="../" title="写真シンセ"><img src="../img/logo.svg" alt="IMG SOUND"></a>
  <nav class="ui-abs ui-modes">
    <a class="ui-mode" href="../pixel/" title="AIR(アンビエント)">${ICON.AIR}</a>
    <a class="ui-mode" href="../lead/" title="Bolt(リード)">${ICON.Bolt}</a>
    <a class="ui-mode" href="../bass/" title="Quake(ベース)">${ICON.Quake}</a>
    <span class="ui-mode ui-mode--dub on" title="Dub(フレーズ)">${ICON.Dub}</span>
  </nav>
  <div class="ui-abs ui-vol"><div class="ui-vol__head"><span>Volume</span><b class="ui-val js-volv"></b></div><input type="range" class="js-vol" min="0" max="1" step="0.01" value="0.8"></div>
  <button class="ui-abs ui-midi js-midi" type="button" title="MIDI: 押して接続(選んでいるトラックを弾く)">${ICON.midi}<i class="ui-midi__dot"></i></button>
  <button class="ui-abs ui-btn ui-transport js-play" type="button" title="再生 / 停止(Space)"><i class="ui-play"></i></button>
  <button class="ui-abs ui-btn ui-project is-dis" type="button"><span>Project</span><i class="ui-plus"></i></button>
  <button class="ui-abs ui-btn ui-menu js-menu" type="button" title="メニュー"><i class="ui-menuic"></i></button>
  <div class="ui-abs ui-menubox js-menubox" hidden>
    <button class="js-m-rename" type="button">Session の名前を変える</button>
    <button class="js-m-new" type="button">新しい Session(今のパターンを全部消す)</button>
    <button class="js-m-panic" type="button">全部止める(Esc)</button>
    <div class="ui-menubox__sep"></div>
    <div class="ui-menubox__st">鍵盤: A W S E D F T G Y H U J K O L P ; / Z X でオクターブ / 1〜8 でパターン / ↑↓ でトラック / Space で再生 / ⌘Z で戻す / ⌘C ⌘V でパターンのコピー / Delete でパターンを空にする</div>
    <div class="ui-menubox__st js-m-status"></div>
  </div>

  <!-- left: video -->
  <div class="ui-abs dub-video">
    <div class="dub-video__head"><span>Video</span><span class="dub-chip" data-hint="スライサーが切った場所と同じ時刻の映像(写真と波形)を、同じ並べ替えでばらまきます">Slice Sync</span><button class="dub-ibtn js-vfull" type="button" title="全画面">${ICON.full}</button></div>
    <div class="dub-video__win"><canvas class="js-vcv" width="576" height="576"></canvas><span class="dub-video__info js-vinfo">Slicer off</span></div>
    <div class="dub-video__mat"><span class="dub-lbl" data-hint="映像の素材。各トラックの写真と、鳴った音の波形(時刻つきで記録)。押すと使う/使わない">Material</span><div class="dub-mats js-mats"></div></div>
    <div class="row"><span data-hint="切った映像の残り方。左=すぐ消える、右=重なって残る">Trail</span><input type="range" class="js-trail" min="0" max="1" step="0.01" data-fill><b class="js-trailv"></b></div>
  </div>

  <!-- main panel -->
  <div class="ui-abs ui-panel dub-main">
    <div class="dub-tp">
      <span class="dub-title">Dub</span>
      <button class="dub-tbtn js-rec" type="button" title="録音の準備。再生すると、選んでいるトラックの選んでいるパターンに録ります"><i class="dub-recdot"></i>REC</button>
      <button class="dub-tbtn js-play2" type="button">Play</button>
      <span class="dub-tbtn dub-tbtn--ro js-pos">Bar 1 / 2</span>
      <button class="dub-tbtn js-count" type="button" title="録るとき、1小節カウントしてから始める">Count 1</button>
      <button class="dub-tbtn js-click" type="button" title="録るときのクリック(メトロノーム)">Click</button>
      <span class="dub-session js-sname" title="押すと名前を変える"></span>
      <span class="dub-bpm js-bpm" title="テンポ(全モード共通)。上下にドラッグ / ダブルクリックで入力"></span>
    </div>
    <div class="dub-grid js-grid"></div>
    <div class="dub-ed">
      <div class="dub-ed__head">
        <span class="dub-ed__ttl js-edttl"></span>
        <span class="dub-opts js-kind"></span>
        <span class="dub-lbl">Length</span><span class="dub-opts js-lens"></span>
        <span class="js-gridw"><span class="dub-lbl" data-hint="1小節を何ステップに分けるか(ポリリズム)。小節の長さは同じなので、12 なら 16 のトラックに対して 3 対 4。音符はこの格子にそろう。今ある音符は動かさない">Grid</span> <select class="dub-num dub-gridsel js-gridsel">${GRIDS.map((g) => `<option value="${g}">${g}</option>`).join('')}</select></span>
        <span class="dub-lbl js-qlbl">Quantize</span><span class="dub-opts js-quant"></span>
        <span class="dub-opts js-odr"><button class="ui-opt" type="button" data-odr data-hint="押すと切り替え。Overdub = 重ねて録る / Replace = 録り始めたら前の中身を消す">Overdub</button></span>
      </div>
      <div class="dub-roll"><canvas class="js-roll" width="1280" height="476"></canvas></div>
      <div class="dub-lane"><span class="dub-lane__lbl" title="オートメーション: XY パッドとボタンの動き(録ったもの)">A</span><span class="dub-lane__cap">Phaser 1 (XY X)</span><canvas class="js-lane" width="1224" height="64"></canvas><button class="dub-lane__clr js-laneclr" type="button" title="このパターンの動きを消す">Clear</button></div>
    </div>
    <i class="dub-colline"></i>
    <div class="dub-col js-col"></div>
  </div>

  <div class="ui-low">
  <div class="ui-abs dub-vopts">
    <div class="dub-vopt"><span class="dub-lbl">Layout</span>${opt('layout', 'grid', 'Grid', 0, 'マス目にきっちり')}${opt('layout', 'free', 'Free', 0, '自由に散らす')}</div>
    <div class="dub-vopt"><span class="dub-lbl">Shape</span>${opt('shape', 'rect', 'Rect', 0, '四角')}${opt('shape', 'strip', 'Strip', 0, '細長い帯')}</div>
  </div>
  <button class="ui-abs dub-matadd" type="button" title="映像の素材を足す(2段目で作ります)">Material <i class="ui-plus"></i></button>
  <!-- left bottom: XY pad + performance buttons -->
  <div class="ui-abs dub-xy">
    <div class="dub-xy__head"><span>XY Pad</span><small class="js-xytrk"></small></div>
    <div class="dub-xy__pad js-pad"><canvas class="js-padcv" width="380" height="380"></canvas><i class="dub-xy__dot js-paddot"></i></div>
    <div class="dub-xy__lbl"><span>X Phaser 1</span><span>Y Phaser 2</span></div>
    <div class="dub-perf">
      <button class="dub-pbtn js-perf" data-perf="throw" type="button" title="押している間、選んでいるトラックの音を Tape Echo と Digital Delay に送る"><b>Throw</b><small>To Echo · hold</small></button>
      <button class="dub-pbtn js-perf" data-perf="drop" type="button" title="押している間、選んでいるトラックを消す"><b>Drop</b><small>Mute · hold</small></button>
      <button class="dub-pbtn js-perf" data-perf="fb" type="button" title="押している間、エコーのくり返しを上げて発振させる"><b>Feedback</b><small>Self-osc · hold</small></button>
    </div>
  </div>

  <!-- bottom: returns / effect panel / master / rec / export / output -->
  <div class="ui-abs dub-rets js-rets"></div>
  <div class="ui-abs dub-fx js-fx"></div>
  <div class="ui-abs dub-mfx js-mfx" hidden></div>
  <button class="ui-abs dub-master js-master" type="button" title="全体の仕上げ(Tube Comp → Tape Echo → EQ)。押すと設定"><span>Master</span><small>Comp → Echo → EQ</small><i class="sw js-msw" title="どれかがオンならオン"></i></button>
  <button class="ui-abs ui-btn dub-recout js-recout" type="button" title="全体の音を録る(もう一度押すと止める)。録った音は Export で書き出す"><i class="dub-recdot"></i><span>Rec Out</span></button>
  <div class="ui-abs dub-export">
    <span class="dub-export__ttl">Export</span>
    <button class="js-ex" data-ex="wav" type="button" title="Rec Out で録った音(WAV)"><span>Mix · WAV</span><i>↓</i></button>
    <button class="js-ex js-expats" data-ex="pats" type="button" title="中身のあるパターンを1つずつ鳴らして録り、WAV を zip にまとめる(エフェクト込み、ループの2周目を録るのでつなぎ目までそのまま)。パターンの長さの合計の2倍の時間がかかる。もう一度押すと中止"><span>Patterns · WAV</span><i>↓</i></button>
    <button class="js-ex is-dis" data-ex="video" type="button" title="映像つき(2段目で作ります)"><span>Video · MP4</span><i>↓</i></button>
    <button class="js-ex" data-ex="midi" type="button" title="全トラックのパターン(MIDI ファイル)"><span>MIDI · Patterns</span><i>↓</i></button>
  </div>
  <div class="ui-abs ui-out">
    <span class="ui-out__ttl">Output</span>
    <div class="ui-out__body">
      <div class="ui-meter"><b><i class="js-ml"></i></b><span>L</span></div>
      <div class="ui-meter"><b><i class="js-mr"></i></b><span>R</span></div>
      <div class="ui-peak"><span class="ui-peak__lbl">Peak</span><span class="ui-peak__v js-peak">-∞ dB</span><span class="ui-peak__lim js-lim"><i></i>Limit</span></div>
    </div>
  </div>
  <div class="ui-abs dub-loading js-loading">Loading sounds…</div>
  </div>
</div>
<div class="ui-hint js-hint"></div>`;
document.body.prepend(ui);
const stage = $('.js-ui-stage');

/* ---------- fit to the window: the same rule as the other pages (js/shell.js fit) ---------- */
// the width decides the scale; a low window takes height off the upper panels (--d), the lower row moves up with it
let fitD = 0;
function fit() {
  const TOP_MAX = 579, TOP_MIN = 440, REST = 1024 - TOP_MAX, K_MIN = 0.6, W = innerWidth, H = innerHeight;
  let k = Math.min(1, W / 1440);
  let top = Math.min(TOP_MAX, H / k - REST);
  if (top < TOP_MIN) { top = TOP_MIN; k = Math.max(K_MIN, Math.min(k, H / (REST + TOP_MIN))); }
  fitD = TOP_MAX - top;
  stage.style.setProperty('--d', fitD + 'px'); stage.style.transform = `scale(${k})`;
  const sh = (1024 - fitD) * k;
  stage.style.marginLeft = Math.max(0, (W - 1440 * k) / 2) + 'px';
  stage.style.marginTop = Math.max(0, (H - sh) / 2) + 'px';
  ui.style.height = Math.max(H, sh) + 'px';
}
addEventListener('resize', fit); fit();

/* ---------- hints ---------- */
const hint = $('.js-hint');
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-hint]');
  if (el && !el.matches('button')) {
    hint.innerHTML = `<b>${esc(el.textContent.trim())}</b>${esc(el.dataset.hint)}`; hint.classList.add('is-on');
    const r = el.getBoundingClientRect();
    hint.style.left = Math.min(innerWidth - hint.offsetWidth - 8, Math.max(8, r.left)) + 'px';
    hint.style.top = (r.top - hint.offsetHeight - 8 > 8 ? r.top - hint.offsetHeight - 8 : r.bottom + 8) + 'px';
  } else hint.classList.remove('is-on');
  if (!e.target.closest('.js-menu, .js-menubox')) $('.js-menubox').hidden = true;
  if (!e.target.closest('.dub-insadd')) $$('.dub-insmenu').forEach((m) => (m.hidden = true));
});
// slider fills (the dark part of the track)
const fillOne = (el) => el.style.setProperty('--p', ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100 + '%');
document.addEventListener('input', (e) => { if (e.target.matches?.('.ui input[type=range]')) fillOne(e.target); }, true);
const fillAll = () => $$('.ui input[type=range]').forEach(fillOne);
setInterval(fillAll, 500);

/* ---------- engines: hidden pages, one per track 1-5 ---------- */
const eng = TRACKS.map((t) => (t.slicer ? null : { frame: null, api: null, ready: null, src: null }));
function makeFrames() {
  const box = $('.js-engines');
  TRACKS.forEach((t, i) => {
    if (t.slicer) return;
    const f = document.createElement('iframe');
    f.src = MODES[t.mode].open + '?dub&t=' + t.n; f.allow = 'autoplay'; f.tabIndex = -1;
    box.append(f); eng[i].frame = f;
    eng[i].ready = new Promise((res) => {
      f.addEventListener('load', async () => {
        const w = f.contentWindow;
        for (let k = 0; k < 100 && !w[MODES[t.mode].api]; k++) await sleep(100);
        await sleep(300); // the page's screen frame (shell.js) moves its controls in
        eng[i].api = w[MODES[t.mode].api];
        await applySound(i);
        res();
      });
    });
  });
  Promise.all(eng.filter(Boolean).map((e) => e.ready)).then(() => { $('.js-loading').hidden = true; drawCol(); drawMats(); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docOf = (i) => eng[i]?.frame?.contentDocument;
const savedSounds = (i) => { try { return JSON.parse(localStorage.getItem('photoSynth.presets.' + MODES[TRACKS[i].mode].page)) || []; } catch { return []; } };
async function applySound(i) {
  const d = docOf(i); if (!d) return;
  const D = DEFAULT_SOUNDS[MODES[TRACKS[i].mode].page]; // none chosen = <mode>-Basic; a saved one gets newer controls' values from it
  const snd = T(i).sound; if (snd || D) await restore(snd ? { ...snd, v: { ...(D?.v || {}), ...snd.v } } : D, d);
  if (TRACKS[i].audio && T(i).loopMode) d.querySelector(`[data-loopmode="${T(i).loopMode}"]`)?.click();
  T(i).macro.forEach((v, m) => { if (v != null) setMacro(i, m, v, false); });
}
const macroEl = (i, m) => docOf(i)?.querySelector(MODES[TRACKS[i].mode].macro[m][1]);
const macroPos = (i, m) => { const el = macroEl(i, m); return el ? (+el.value - +el.min) / ((+el.max - +el.min) || 1) : 0; };
function setMacro(i, m, p, keep = true) {
  const el = macroEl(i, m); if (!el) return;
  el.value = +el.min + p * (+el.max - +el.min);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  if (keep) { T(i).macro[m] = p; save(); }
}
// notes
function noteOn(i, id, midi, vel = 0.9) {
  const a = eng[i]?.api; if (!a) return;
  if (TRACKS[i].mode === 'AIR') a.noteOn(id, midi, vel); else if (TRACKS[i].mode === 'Bolt') a.press(id, midi, vel); else a.press(id, midi);
}
function noteOff(i, id) {
  const a = eng[i]?.api; if (!a) return;
  if (TRACKS[i].mode === 'AIR') a.noteOff(id); else a.release(id);
}

/* ---------- audio ---------- */
let ctx = null, audioReady = null, rack = null, master = null, busIn = null, clickOut = null, recNode = null;
const A = []; // per track: { input, fader, pan, sends[], tap(analyser), units, drop }
const R = {}; // returns
function audio() {
  eng.forEach((e) => { const x = e?.api?.ctx; if (x && x.state !== 'running') x.resume().catch(() => {}); }); // every press: ask the sound pages to run too
  if (audioReady) return audioReady.then(() => ctx.state !== 'running' && ctx.resume());
  audioReady = (async () => {
    const c = new AudioContext({ latencyHint: 'interactive' });
    await c.audioWorklet.addModule('dub-worklets.js?v=9');
    ctx = c;
    master = c.createGain(); master.gain.value = +$('.js-vol').value;
    busIn = c.createGain();
    const fin = await rack.connect(c);
    busIn.connect(fin.input); fin.output.connect(master);
    const out = await speakerOut(c, MUTE);
    master.connect(out);
    clickOut = c.createGain(); clickOut.gain.value = 0.35; clickOut.connect(out); // the click is not recorded
    recNode = new AudioWorkletNode(c, 'dub-rec', { numberOfInputs: 1, numberOfOutputs: 0 });
    master.connect(recNode);
    recNode.port.onmessage = onRecData;
    buildReturns(c);
    TRACKS.forEach((t, i) => buildTrack(c, i));
    applyMix();
    // the frames' sound: start each page's audio, then take its stream. The transport does not wait more than 4 s
    // for them (a page whose audio is slow to be allowed would otherwise hold Play forever); late ones join when ready.
    const attach = eng.map(async (e, i) => {
      if (!e) return;
      await e.ready;
      const w = e.frame.contentWindow;
      await e.api?.ensureCtx?.();
      for (let k = 0; k < 200 && !w.__dubOut; k++) await sleep(50);
      if (!w.__dubOut || e.src) return;
      e.src = c.createMediaStreamSource(w.__dubOut);
      e.src.connect(A[i].mon || A[i].input);
      if (A[i].take) e.src.connect(A[i].take);
    });
    await Promise.race([Promise.all(attach), sleep(4000)]);
    loadTakes();
  })();
  return audioReady;
}

// --- effect units ---
function shaperCurve(k) { const n = 1024, a = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; a[i] = Math.tanh(x * k) / Math.tanh(k); } return a; }
function phaserUnit(c) {
  const input = c.createGain(), output = c.createGain(), sum = c.createGain(), dry = c.createGain(), wet = c.createGain();
  const aps = Array.from({ length: 6 }, () => { const f = c.createBiquadFilter(); f.type = 'allpass'; f.Q.value = 0.7; f.frequency.value = 600; return f; });
  input.connect(sum); sum.connect(aps[0]); for (let k = 0; k < 5; k++) aps[k].connect(aps[k + 1]);
  aps[5].connect(wet); input.connect(dry); dry.connect(output); wet.connect(output); dry.gain.value = 0.6; wet.gain.value = 0.6;
  const fb = c.createGain(); fb.gain.value = 0; aps[5].connect(fb); fb.connect(sum);
  const lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 0.3; lfo.connect(lfoG); aps.forEach((a) => lfoG.connect(a.frequency)); lfo.start();
  return {
    input, output,
    set({ man, rate, depth, fb: f }, wave, sync) {
      const now = c.currentTime, base = 90 * Math.pow(2, man * 5.6); // 90 Hz .. 4.3 kHz
      aps.forEach((a) => a.frequency.setTargetAtTime(base, now, 0.015));
      lfoG.gain.setTargetAtTime(base * depth * 0.85, now, 0.02);
      lfo.type = wave === 'square' ? 'square' : 'sine';
      lfo.frequency.setTargetAtTime(rateHz(rate, sync), now, 0.02);
      fb.gain.setTargetAtTime(f * 0.85, now, 0.02);
    },
    man(m) { const base = 90 * Math.pow(2, m * 5.6); aps.forEach((a) => a.frequency.setTargetAtTime(base, c.currentTime, 0.012)); },
  };
}
const SYNC_BEATS = [16, 8, 4, 2, 1, 0.5, 0.25];
const rateHz = (r, sync) => (sync ? (getBpm() / 60) / SYNC_BEATS[Math.round(r * (SYNC_BEATS.length - 1))] : 0.03 * Math.pow(2, r * 8)); // free: 0.03..7.7 Hz
const rateTxt = (r, sync) => (sync ? ['4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/8', '1/16'][Math.round(r * 6)] : rateHz(r, 0).toFixed(2) + 'Hz');
function phaser(c) {
  const input = c.createGain(), output = c.createGain(), u = [phaserUnit(c), phaserUnit(c)], half = c.createGain(); half.gain.value = 0.5;
  let route = null;
  const wire = (r) => {
    if (r === route) return; route = r;
    [input, u[0].output, u[1].output, half].forEach((n) => n.disconnect());
    if (r === 'parallel') { input.connect(u[0].input); input.connect(u[1].input); u[0].output.connect(half); u[1].output.connect(half); half.connect(output); }
    else { input.connect(u[0].input); u[0].output.connect(u[1].input); u[1].output.connect(output); }
  };
  wire('series');
  return { input, output, set(f) { wire(f.route); const p2 = f.link ? { ...f.p[0], man: f.p[1].man } : f.p[1]; u[0].set(f.p[0], f.wave, f.sync); u[1].set(p2, f.wave, f.sync); }, man(k, m) { u[k].man(m); } };
}
const HP = [10, 70, 150, 250, 500, 1000, 1500, 2500, 3500, 5000, 7500];
const LP = [22000, 12000, 8000, 5000, 3500, 2500, 1500, 1000, 600, 350, 200];
function stepFilter(c) {
  const h1 = c.createBiquadFilter(), h2 = c.createBiquadFilter(), l1 = c.createBiquadFilter(), l2 = c.createBiquadFilter();
  h1.type = h2.type = 'highpass'; l1.type = l2.type = 'lowpass'; h1.connect(h2).connect(l1).connect(l2);
  return {
    input: h1, output: l2,
    set({ hp, lp, res }) {
      const t = c.currentTime, q = 0.7 + res * 9;
      [h1, h2].forEach((f) => f.frequency.setValueAtTime(HP[hp], t)); [l1, l2].forEach((f) => f.frequency.setValueAtTime(LP[lp], t));
      h2.Q.setValueAtTime(hp ? q : 0.7, t); l2.Q.setValueAtTime(lp ? q : 0.7, t); h1.Q.value = l1.Q.value = 0.7;
    },
  };
}
function tapeDrive(c) {
  const input = c.createGain(), sh = c.createWaveShaper(), lp = c.createBiquadFilter(), dl = c.createDelay(0.05), out = c.createGain();
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.6; lfo.connect(lg).connect(dl.delayTime); lfo.start(); dl.delayTime.value = 0.008;
  lp.type = 'lowpass'; sh.oversample = '2x';
  input.connect(sh).connect(lp).connect(dl).connect(out);
  return {
    input, output: out,
    set({ drive, tone, wow, gen }) {
      const g = 1 + (gen - 1) * 0.35, k = 1 + drive * 7 * g;
      sh.curve = shaperCurve(k); input.gain.value = 0.9;
      lp.frequency.value = (1200 + tone * 15000) / g; lp.Q.value = 0.6;
      lg.gain.value = wow * 0.0025 * g; out.gain.value = 1 / (1 + drive * 0.6);
    },
  };
}
function buildTrack(c, i) {
  const t = TRACKS[i];
  const input = c.createGain(), post = c.createGain(), fader = c.createGain(), drop = c.createGain(), pan = c.createStereoPanner(), tap = c.createAnalyser();
  tap.fftSize = 512;
  const units = { phaser: phaser(c), step: stepFilter(c), drive: tapeDrive(c) };
  post.connect(tap); post.connect(fader).connect(drop).connect(pan).connect(busIn);
  const sends = RET.map(([k]) => { const g = c.createGain(); g.gain.value = 0; drop.connect(g); g.connect(R[k].input); return g; });
  const clean = new AudioWorkletNode(c, 'dub-clean', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  clean.port.onmessage = () => warnBroken(i);
  A[i] = { input, clean, post, fader, drop, pan, tap, units, sends, chain: null };
  if (!t.slicer) { // the live sound (monitor) and the recorder (for Audio patterns); recorded takes play straight into input
    A[i].mon = c.createGain(); A[i].mon.connect(input);
    A[i].take = new AudioWorkletNode(c, 'dub-take', { numberOfInputs: 1, numberOfOutputs: 0 });
    A[i].take.port.onmessage = ({ data }) => onTake(i, data);
  }
  wireInserts(i); applyFx(i);
}
// a track sent a broken number (it was removed): say which, so the cause can be found
function warnBroken(i) {
  console.warn('Dub: broken sound (NaN) removed on Track ' + TRACKS[i].n);
  (window.__dubBroken ||= []).push({ track: TRACKS[i].n, t: new Date().toLocaleTimeString() });
  let el = document.querySelector('.dub-warn'); if (!el) { el = document.createElement('div'); el.className = 'dub-warn'; document.body.append(el); }
  el.textContent = `Track ${TRACKS[i].n}: a broken sound was removed (NaN)`; el.hidden = false;
  clearTimeout(warnBroken.t); warnBroken.t = setTimeout(() => (el.hidden = true), 6000);
}
function wireInserts(i) {
  const a = A[i]; if (!a) return;
  a.input.disconnect(); a.clean.disconnect(); Object.values(a.units).forEach((u) => u.output.disconnect());
  a.input.connect(a.clean); let node = a.clean; // broken numbers stop here
  for (const ins of T(i).inserts) { if (!ins.on) continue; const u = a.units[ins.type]; node.connect(u.input); node = u.output; }
  node.connect(a.post);
}
function applyFx(i) {
  const a = A[i]; if (!a) return; const f = T(i).fx;
  a.units.phaser.set(f.phaser); a.units.step.set(f.step); a.units.drive.set(f.drive);
}
function applyMix() {
  if (!ctx) return;
  const solo = S.tracks.some((t) => t.solo);
  S.tracks.forEach((t, i) => {
    const a = A[i]; if (!a) return;
    const on = !t.mute && (!solo || t.solo);
    a.fader.gain.setTargetAtTime(on ? t.vol * t.vol * 1.4 : 0, ctx.currentTime, 0.01);
    a.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.02);
    a.sends.forEach((g, k) => g.gain.setTargetAtTime(perf.throw && i === S.selTrack && k < 2 ? 1 : t.send[k], ctx.currentTime, 0.01));
    a.drop.gain.setTargetAtTime(perf.drop && i === S.selTrack ? 0 : 1, ctx.currentTime, 0.005);
  });
  applyReturns();
}

// --- returns (shared by all tracks) ---
function impulse(c, sec, decay, damp, kind) {
  const n = Math.max(1, Math.floor(c.sampleRate * sec)), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / c.sampleRate, env = Math.exp(-t * decay);
      let x = Math.random() * 2 - 1;
      if (kind === 'spring') { // "boing": a dispersive chirp that comes back every ~35 ms, plus a metallic tail
        const ph = (t % 0.035) / 0.035, ch1 = Math.sin(2 * Math.PI * (3500 * Math.exp(-ph * 4)) * (t % 0.035));
        x = x * 0.35 + ch1 * 0.9 * Math.exp(-ph * 2.5);
      }
      lp += (x - lp) * (1 - damp * 0.95); d[i] = lp * env;
    }
  }
  return b;
}
function buildReturns(c) {
  const mk = () => ({ input: c.createGain(), out: c.createGain() });
  // Tape Echo: delay with wow, warm loop, soft clipping (so Feedback can scream without blowing up)
  { const r = mk(), sum = c.createGain(), dl = c.createDelay(4), sh = c.createWaveShaper(), lp = c.createBiquadFilter(), hp = c.createBiquadFilter(), fb = c.createGain();
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.7; lfo.connect(lg).connect(dl.delayTime); lfo.start();
    sh.curve = shaperCurve(1.6); lp.type = 'lowpass'; hp.type = 'highpass'; hp.frequency.value = 140;
    r.input.connect(sum).connect(dl).connect(sh).connect(lp).connect(hp); hp.connect(fb).connect(sum); hp.connect(r.out);
    Object.assign(r, { dl, fb, lp, lg }); R.tape = r; }
  // Digital Delay: clean and long, filter in the loop
  { const r = mk(), sum = c.createGain(), dl = c.createDelay(4), lo = c.createBiquadFilter(), hi = c.createBiquadFilter(), fb = c.createGain(), sh = c.createWaveShaper();
    lo.type = 'highpass'; hi.type = 'lowpass'; sh.curve = shaperCurve(1.05);
    r.input.connect(sum).connect(dl).connect(lo).connect(hi).connect(sh); sh.connect(fb).connect(sum); sh.connect(r.out);
    Object.assign(r, { dl, fb, lo, hi }); R.dd = r; }
  // Spring: drive -> spring impulse -> low cut; Kick = hit the tank
  { const r = mk(), sh = c.createWaveShaper(), cv = c.createConvolver(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 180; lp.type = 'lowpass';
    r.input.connect(sh).connect(cv).connect(hp).connect(lp).connect(r.out);
    Object.assign(r, { sh, cv, lp }); R.spring = r; }
  // Big Reverb: pre-delay -> long hall
  { const r = mk(), pre = c.createDelay(0.5), cv = c.createConvolver();
    r.input.connect(pre).connect(cv).connect(r.out);
    Object.assign(r, { pre, cv }); R.big = r; }
  RET.forEach(([k]) => R[k].out.connect(busIn));
}
let irKey = {};
function applyReturns() {
  if (!ctx) return;
  const t = ctx.currentTime, beat = 60 / getBpm(), rt = S.ret;
  R.tape.dl.delayTime.setTargetAtTime(Math.min(3.9, beat * TIMES[rt.tape.time][1]), t, 0.05);
  R.tape.fb.gain.setTargetAtTime(perf.fb ? 1.12 : rt.tape.fb * 0.98, t, perf.fb ? 0.08 : 0.02);
  R.tape.lp.frequency.value = 900 + rt.tape.tone * 7000; R.tape.lg.gain.value = rt.tape.wow * 0.0035;
  R.tape.out.gain.value = rt.tape.off ? 0 : rt.tape.level;
  R.dd.dl.delayTime.setTargetAtTime(Math.min(3.9, beat * TIMES[rt.dd.time][1]), t, 0.05);
  R.dd.fb.gain.setTargetAtTime(perf.fb ? 1.02 : rt.dd.fb * 0.95, t, perf.fb ? 0.08 : 0.02);
  R.dd.lo.frequency.value = 20 * Math.pow(2, rt.dd.lo * 7); R.dd.hi.frequency.value = 800 * Math.pow(2, rt.dd.hi * 4.5);
  R.dd.out.gain.value = rt.dd.off ? 0 : rt.dd.level;
  R.spring.sh.curve = shaperCurve(1 + rt.spring.drive * 12); R.spring.lp.frequency.value = 1500 + rt.spring.tone * 9000;
  R.spring.out.gain.value = rt.spring.off ? 0 : rt.spring.level * 0.9;
  R.big.pre.delayTime.value = rt.big.pre * 0.12; R.big.out.gain.value = rt.big.off ? 0 : rt.big.level;
  const ks = `${rt.spring.decay}`, kb = `${rt.big.size}|${rt.big.damp}`;
  clearTimeout(applyReturns.t);
  applyReturns.t = setTimeout(() => { // impulses are rebuilt only when their shape changes (a little later: dragging stays light)
    if (irKey.s !== ks) { irKey.s = ks; R.spring.cv.buffer = impulse(ctx, 0.6 + rt.spring.decay * 2.4, 6 - rt.spring.decay * 4, 0.3, 'spring'); }
    if (irKey.b !== kb) { irKey.b = kb; R.big.cv.buffer = impulse(ctx, 1 + rt.big.size * 7, 3.2 - rt.big.size * 2.6, rt.big.damp, 'big'); }
  }, 120);
}
function kickSpring() {
  if (!ctx) return;
  const n = Math.floor(ctx.sampleRate * 0.03), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.15));
  const s = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 2.2; s.buffer = b; s.connect(g).connect(R.spring.input); s.start();
}

/* ---------- performance (XY / buttons) ---------- */
const perf = { throw: 0, drop: 0, fb: 0 };
function setPerf(k, on, record = true) {
  perf[k] = on ? 1 : 0; applyMix();
  $(`[data-perf="${k}"]`).classList.toggle('on', !!on);
  if (record) recAuto({ k, v: on ? 1 : 0 });
}
function setXY(x, y, record = true, i = S.selTrack) {
  const f = T(i).fx.phaser; f.p[0].man = clamp(x, 0, 1); f.p[1].man = clamp(y, 0, 1);
  if (A[i]) { A[i].units.phaser.man(0, f.p[0].man); A[i].units.phaser.man(1, f.p[1].man); }
  if (i === S.selTrack) drawPadDot();
  if (record) recAuto({ k: 'xy', x: f.p[0].man, y: f.p[1].man });
  if (selFx === 'phaser' && i === S.selTrack) syncFxValues();
  save();
}

/* ---------- transport / sequencer ---------- */
const tr = { on: false, start: 0, g: 0, next: 0, timer: 0, rec: false, recPass: 0 };
const play = TRACKS.map(() => ({ cur: -1, start: 0, next: undefined }));
const stepDur = () => 60 / getBpm() / 4;
const playingPat = (i) => (play[i].cur >= 0 ? T(i).pats[play[i].cur] : null);
const patSteps = (p) => p.len * 16;
let recArmed = false;
async function startStop() {
  if (tr.on) return stop();
  await audio();
  const now = ctx.currentTime + 0.08;
  tr.g = recArmed && S.rec.count ? -16 : 0;
  tr.start = now - tr.g * stepDur();
  tr.next = now; tr.on = true; tr.recPass++;
  // tracks that were chosen while stopped start now; while recording, the selected pattern of the selected track plays
  play.forEach((p) => { if (p.next !== undefined) { p.cur = p.next; p.next = undefined; } p.silent = false; p.start = 0; });
  if (recArmed) { const s = S.selTrack; play[s].cur = T(s).sel; play[s].start = 0; if (isAud(s)) startTake(s); }
  applyMix();
  tr.timer = setInterval(tick, 20); tick();
  drawTransport(); drawGrid();
}
function stop() {
  play.forEach((p) => { if (p.next === -1) p.next = undefined; }); // a stop still waiting for its bar: everything stops now anyway
  tr.on = false; clearInterval(tr.timer);
  pendingT.forEach(clearTimeout); pendingT.clear();
  allNotesOff();
  stopTakes();
  vq.length = 0;
  drawTransport(); drawGrid(); drawRoll();
}
// one track stops at time t: its sounding notes end and its takes / slices are cut there
function stopTrackAt(i, t) {
  A[i]?.mon?.gain.setValueAtTime(0, t); // silent from there (Track 2: its live AIR loop too)
  for (const s of takeSrc) if (s._i === i) stopSrc(s, t);
  at(t, () => { for (const [id, ti] of liveNotes) if (ti === i) { noteOff(i, id); liveNotes.delete(id); } drawGrid(); });
}
const pendingT = new Set();
const at = (time, fn) => { const id = setTimeout(() => { pendingT.delete(id); fn(); }, Math.max(0, (time - ctx.currentTime) * 1000)); pendingT.add(id); };
let noteSeq = 0;
const liveNotes = new Map(); // id -> track
function allNotesOff() { for (const [id, i] of liveNotes) noteOff(i, id); liveNotes.clear(); }
function tick() {
  if (!tr.on) return;
  const ahead = ctx.currentTime + 0.12;
  while (tr.next < ahead) { scheduleStep(tr.g, tr.next); tr.g++; tr.next = tr.start + tr.g * stepDur(); }
}
onBpm(() => { if (tr.on && ctx) tr.start = tr.next - tr.g * stepDur(); applyReturns(); S.tracks.forEach((_, i) => applyFx(i)); drawTransport(); });
function click(time, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175; g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(0.6, time + 0.001); g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  o.connect(g).connect(clickOut); o.start(time); o.stop(time + 0.06);
}
function scheduleStep(g, t) {
  const sd = stepDur();
  if (g % 4 === 0 && ((recArmed && S.rec.click) || g < 0)) click(t, ((g % 16) + 16) % 16 === 0);
  if (g < 0) { at(t, () => drawTransport(g)); return; }
  if (g % 4 === 0) at(t, () => { drawTransport(); drawGrid(); });
  TRACKS.forEach((trk, i) => {
    const p = play[i];
    // pattern changes: at the end of the playing pattern, or on the next bar when nothing plays
    if (p.next !== undefined) {
      const L = p.cur >= 0 ? patSteps(T(i).pats[p.cur]) : 16;
      if ((p.cur < 0 && g % 16 === 0) || (p.cur >= 0 && (g - p.start) % L === 0) || (p.next === -1 && g % 16 === 0)) { if (p.next === -1 && p.cur >= 0) { stopTrackAt(i, t); p.silent = true; } p.cur = p.next; p.start = g; p.next = undefined; }
    }
    if (p.cur < 0) { if (!trk.slicer && g % 16 === 0) A[i]?.mon?.gain.setValueAtTime(p.silent ? 0 : 1, t); return; } // stopped with ■: silent (Track 2's live AIR loop is not let through)
    const P = T(i).pats[p.cur], L = patSteps(P), pos = (((g - p.start) % L) + L) % L;
    if (trk.slicer) { scheduleSlices(i, P, g, t, pos); return; }
    const aud = isAud(i, P);
    if (pos === 0) { // a recorded take: play it from the top (the live sound is muted); otherwise (notes, no take yet, recording it now): the live sound
      if (aud && P.take && takes.has(P.take) && !(takeRec && takeRec.P === P)) playPass(i, P, t, L * sd); else A[i].mon.gain.setValueAtTime(1, t);
    }
    for (const n of aud ? [] : P.notes) {
      if (Math.floor(n.s) !== pos) continue;
      const on = t + (n.s - pos) * sd, off = on + Math.max(0.05, n.l * sd - 0.01), id = 'q' + (noteSeq++);
      at(on - LAT, () => { noteOn(i, id, n.m, n.v ?? 0.9); liveNotes.set(id, i); });
      at(off - LAT, () => { noteOff(i, id); liveNotes.delete(id); });
    }
    if (!(tr.rec && i === S.selTrack && recTouched)) {
      for (const a of P.auto) { if (Math.floor(a.s) !== pos) continue; at(t + (a.s - pos) * sd, () => playAuto(i, a)); }
    }
    // footage for the video: what this track sounded like at this moment
    at(t, () => footage(i, t));
  });
}
function playAuto(i, a) {
  if (a.k === 'xy') setXY(a.x, a.y, false, i);
  else if (i === S.selTrack) setPerf(a.k, a.v, false);
}

/* ---------- slicer ---------- */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function slicePlan(P, bar) {
  const r = rng(P.seed * 7919 + bar * 104729 + 1), n = P.div, order = [];
  const pool = [...Array(n).keys()];
  for (let k = n - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  for (let k = 0; k < n; k++) {
    const moved = r() < P.amt;
    order.push({ moved, from: moved ? pool[k] : k, rev: P.rev && r() < P.rev, cell: Math.floor(r() * 1e9), src: Math.floor(r() * 1e9) });
  }
  return order;
}
// Slicer: the material is every filled pattern of the chosen tracks (Source), whatever the grid plays; empty ones are
// left out. A recorded pattern gives pieces of its (fitted) take, a MIDI pattern pieces of its notes. All of them are
// cut by the slice count (each pattern's bars × the count) into one pool. The plan (seed) moves pieces: a moved piece
// is any piece of the pool, the others walk through the pool in order. Same seed = the same every loop.
// Recorded pieces play on Track 6; MIDI pieces play their notes on their own track's instrument (and come out there).
function slicePool(P) {
  const pool = [];
  P.src.forEach((on, k) => {
    if (!on || TRACKS[k].slicer) return;
    T(k).pats.forEach((SP) => { const aud = isAud(k, SP); if (aud ? !SP.take : !SP.notes.length) return; pool.push({ t: k, SP, aud, n: Math.max(1, SP.len) * P.div }); });
  });
  return pool;
}
function scheduleSlices(i, P, g, t, pos) {
  if (P.seed == null) return;
  const sd = stepDur(), per = 16 / P.div, bar = Math.floor(pos / 16), inBar = pos % 16, barT = t - inBar * sd;
  const pool = slicePool(P), total = pool.reduce((a, x) => a + x.n, 0); if (!total) return;
  const plan = slicePlan(P, bar);
  for (let s = 0; s < P.div; s++) {
    const st = s * per; if (st < inBar || st >= inBar + 1) continue;
    const o = plan[s]; let k = o.moved ? o.src % total : (bar * P.div + s) % total, it = pool[0];
    for (const x of pool) { if (k < x.n) { it = x; break; } k -= x.n; }
    const when = barT + st * sd;
    if (it.aud) playPiece(i, P, it.SP, k, when, per * sd, o.rev); else notePiece(it.t, it.SP, k, when, o.rev, sd, per);
    vq.push({ time: when, src: it.t, srcTime: when, n: P.div, cell: o.cell, from: k % P.div }); // the video: that track's photo, the piece's place in its bar
  }
  if (inBar === 0) at(t, () => { $('.js-vinfo').textContent = `1/${P.div} · seed ${String(P.seed).padStart(4, '0')} · ${pool.length} pattern${pool.length > 1 ? 's' : ''} · Bar ${bar + 1}`; });
}

// Pitch Even: how far to speed up / slow down a piece so its pitch lands on the key's scale.
// get(k) = the piece's k-th sample. Looks at its first ~2048 samples (every 2nd one), normalized autocorrelation,
// first strong peak (avoids octave mistakes). Unclear pitch (noise, hits) = 1 (left as it is).
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
function evenRate(get, n, sr, root, minor) {
  const W = Math.min(1024, Math.floor(n / 2)), sr2 = sr / 2; if (W < 256) return 1;
  const x = new Float32Array(W); for (let k = 0; k < W; k++) x[k] = get(k * 2);
  const lo = Math.max(2, Math.floor(sr2 / 1000)), hi = Math.min(Math.floor(sr2 / 60), Math.floor(W / 2));
  const nsdf = new Float32Array(hi + 2); let top = 0;
  for (let lag = lo; lag <= hi + 1; lag++) { let r = 0, m = 0; for (let k = 0; k < W - lag; k++) { const a = x[k], b = x[k + lag]; r += a * b; m += a * a + b * b; } nsdf[lag] = m > 1e-9 ? (2 * r) / m : 0; if (lag <= hi) top = Math.max(top, nsdf[lag]); }
  if (top < 0.6) return 1;
  let best = 0;
  for (let lag = lo + 1; lag <= hi; lag++) if (nsdf[lag] >= 0.9 * top && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) { best = lag; break; }
  if (!best) return 1;
  const a = nsdf[best - 1], b = nsdf[best], c = nsdf[best + 1], d = a - 2 * b + c, lag = best + (d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0);
  const midi = 69 + 12 * Math.log2(sr2 / lag / 440), sc = SCALES[minor ? 'minor' : 'major'];
  let to = Math.round(midi), dist = 99;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) if (sc.includes((((m - root) % 12) + 12) % 12) && Math.abs(m - midi) < dist) { dist = Math.abs(m - midi); to = m; }
  const rt = Math.pow(2, (to - midi) / 12);
  return Number.isFinite(rt) ? Math.max(0.5, Math.min(2, rt)) : 1; // never a broken number
}
const peOf = (P) => (P.pe ? { root: P.key || 0, minor: P.scale === 'minor' ? 1 : 0 } : null);
const pieceRates = new Map();
function pieceRate(key, b, piece, from, len, pe) {
  if (!pe) return 1;
  const id = `${key}|${from.toFixed(4)}|${len.toFixed(4)}|${pe.root}|${pe.minor}`;
  let r = pieceRates.get(id); if (r != null) return r;
  const d = b.getChannelData(0), s0 = Math.round(from * b.sampleRate);
  r = evenRate((k) => d[s0 + k] || 0, Math.round(len * b.sampleRate), b.sampleRate, pe.root, pe.minor);
  pieceRates.set(id, r); return r;
}
const revBufs = new Map();
function revOf(key, b) {
  let r = revBufs.get(key); if (r) return r;
  r = ctx.createBuffer(2, b.length, b.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const a = b.getChannelData(ch), o = r.getChannelData(ch), n = a.length; for (let k = 0; k < n; k++) o[k] = a[n - 1 - k]; }
  revBufs.set(key, r); return r;
}
// a MIDI piece: the notes inside it, cut at its edges (Reverse mirrors their timing), on that track's instrument
function notePiece(ti, SP, piece, slot, rev, sd, per) {
  if (takeRec?.i === ti) return; // that track is recording its sound: the pieces would be recorded into the take
  const ws = piece * per, we = ws + per;
  for (const nt of SP.notes) {
    const a = Math.max(nt.s, ws), b = Math.min(nt.s + nt.l, we); if (b - a < 0.05) continue;
    let ra = a - ws, rb = b - ws; if (rev) [ra, rb] = [per - rb, per - ra];
    const on = slot + ra * sd, off = Math.max(on + 0.03, slot + rb * sd - 0.01), id = 'sl' + (noteSeq++);
    at(on - LAT, () => { if (takeRec?.i === ti) return; noteOn(ti, id, nt.m, nt.v ?? 0.9); liveNotes.set(id, ti); }); // (recording may have started since)
    at(off - LAT, () => { noteOff(ti, id); liveNotes.delete(id); });
  }
}
// a recorded piece: that stretch of the (fitted) take, with short fades, Pitch Even and Reverse
function playPiece(i, P, SP, piece, when, len, rev) {
  const b = bufOf(SP); if (!b) return;
  const key = keyOf(b, SP), from = (piece / P.div) * 16 * stepDur(), F = 0.002;
  if (from >= b.duration) return;
  const rt = pieceRate(key, b, piece, from, len, peOf(P)), span = len * rt; // Pitch Even: played faster / slower
  const src = ctx.createBufferSource(), gn = ctx.createGain();
  src.buffer = rev ? revOf(key, b) : b; src.playbackRate.value = rt;
  gn.gain.setValueAtTime(0, when); gn.gain.linearRampToValueAtTime(1, when + F); gn.gain.setValueAtTime(1, when + len - F); gn.gain.linearRampToValueAtTime(0, when + len);
  src.connect(gn).connect(A[i].input); src._i = i; src._g = gn;
  src.start(when, rev ? Math.max(0, b.duration - from - span) : from, span);
  takeSrc.add(src); src.onended = () => takeSrc.delete(src);
}

/* ---------- recording notes and moves ---------- */
let recTouched = false, recFirst = true;
const posNow = (i) => {
  const p = play[i]; if (!tr.on || p.cur < 0 || !ctx) return null;
  const P = T(i).pats[p.cur], L = patSteps(P), g = (ctx.currentTime - tr.start) / stepDur();
  if (g < 0) return null;
  return ((g - p.start) % L + L) % L;
};
const recording = (i) => tr.on && recArmed && i === S.selTrack && play[i].cur >= 0 && posNow(i) != null;
const held = new Map(); // key id -> { midi, id, s, i }
function keyDown(kid, midi, vel = 0.9) {
  if (held.has(kid)) return;
  audio();
  const i = S.selTrack; if (TRACKS[i].slicer) return;
  const id = 'k' + (noteSeq++);
  noteOn(i, id, midi, vel); liveNotes.set(id, i);
  const h = { midi, id, i, s: recording(i) ? posNow(i) : null, vel };
  held.set(kid, h);
}
function keyUp(kid) {
  const h = held.get(kid); if (!h) return; held.delete(kid);
  noteOff(h.i, h.id); liveNotes.delete(h.id);
  if (h.s == null || !recording(h.i) || isAud(h.i, T(h.i).pats[play[h.i].cur])) return;
  const P = T(h.i).pats[play[h.i].cur], L = patSteps(P), q = snapOf(P, QUANT[S.rec.quant][1]);
  const e = posNow(h.i); let len = ((e - h.s) % L + L) % L; if (len < 0.25) len = 0.25;
  let s = h.s; if (q) { s = (Math.round(s / q) * q) % L; len = Math.max(q, Math.round(len / q) * q); }
  if (recFirst) { pushUndo(); if (!S.rec.overdub) P.notes = []; recFirst = false; }
  P.notes.push({ s, l: len, m: h.midi, v: h.vel });
  save(); drawGrid(); drawRoll();
}
function recAuto(a) {
  const i = S.selTrack; if (!recording(i)) return;
  const P = T(i).pats[play[i].cur];
  if (!recTouched) { recTouched = true; pushUndo(); if (!S.rec.overdub) P.auto = []; }
  P.auto.push({ s: Math.round(posNow(i) * 8) / 8, ...a });
  if (P.auto.length > 4000) P.auto.splice(0, P.auto.length - 4000);
  save(); drawLane();
}

/* ---------- sound patterns: Track 2 (the AIR loop) and Audio patterns on Tracks 1, 3-5, one take per pattern ---------- */
// REC + Play on one: after the count-in the track's sound is recorded (raw, before its inserts / fader) until Stop or
// REC (at most 2 minutes). The take replaces the one before and is fitted to the pattern's length (Fit, below).
// Takes are kept in this browser (IndexedDB "photoSynthDub"); the session only keeps their key.
const TDB = (() => {
  let db;
  const open = () => (db ||= new Promise((res, rej) => { const r = indexedDB.open('photoSynthDub', 1); r.onupgradeneeded = () => r.result.createObjectStore('takes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const run = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('takes', mode), q = fn(t.objectStore('takes')); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
  return { put: (k, v) => run('readwrite', (s) => s.put(v, k)), get: (k) => run('readonly', (s) => s.get(k)), keys: () => run('readonly', (s) => s.getAllKeys()), del: (k) => run('readwrite', (s) => s.delete(k)) };
})();
const takes = new Map(), peaks = new Map(), takeSrc = new Set();
let takeRec = null, loopMsg = '';
const toBuf = (d) => { const b = ctx.createBuffer(2, d.l.length, d.sr); b.copyToChannel(d.l, 0); b.copyToChannel(d.r, 1); return b; };
async function loadTakes() {
  const used = new Set(); S.tracks.forEach((tk, i) => { if (!TRACKS[i].slicer) tk.pats.forEach((P) => P.take && used.add(P.take)); });
  for (const k of used) { if (takes.has(k)) continue; const d = await TDB.get(k).catch(() => null); if (d) takes.set(k, toBuf(d)); }
  for (const k of await TDB.keys().catch(() => [])) if (!used.has(k)) TDB.del(k).catch(() => {}); // takes nothing points to any more
  S.tracks.forEach((tk, i) => tk.pats.forEach((P) => isAud(i, P) && P.take && queueFit(P)));
  drawGrid(); drawRoll();
}
function startTake(i) {
  const P = pat(i), len = Math.round(120 * ctx.sampleRate); // free length: until Stop or REC (at most 2 minutes); it is fitted to the pattern afterwards
  pushUndo();
  takeRec = { i, P, len, view: Math.round(patSteps(P) * stepDur() * ctx.sampleRate), pk: [] };
  A[i].take.port.postMessage({ at: Math.round(tr.start * ctx.sampleRate), len });
  if (TRACKS[i].audio && !eng[i]?.api?.loopOn) loopCtl(i, true); // Track 2: the AIR loop starts with the count-in (the others record what is played)
}
function onTake(i, d) {
  if (d.pk != null) { if (takeRec?.i === i) { takeRec.pk.push(d.pk); takeRec.got = d.at; } return; } // live picture while recording
  const r = takeRec; takeRec = null; if (!r || r.i !== i) return;
  const key = 't' + Date.now().toString(36), sr = ctx.sampleRate;
  recArmed = false; tr.rec = false;
  if (d.l.length < 0.3 * sr) { drawAll(); return; } // too short to use
  takes.set(key, toBuf({ sr, l: d.l, r: d.r })); r.P.take = key; delete r.P.fr; // a new take: all of it again
  TDB.put(key, { sr, l: d.l, r: d.r }).catch(() => {});
  save(); queueFit(r.P); // fitted to the pattern's length; it plays from the next pass
  drawAll();
}
// Fit: a take (any length) is stretched or squeezed to the pattern's length without changing its pitch (WSOLA, done in
// fit-worker.js so the playing is not held up). It is redone
// when the pattern's length or the tempo changes. The result runs 0.25 s past the pattern, continuing into the take's
// start, for the loop seam's cross-fade. Until it is ready, the take plays as recorded.
// Range (P.fr = [start, end] in seconds of the take; none = all of it): only that part is fitted (or, with Original,
// played as recorded). Chosen by dragging on the wave, which always shows the whole take as recorded.
const FIT_TAIL = 0.25, fits = new Map(), bufKeys = new WeakMap();
const fitFrames = (P) => Math.round(P.len * 16 * stepDur() * ctx.sampleRate);
const rangeId = (P) => (P.fr ? `|${P.fr[0].toFixed(3)}-${P.fr[1].toFixed(3)}` : '');
const fitId = (P) => `${P.take}|${fitFrames(P)}${rangeId(P)}`;
const keyOf = (b, P) => bufKeys.get(b) ?? P.take; // a name for a buffer (caches of peaks, reversed copies, pitch)
const frOf = (P, raw) => (P.fr ? [clamp(P.fr[0], 0, raw.duration), clamp(P.fr[1], 0, raw.duration)] : [0, raw.duration]);
function cutBuf(raw, a, b) { // that part of a take, as its own buffer
  const sr = raw.sampleRate, s0 = Math.round(a * sr), n = Math.max(1, Math.round(b * sr) - s0), out = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) out.copyToChannel(raw.getChannelData(c).subarray(s0, s0 + n), c);
  return out;
}
function bufOf(P) { // the buffer to play for a sound pattern: its fitted range (or the take itself while that is being made)
  const raw = takes.get(P.take); if (!raw) return null;
  if (P.orig) { // Original: as recorded (from the pattern's top; cut at its end, or silent after a short take)
    if (!P.fr) return raw;
    const id = 'o|' + P.take + rangeId(P); let f = fits.get(id);
    if (!f) { const [a, b] = frOf(P, raw); f = cutBuf(raw, a, b); fits.set(id, f); bufKeys.set(f, id); }
    return f;
  }
  const f = fits.get(fitId(P)); if (f) return f;
  queueFit(P); return raw;
}
const fitQ = new Set(); let fitT = 0;
function queueFit(P) { if (!ctx || !P.take) return; fitQ.add(P); clearTimeout(fitT); fitT = setTimeout(runFits, 40); }
// one fit at a time in the worker; while it works, newer requests wait (a tempo drag only fits the tempo it stops at)
const fitW = new Worker('fit-worker.js?v=1', { type: 'module' }); let fitBusy = null;
fitW.onmessage = ({ data: { id, l, r, sr } }) => {
  fitBusy = null;
  const b = ctx.createBuffer(2, l.length, sr); b.copyToChannel(l, 0); b.copyToChannel(r, 1);
  fits.set(id, b); bufKeys.set(b, id); runFits();
};
function runFits() {
  if (fitBusy) return;
  for (const P of fitQ) {
    fitQ.delete(P);
    const raw = takes.get(P.take), id = fitId(P); if (!raw || fits.has(id)) continue;
    const n = Math.round(P.len * 16 * stepDur() * raw.sampleRate), tail = Math.round(FIT_TAIL * raw.sampleRate); // in the take's own rate (one from another machine may differ)
    const same = !P.fr && (Math.abs(raw.length - n) < n * 0.003 || Math.abs(raw.length - n - tail) < n * 0.003); // already that long (older takes carry their tail)
    if (same) { fits.set(id, raw); continue; }
    const [a, e] = frOf(P, raw), s0 = Math.round(a * raw.sampleRate), s1 = Math.max(s0 + 1, Math.round(e * raw.sampleRate)); // the range (past its end the tail goes on from its start)
    const L = raw.getChannelData(0).slice(s0, s1), R = raw.getChannelData(1).slice(s0, s1);
    fitBusy = id; fitW.postMessage({ id, L, R, n, tail, sr: raw.sampleRate }, [L.buffer, R.buffer]);
    return;
  }
  pruneFits(); drawRoll();
}
function pruneFits() { // keep only the fitted / cut buffers some pattern plays now (and their reversed copies)
  const live = new Set();
  S.tracks.forEach((tk, i) => tk.pats.forEach((P) => { if (isAud(i, P) && P.take) live.add(P.orig ? 'o|' + P.take + rangeId(P) : fitId(P)); }));
  let gone = false;
  for (const id of fits.keys()) if (!live.has(id)) { fits.delete(id); gone = true; }
  for (const id of revBufs.keys()) if (id.includes('|') && !live.has(id)) revBufs.delete(id);
  if (gone) pieceRates.clear(); // measured on buffers that are gone; measured again when needed
}
onBpm(() => S.tracks.forEach((tk, i) => tk.pats.forEach((P) => isAud(i, P) && P.take && queueFit(P)))); // the bars got longer / shorter
// One pass of a sound pattern. At the seam the next pass fades in (equal-power, over the chosen fade time) while this
// one fades out over the same time, ringing on into the fitted take's tail (it runs 0.25 s past the pattern).
const EQP = (up) => Float32Array.from({ length: 32 }, (_, k) => (up ? Math.sin : Math.cos)((Math.PI / 2) * (k / 31)));
function playPass(i, P, when, dur) {
  const b = bufOf(P); if (!b) return;
  const W = Math.min(P.fade ?? 0.1, dur / 2), tail = Math.min(W, Math.max(0, b.duration - dur)), late = Math.max(0, ctx.currentTime - when);
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.connect(g).connect(A[i].input); s._i = i; s._g = g;
  g.gain.setValueAtTime(0, when); g.gain.setValueCurveAtTime(EQP(true), when + late, Math.max(0.004, W - late));
  g.gain.setValueCurveAtTime(EQP(false), when + dur, Math.max(0.004, tail)); // ends with the audio there is
  s.start(when + late, late, dur + Math.max(tail, 0.004) - late);
  takeSrc.add(s); s.onended = () => takeSrc.delete(s);
  A[i].mon.gain.setValueAtTime(0, when);
}
function stopSrc(s, t) { // a short fade to 0 ending at t, then stop (a cut in the middle of a sound would click)
  const F = 0.008, t0 = Math.max(ctx.currentTime, t - F);
  try { if (s._g) { s._g.gain.cancelAndHoldAtTime(t0); s._g.gain.linearRampToValueAtTime(0, t0 + F); } s.stop(t0 + F + 0.002); } catch {}
}
function stopTakes() {
  if (!ctx) return;
  for (const s of takeSrc) stopSrc(s, ctx.currentTime); takeSrc.clear();
  if (takeRec) A[takeRec.i].take.port.postMessage({ stop: true }); // the recorder sends back what it has (onTake keeps it)
  A.forEach((a) => a?.mon?.gain.cancelScheduledValues(ctx.currentTime)); A.forEach((a) => a?.mon && (a.mon.gain.value = 1));
}
// the AIR loop in the hidden page
async function loopCtl(i, on) {
  const a = eng[i]?.api; if (!a) return;
  loopMsg = '';
  if (on) {
    if (a.S.loopMode === 'wander' ? !a.photos?.length : !a.scenes.length) { loopMsg = a.S.loopMode === 'wander' ? 'No photo yet — add one on the AIR page.' : 'No scenes yet — add scenes on the AIR page (Loop screen), or use Flow.'; drawRoll(); return; }
    await audio(); await a.startLoop();
  } else a.stopLoop();
  drawEdHead(); drawRoll();
}
function setLoopMode(i, m) {
  const d = docOf(i), a = eng[i]?.api; if (!d || !a) return;
  const was = a.loopOn;
  d.querySelector(`[data-loopmode="${m}"]`)?.click(); // stops the loop
  T(i).loopMode = m; save();
  if (was) loopCtl(i, true); else { drawEdHead(); drawRoll(); }
}
function peaksOf(key, b, w) {
  let p = peaks.get(key); if (p && p.length === w) return p;
  p = new Float32Array(w); const l = b.getChannelData(0), r = b.getChannelData(1), per = l.length / w;
  for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.floor(x * per), e = Math.floor((x + 1) * per); k < e; k++) m = Math.max(m, Math.abs(l[k]), Math.abs(r[k])); p[x] = m; }
  peaks.set(key, p); return p;
}
function drawTake(P, gw) {
  const L = P.len * 16, sx = gw / L; // always the whole take
  rg.fillStyle = '#d3da9f'; rg.fillRect(KEYW, 0, gw, RH);
  for (let s = 0; s <= L; s += 4) { rg.fillStyle = s % 16 === 0 ? 'rgba(27,42,19,.6)' : 'rgba(27,42,19,.15)'; rg.fillRect(KEYW + s * sx - 0.25, 0, s % 16 === 0 ? 1 : 0.5, RH); }
  rg.font = '10px UIDigits, Syne, sans-serif';
  const b = P.take && takes.get(P.take), mid = RH / 2;
  if (takeRec && takeRec.P === P) {
    const pk = takeRec.pk, w = gw / Math.max(pk.length, takeRec.view / 2048); rg.fillStyle = '#1b2a13'; // squeezes to fit as it grows
    for (let k = 0; k < pk.length; k++) { const h = Math.max(0.5, Math.min(1, pk[k] * 1.4) * (mid - 6)); rg.fillRect(KEYW + k * w, mid - h, Math.max(1, w), h * 2); }
    rg.fillStyle = '#e9282b'; rg.fillText(`Recording… ${((takeRec.got || 0) / ctx.sampleRate).toFixed(1)} s — Stop or REC ends it, then it is fitted to ${P.len} bar${P.len > 1 ? 's' : ''}`, KEYW + 8, 14);
  }
  else if (b) { // the whole take as recorded; the range (the part that is played) is framed, the rest shaded
    const raw = b, pk = peaksOf(P.take, raw, Math.round(gw)), [a, e] = frOf(P, raw), tx = (t) => KEYW + (t / raw.duration) * gw;
    rg.fillStyle = '#d3da9f'; rg.fillRect(KEYW, 0, gw, RH);
    rg.fillStyle = '#1b2a13'; for (let x = 0; x < pk.length; x++) { const h = Math.max(0.5, Math.min(1, pk[x] * 1.4) * (mid - 6)); rg.fillRect(KEYW + x, mid - h, 1, h * 2); }
    const x0 = tx(a), x1 = tx(e);
    rg.fillStyle = 'rgba(211,218,159,.75)'; rg.fillRect(KEYW, 0, x0 - KEYW, RH); rg.fillRect(x1, 0, KEYW + gw - x1, RH);
    rg.strokeStyle = '#1b2a13'; rg.lineWidth = 1.5; rg.strokeRect(x0 + 0.75, 0.75, Math.max(1, x1 - x0 - 1.5), RH - 1.5);
    if (!P.orig) for (let k = 1; k < P.len; k++) { rg.fillStyle = 'rgba(27,42,19,.45)'; rg.fillRect(x0 + ((x1 - x0) * k) / P.len - 0.5, 0, 1, 8); } // where the bars fall once fitted
    rg.fillStyle = '#1b2a13'; rg.fillText(`${a.toFixed(2)}–${e.toFixed(2)} s`, Math.min(x0 + 4, KEYW + gw - 70), RH - 6);
    const i = S.selTrack;
    if (tr.on && play[i].cur === T(i).sel) { const pos = posNow(i); if (pos != null) { const t = P.orig ? a + pos * stepDur() : a + (pos / L) * (e - a); if (t <= e) { rg.fillStyle = '#e9282b'; rg.fillRect(tx(t), 0, 1.5, RH); } } }
  } else { rg.fillStyle = '#6b7a3a'; rg.fillText(P.take ? 'Loading the take…' : `Empty. REC + Play records this track's sound (${TRACKS[S.selTrack].audio ? 'the AIR loop' : 'what you play on the keys'}) for the pattern length.`, KEYW + 8, 14); }
  if (loopMsg) { rg.fillStyle = '#e9282b'; rg.fillText(loopMsg, KEYW + 8, 28); } // the loop could not start (the Play / Stop button shows its state)
}
// the range on the take: drag across the wave for a new one, or drag its edge; a double-click takes all of it again
let rangeDrag = null;
const takeTime = (e, raw) => { const { x } = cellAt(e); return clamp(((x - KEYW) / (RW - KEYW)) * raw.duration, 0, raw.duration); };

/* ---------- undo / copy ---------- */
const undo = [];
function pushUndo() { const i = S.selTrack; undo.push({ i, p: T(i).sel, d: JSON.stringify(pat(i)) }); if (undo.length > 50) undo.shift(); }
function doUndo() { const u = undo.pop(); if (!u) return; T(u.i).pats[u.p] = JSON.parse(u.d); save(); drawAll(); }
let clip = null;

/* ---------- drawing: transport ---------- */
function drawTransport(countG) {
  const on = tr.on;
  $('.js-play').classList.toggle('is-on', on); $('.js-play2').classList.toggle('on', on); $('.js-play2').textContent = on ? 'Stop' : 'Play';
  $('.js-rec').classList.toggle('on', recArmed);
  $('.js-count').classList.toggle('on', !!S.rec.count); $('.js-click').classList.toggle('on', !!S.rec.click);
  $('.js-bpm').textContent = getBpm();
  $('.js-sname').textContent = S.name;
  const i = S.selTrack, P = pat(i);
  let txt;
  if (countG != null && countG < 0) txt = `Count ${Math.floor((countG + 16) / 4) + 1}`;
  else if (on && play[i].cur >= 0) { const pos = posNow(i) ?? 0; txt = `Bar ${Math.floor(pos / 16) + 1} / ${playingPat(i).len}`; }
  else txt = `Bar 1 / ${P.len}`;
  $('.js-pos').textContent = txt;
}
$('.js-play').addEventListener('click', startStop);
$('.js-play2').addEventListener('click', startStop);
$('.js-rec').addEventListener('click', () => { if (takeRec && recArmed) A[takeRec.i].take.port.postMessage({ stop: true }); recArmed = !recArmed; // REC again while recording sound: that ends the take
  recFirst = true; recTouched = false; tr.rec = recArmed; audio(); drawTransport(); });
$('.js-count').addEventListener('click', () => { S.rec.count = S.rec.count ? 0 : 1; save(); drawTransport(); });
$('.js-click').addEventListener('click', () => { S.rec.click = S.rec.click ? 0 : 1; save(); drawTransport(); });
const rename = () => { const n = (prompt('Session の名前', S.name) || '').trim(); if (n) { S.name = n; save(); drawTransport(); } };
$('.js-sname').addEventListener('click', rename);
$('.js-m-rename').addEventListener('click', rename);
$('.js-m-new').addEventListener('click', () => { if (!confirm('今の Session のパターンと設定を全部消して、新しくしますか?')) return; stop(); S = DEFAULT(); save(); drawAll(); eng.forEach((e, i) => e && applySound(i)); });
$('.js-m-panic').addEventListener('click', () => { stop(); });
$('.js-menu').addEventListener('click', () => { $('.js-menubox').hidden = !$('.js-menubox').hidden; });
projectButton($('.ui-project')); // Save / Open Project (everything, one file)
{ // BPM: drag up/down, double-click to type
  const b = $('.js-bpm'); let d = null;
  b.addEventListener('pointerdown', (e) => { d = { y: e.clientY, v: getBpm() }; b.setPointerCapture(e.pointerId); });
  b.addEventListener('pointermove', (e) => { if (d) setBpm(d.v + Math.round((d.y - e.clientY) / 3)); });
  b.addEventListener('pointerup', () => (d = null));
  b.addEventListener('dblclick', () => { const v = prompt('BPM(60〜200)', getBpm()); if (v) setBpm(v); });
}
$('.js-vol').addEventListener('input', (e) => { if (master) master.gain.value = +e.target.value; $('.js-volv').textContent = Math.round(20 * Math.log10(Math.max(0.001, +e.target.value))) + 'dB'; });
$('.js-volv').textContent = Math.round(20 * Math.log10(0.8)) + 'dB';

/* ---------- drawing: grid ---------- */
function drawGrid() {
  const box = $('.js-grid');
  const head = `<div class="dub-grow dub-grow--head"><span>Track</span>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<span>${n}</span>`).join('')}<span>■</span><span>M</span><span>S</span></div>`;
  box.innerHTML = head + TRACKS.map((t, i) => {
    const tk = T(i), p = play[i];
    const sub = t.slicer ? 'Src ' + (pat(i).src.map((v, k) => (v ? k + 1 : '')).filter(Boolean).join(' ') || '—') : (tk.sound?.name || t.mode + '-Basic');
    const cells = tk.pats.map((P, k) => {
      const cls = ['dub-cell'];
      if (filled(i, k)) cls.push('is-fill');
      if (p.cur === k) cls.push(tr.on ? 'is-play' : 'is-armed'); // playing (with how far it is) / plays when Play is pressed
      if (p.next === k) cls.push('is-queue');
      if (tk.sel === k && i === S.selTrack) cls.push('is-edit'); // the pattern in the editor below
      return `<button class="${cls.join(' ')}" type="button" data-cell="${i}:${k}">${k + 1}</button>`;
    }).join('');
    const stopQ = p.next === -1 ? ' is-queue' : '';
    return `<div class="dub-grow${i === S.selTrack ? ' is-sel' : ''}${stopQ}" data-row="${i}"><b>${t.n}<i class="dub-lamp" data-lamp="${i}"></i></b><span class="dub-gname" title="${esc(t.name + ' · ' + sub)}"><span>${esc(t.name)}${t.free ? ` · ${pat(i).len}b` : ''}</span><small>${esc(sub)}</small></span>${cells}<button class="dub-ms dub-stopt${p.next === -1 ? ' is-q' : ''}" data-stopt="${i}" type="button" title="このトラックを止めてパターンの選択を外す(再生中は次の小節の頭で。もう一度押すと取り消し)"${p.cur >= 0 || (!tr.on && p.next >= 0) ? '' : ' disabled'}>■</button><button class="dub-ms${tk.mute ? ' on' : ''}" data-mute="${i}" type="button">M</button><button class="dub-ms${tk.solo ? ' on' : ''}" data-solo="${i}" type="button">S</button></div>`;
  }).join('');
  live = TRACKS.map((t, i) => ({ lamp: box.querySelector(`[data-lamp="${i}"]`), cell: box.querySelector(`.dub-cell.is-play[data-cell^="${i}:"]`) })); // for gridLive
}
$('.js-grid').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cell]'), m = e.target.closest('[data-mute]'), so = e.target.closest('[data-solo]'), row = e.target.closest('[data-row]');
  const sp = e.target.closest('[data-stopt]'); if (sp) { const p = play[+sp.dataset.stopt]; if (tr.on) p.next = p.next === -1 ? undefined : -1; else { p.cur = -1; p.next = undefined; } drawGrid(); return; } // playing: stop at the next bar, its pattern deselected / stopped: deselect it
  if (m) { const t = T(+m.dataset.mute); t.mute = t.mute ? 0 : 1; applyMix(); save(); drawGrid(); return; }
  if (so) { const t = T(+so.dataset.solo); t.solo = t.solo ? 0 : 1; applyMix(); save(); drawGrid(); return; }
  if (c) {
    const [i, k] = c.dataset.cell.split(':').map(Number), p = play[i];
    S.selTrack = i; T(i).sel = k; recFirst = true; recTouched = false;
    if (TRACKS[i].slicer && pat(i, k).seed == null) { pat(i, k).seed = Math.floor(Math.random() * 10000); }
    if (!e.shiftKey) { // launch (shift = only open it in the editor)
      if (tr.on) p.next = p.cur === k && p.next === undefined ? -1 : k;
      else p.next = p.next === k ? undefined : k;
      if (!tr.on) p.cur = -1;
    }
    audio(); save(); drawAll(); return;
  }
  if (row) { S.selTrack = +row.dataset.row; save(); drawAll(); }
});

/* ---------- drawing: pattern editor (piano roll / slice map) ---------- */
const roll = $('.js-roll'), rg = roll.getContext('2d'), RW = 640, KEYW = 28;
let RH = 164;
let top = 72, drag = null; // top = highest pitch shown; 24 rows
const ROWS = 12;
let rowH = RH / ROWS;
function sizeRoll() { RH = Math.max(60, Math.round(164 - fitD / 3)); rowH = RH / ROWS; roll.height = RH * 2; drawRoll(); }
addEventListener('resize', sizeRoll);
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function drawRoll() {
  const i = S.selTrack, P = pat(i), L = patSteps(P), gw = RW - KEYW, sx = gw / L;
  rg.setTransform(2, 0, 0, 2, 0, 0); rg.clearRect(0, 0, RW, RH);
  const edT = $('.js-edttl'); edT.textContent = `T${TRACKS[i].n} · P${T(i).sel + 1}`; edT.title = `Track ${TRACKS[i].n} (${TRACKS[i].name}) — Pattern ${T(i).sel + 1}`; // short: the head also holds MIDI / Audio
  if (TRACKS[i].slicer) { drawSliceMap(P, gw); return; }
  if (isAud(i, P)) { drawTake(P, gw); return; }
  for (let r = 0; r < ROWS; r++) {
    const m = top - r, y = r * rowH;
    rg.fillStyle = isBlack(m) ? '#c8d08f' : '#d3da9f'; rg.fillRect(KEYW, y, gw, rowH);
    rg.fillStyle = isBlack(m) ? '#1b2a13' : '#e0e6b4'; rg.fillRect(0, y, KEYW - 2, rowH - 0.5);
    if (m % 12 === 0) { rg.fillStyle = '#1b2a13'; rg.font = '8px UIDigits, Syne, sans-serif'; rg.fillText('C' + (m / 12 - 1), 2, y + rowH - 1); rg.fillStyle = 'rgba(27,42,19,.25)'; rg.fillRect(KEYW, y + rowH - 0.5, gw, 0.5); }
  }
  const G = gridOf(P), gs = 16 / G;
  if (G !== 16) for (let s = 0; s <= L * G / 16; s++) if (s % G) { rg.fillStyle = 'rgba(27,42,19,.16)'; rg.fillRect(KEYW + s * gs * sx - 0.25, 0, 0.5, RH); } // the pattern's own steps
  for (let s = 0; s <= L; s++) { if (G !== 16 && s % 4) continue; rg.fillStyle = s % 16 === 0 ? '#1b2a13' : s % 4 === 0 ? 'rgba(27,42,19,.35)' : 'rgba(27,42,19,.1)'; rg.fillRect(KEYW + s * sx - (s % 16 === 0 ? 0.5 : 0.25), 0, s % 16 === 0 ? 1 : 0.5, RH); }
  if (G !== 16) for (let s = 0; s < L * G / 16; s++) { rg.fillStyle = 'rgba(233,40,43,.55)'; rg.fillRect(KEYW + s * gs * sx - 0.5, 0, 1, 4); } // ticks on top: where the steps fall against the beat
  for (const n of P.notes) {
    const r = top - n.m; if (r < 0 || r >= ROWS) continue;
    rg.fillStyle = '#1b2a13'; rg.fillRect(KEYW + n.s * sx, r * rowH + 0.5, Math.max(2, n.l * sx - 1), rowH - 1);
  }
  const out = P.notes.filter((n) => top - n.m < 0 || top - n.m >= ROWS).length;
  if (out) { rg.fillStyle = '#6b7a3a'; rg.font = '9px UIDigits, Syne, sans-serif'; rg.fillText(`+${out} notes outside (scroll)`, RW - 110, 10); }
  drawHead();
}
function drawSliceMap(P, gw) {
  const n = P.div, w = gw / n;
  rg.fillStyle = '#d3da9f'; rg.fillRect(KEYW, 0, gw, RH);
  rg.font = '10px UIDigits, Syne, sans-serif';
  if (P.seed == null) { rg.fillStyle = '#6b7a3a'; rg.fillText('Empty. Press Random Slice', KEYW + 12, 20); return; }
  const plan = slicePlan(P, 0);
  plan.forEach((o, k) => {
    const x = KEYW + k * w, h = 20 + (o.from / n) * (RH - 40);
    rg.fillStyle = o.from === k ? '#c8d08f' : '#1b2a13'; rg.fillRect(x + 1, RH - h, w - 2, h);
    if (w > 14) { rg.fillStyle = o.from === k ? '#1b2a13' : '#e0e6b4'; rg.fillText(String(o.from + 1), x + 3, RH - h + 12); }
  });
  rg.fillStyle = '#1b2a13'; rg.fillText('Bar 1 · slice order (height = where it was cut)', KEYW + 6, 12);
  drawHead();
}
function drawHead() {
  const i = S.selTrack; if (!tr.on || play[i].cur !== T(i).sel) return;
  const pos = posNow(i); if (pos == null) return;
  const P = pat(i), L = TRACKS[i].slicer ? 16 : patSteps(P), x = KEYW + ((pos % L) / L) * (RW - KEYW);
  rg.fillStyle = '#e9282b'; rg.fillRect(x, 0, 1.5, RH);
}
const cellAt = (e) => { const r = roll.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * RW, y: ((e.clientY - r.top) / r.height) * RH }; };
roll.addEventListener('wheel', (e) => { if (TRACKS[S.selTrack].slicer || isAud(S.selTrack)) return; e.preventDefault(); top = clamp(top + (e.deltaY > 0 ? -2 : 2), 30, 108); drawRoll(); }, { passive: false });
roll.addEventListener('contextmenu', (e) => e.preventDefault());
roll.addEventListener('pointerdown', (e) => {
  const i = S.selTrack;
  if (isAud(i) && pat(i).take && !takes.get(pat(i).take)) { audio(); return; } // the takes are read once the sound has started
  if (isAud(i) && pat(i).take && takes.get(pat(i).take)) {
    const P = pat(i), raw = takes.get(P.take), t = takeTime(e, raw), [a, b] = frOf(P, raw), px = raw.duration / (RW - KEYW) * 6; // 6 px
    if (e.detail === 2) { if (P.fr) { pushUndo(); delete P.fr; queueFit(P); save(); drawAll(); } return; }
    const was = P.fr ? [...P.fr] : null; // a click without a drag leaves it as it was
    rangeDrag = Math.abs(t - a) < px ? { P, raw, was, fix: b } : Math.abs(t - b) < px ? { P, raw, was, fix: a } : { P, raw, was, fix: t };
    roll.setPointerCapture(e.pointerId); drawRoll(); return;
  }
  if (TRACKS[i].slicer || isAud(i)) return;
  const P = pat(i), L = patSteps(P), gw = RW - KEYW, sx = gw / L, { x, y } = cellAt(e);
  if (x < KEYW) { const m = top - Math.floor(y / rowH); audio(); const id = 'pv' + noteSeq++; noteOn(i, id, m); setTimeout(() => noteOff(i, id), 300); return; }
  const s = (x - KEYW) / sx, m = top - Math.floor(y / rowH), q = snapOf(P, QUANT[S.rec.quant][1] || 1);
  const hit = P.notes.find((n) => n.m === m && s >= n.s && s <= n.s + n.l);
  pushUndo();
  if (hit && (e.button === 2 || e.altKey || e.detail === 2)) { P.notes.splice(P.notes.indexOf(hit), 1); save(); drawRoll(); drawGrid(); return; }
  if (hit) {
    const edge = (hit.s + hit.l - s) * sx < 6;
    drag = { n: hit, mode: edge ? 'len' : 'move', s0: s, m0: m, ns: hit.s, nm: hit.m, nl: hit.l, q, L };
  } else {
    const ns = Math.floor(s / q + 1e-6) * q, n = { s: ns, l: q, m, v: 0.9 };
    P.notes.push(n); drag = { n, mode: 'len', s0: ns, m0: m, ns, nm: m, nl: q, q, L };
    audio(); const id = 'pv' + noteSeq++; noteOn(i, id, m); setTimeout(() => noteOff(i, id), 250);
  }
  roll.setPointerCapture(e.pointerId); drawRoll(); drawGrid();
});
roll.addEventListener('pointermove', (e) => {
  if (rangeDrag) { const d = rangeDrag, t = takeTime(e, d.raw); if (Math.abs(t - d.fix) * (RW - KEYW) / d.raw.duration < 3 && !d.moved) return; d.moved = true; d.P.fr = [Math.min(d.fix, t), Math.max(d.fix, t)]; drawRoll(); return; }
  if (!drag) return;
  const P = pat(S.selTrack), sx = (RW - KEYW) / patSteps(P), { x, y } = cellAt(e), s = (x - KEYW) / sx, m = top - Math.floor(y / rowH), d = drag;
  if (d.mode === 'len') d.n.l = Math.max(d.q, Math.round((s - d.n.s) / d.q) * d.q);
  else { d.n.s = clamp(Math.round((d.ns + s - d.s0) / d.q) * d.q, 0, d.L - d.q); d.n.m = clamp(d.nm + (m - d.m0), 0, 127); }
  drawRoll();
});
roll.addEventListener('pointerup', () => {
  if (rangeDrag) { // the new range (too short = unchanged; all of it = none), with one undo point for the whole drag
    const { P, raw, was, moved } = rangeDrag; rangeDrag = null; if (!moved) return;
    let fr = P.fr[1] - P.fr[0] < 0.1 ? was : P.fr; if (fr && fr[0] < 0.01 && fr[1] > raw.duration - 0.01) fr = null;
    if (fr) P.fr = fr; else delete P.fr;
    if (JSON.stringify(fr) !== JSON.stringify(was)) { const now = P.fr; if (was) P.fr = was; else delete P.fr; pushUndo(); if (now) P.fr = now; else delete P.fr; }
    queueFit(P); save(); drawAll(); return;
  } if (drag) { drag = null; save(); drawGrid(); } });

// pattern settings
function drawEdHead() {
  const i = S.selTrack, P = pat(i), t = TRACKS[i];
  $('.js-lens').innerHTML = t.free ? `<input class="dub-num js-freelen" type="number" min="1" max="64" value="${P.len}"><span class="dub-lbl">bars</span>`
    : (t.slicer ? [1, 2, 4] : LENS).map((n) => opt('len', n, n, P.len === n)).join('');
  const aud = isAud(i, P);
  $('.js-kind').innerHTML = t.slicer || t.audio ? '' : `${opt('kind', 'notes', 'MIDI', !aud, '音符で録る(あとで直せる)')}${opt('kind', 'audio', 'Audio', aud, '音で録る(弾いた音をそのまま録って、ループで鳴らす)')}`;
  const lo = t.audio && eng[i]?.api, lm = lo ? lo.S.loopMode : 'scenes';
  $('.js-quant').innerHTML = aud && !t.audio ? (P.take ? opt('aclr', 1, 'Clear', 0, '録った音を消す') : '<span class="dub-lbl">REC + Play</span>')
    : t.audio
    ? `<button class="ui-opt${lo?.loopOn ? ' on' : ''}" type="button" data-aloop title="AIR のループを鳴らす/止める(録るのはこの音)">${lo?.loopOn ? '■ Stop' : '▶ Play'}</button>${opt('amode', 'scenes', 'Route', lm === 'scenes', 'シーンを順に')}${opt('amode', 'wander', 'Flow', lm === 'wander', 'さまよう')}${P.take ? opt('aclr', 1, 'Clear', 0, '録った音を消す') : ''}`
    : t.slicer ? DIVS.map((d) => opt('div', d, '1/' + d, P.div === d, '切る細かさ')).join('') : QUANT.map(([l], k) => opt('quant', k, l, S.rec.quant === k)).join('');
  $('.js-qlbl').textContent = t.audio ? 'Loop' : aud ? 'Take' : t.slicer ? 'Slice' : 'Quantize';
  $('.js-gridw').hidden = aud || t.slicer || t.audio; $('.js-gridsel').value = gridOf(P);
  $('.js-odr').hidden = aud; // a take is always replaced
  $('[data-odr]').textContent = S.rec.overdub ? 'Overdub' : 'Replace'; // one button: shows the mode, a press switches it
}
$('.dub-ed__head').addEventListener('click', (e) => {
  const i = S.selTrack, P = pat(i), b = e.target.closest('button'); if (!b) return;
  if (b.dataset.aloop != null) { loopCtl(i, !eng[i]?.api?.loopOn); return; }
  if (b.dataset.amode) { setLoopMode(i, b.dataset.amode); return; }
  if (b.dataset.aclr != null) { pushUndo(); P.take = null; }
  if (b.dataset.kind) { pushUndo(); if (b.dataset.kind === 'audio') P.kind = 'audio'; else delete P.kind; } // the notes and the take are both kept
  if (b.dataset.len) { pushUndo(); P.len = +b.dataset.len; queueFit(P); }
  if (b.dataset.quant != null) S.rec.quant = +b.dataset.quant;
  if (b.dataset.div) { P.div = +b.dataset.div; }
  if (b.dataset.odr != null) S.rec.overdub = S.rec.overdub ? 0 : 1;
  save(); drawAll();
});
$('.dub-ed__head').addEventListener('change', (e) => { if (e.target.matches('.js-gridsel')) { pushUndo(); const P = pat(S.selTrack), g = +e.target.value; if (g === 16) delete P.grid; else P.grid = g; save(); drawAll(); return; } if (e.target.matches('.js-freelen')) { pushUndo(); const P = pat(S.selTrack); P.len = clamp(Math.round(+e.target.value) || 1, 1, 64); queueFit(P); save(); drawAll(); } });

// automation lane
const lane = $('.js-lane'), lg2 = lane.getContext('2d'), LW = 612, LH = 32;
function drawLane() {
  lg2.setTransform(2, 0, 0, 2, 0, 0); lg2.clearRect(0, 0, LW, LH);
  const i = S.selTrack; if (TRACKS[i].slicer) return;
  const P = pat(i), L = patSteps(P), xy = P.auto.filter((a) => a.k === 'xy').sort((a, b) => a.s - b.s);
  const line = (key, col) => { if (!xy.length) return; lg2.strokeStyle = col; lg2.lineWidth = 1.2; lg2.beginPath(); xy.forEach((a, k) => { const x = (a.s / L) * LW, y = LH - 2 - a[key] * (LH - 4); k ? lg2.lineTo(x, y) : lg2.moveTo(x, y); }); lg2.stroke(); };
  line('x', '#f39a1d'); line('y', '#1b2a13');
  for (const a of xy) { const x = (a.s / L) * LW; lg2.fillStyle = '#f39a1d'; lg2.fillRect(x - 1, LH - 3 - a.x * (LH - 4), 2, 2); lg2.fillStyle = '#1b2a13'; lg2.fillRect(x - 1, LH - 3 - a.y * (LH - 4), 2, 2); }
  for (const a of P.auto) { if (a.k === 'xy' || !a.v) continue; lg2.fillStyle = a.k === 'drop' ? '#e9282b' : a.k === 'fb' ? '#f39a1d' : '#a0b357'; lg2.fillRect((a.s / L) * LW, 0, 2, LH); }
  if (!P.auto.length) { lg2.fillStyle = '#6b7a3a'; lg2.font = '9px Syne, sans-serif'; lg2.fillText('REC + move the XY pad (or hold Throw / Drop / Feedback)', 6, 19); }
}
$('.js-laneclr').addEventListener('click', () => { pushUndo(); pat(S.selTrack).auto = []; save(); drawLane(); drawGrid(); });

/* ---------- right column: the selected track ---------- */
let selFx = 'phaser'; // which effect the panel shows: an insert type, a return key, or 'master'
const sliderRow = (key, label, val, txt, hint, min = 0, max = 1, step = 0.01) => `<div class="row"><span${hint ? ` data-hint="${esc(hint)}"` : ''}>${label}</span><input type="range" data-p="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><b data-pv="${key}">${txt}</b></div>`;
function drawCol() {
  const i = S.selTrack, t = TRACKS[i], tk = T(i), col = $('.js-col');
  let h = `<div class="dub-col__ttl">Track ${t.n} · ${esc(t.name)}</div>`;
  if (t.slicer) {
    const P = pat(i);
    const used = slicePool(P).length;
    h += `<div class="dub-sec"><span class="dub-lbl" data-hint="切る素材のトラック(複数可)。そのトラックの中身のあるパターン全部(録音は音、MIDI は音符)を切り分けて、ランダムに並べる。空のパターンは使わない。MIDI の断片はそのトラックの楽器で鳴る(そのトラックが音を録音している間は、録音に混ざらないよう鳴らさない)">Source</span><div class="dub-opts">${[0, 1, 2, 3, 4].map((k) => opt('src', k, k + 1, P.src[k])).join('')}</div><span class="dub-lbl">${used ? `${used} pattern${used > 1 ? 's' : ''} to cut from` : 'No filled patterns on these tracks'}</span></div>
      <div class="dub-sec"><button class="dub-big js-rand" type="button" title="並べ替えを新しく決める(このパターンに保存。もう一度押すまで同じ並べ替えをくり返す)">Random Slice</button><span class="dub-seed">seed ${P.seed == null ? '—' : String(P.seed).padStart(4, '0')}</span></div>
      <div class="dub-two">${sliderRow('s.amt', 'Random', P.amt, Math.round(P.amt * 100) + '%', 'ランダムの量。0=元の並び、100=全部ばらばら')}${sliderRow('s.rev', 'Reverse', P.rev, Math.round(P.rev * 100) + '%', '逆再生になる断片の割合')}</div>
      <div class="dub-sec"><span class="dub-lbl" data-hint="切った断片の音の高さを、選んだキーの音階に寄せる(再生速度ごと変えるので、少し長さと音色も変わる)。高さのはっきりしない断片(ノイズ・打音)はそのまま">Pitch Even</span><div class="dub-opts">${opt('pe', 1, P.pe ? 'On' : 'Off', !!P.pe)}<select class="js-pkey" title="キー"${P.pe ? '' : ' disabled'}>${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n, k) => `<option value="${k}"${(P.key || 0) === k ? ' selected' : ''}>${n}</option>`).join('')}</select>${opt('pscale', 'major', 'Major', P.scale !== 'minor')}${opt('pscale', 'minor', 'Minor', P.scale === 'minor')}</div></div>`;
  } else {
    const list = savedSounds(i), M = MODES[t.mode], TP = pat(i);
    if (isAud(i, TP) && TP.take) h += `<div class="dub-sec"><span class="dub-lbl" data-hint="Fit = 録った音を音の高さを保ったまま伸び縮みさせて、パターンの長さにぴったり合わせる / Original = 録ったままの長さと速さ(パターンの頭から鳴らし、長ければ終わりで切る)">Length</span><div class="dub-opts">${opt('tfit', 'fit', 'Fit', !TP.orig, 'パターンの長さに合わせて伸び縮み')}${opt('tfit', 'orig', 'Original', !!TP.orig, '録ったまま')}</div><span class="dub-lbl">${(() => { const raw = takes.get(TP.take); if (!raw) return ''; const [a, b] = frOf(TP, raw); return `${(b - a).toFixed(1)} s ${TP.fr ? 'chosen' : 'recorded'} · pattern ${(TP.len * 16 * stepDur()).toFixed(1)} s`; })()}</span></div>`;
    if (isAud(i, TP) && TP.take) { const raw = takes.get(TP.take), [ra, rb] = raw ? frOf(TP, raw) : [0, 0];
      h += `<div class="dub-sec"><span class="dub-lbl" data-hint="録った音のどこを使うか。波形の上をドラッグして範囲を選ぶ(端をつまむと調整、ダブルクリックで全体に戻す)。Fit ならその範囲がパターンの長さに伸び縮みする。つなぎ目は選んだ長さでクロスフェード">Range</span><div class="dub-opts">${opt('frall', 1, 'Whole', !TP.fr, '録った音の全体を使う')}${[[0.05, '50ms'], [0.1, '100ms'], [0.2, '200ms']].map(([v, l]) => opt('bfade', v, l, (TP.fade ?? 0.1) === v, 'つなぎ目のクロスフェードの長さ')).join('')}</div><span class="dub-lbl">${!raw ? 'Loading the take…' : TP.fr ? `${ra.toFixed(2)}–${rb.toFixed(2)} s (${(rb - ra).toFixed(2)} s) of ${raw.duration.toFixed(1)} s` : 'Drag on the wave to choose a part'}</span></div>`; }
    h += `<div class="dub-sec"><span class="dub-lbl" data-hint="そのモードで保存した Sound から選ぶ。中身ごとコピーして持つので、元の Sound を後で変えても、このフレーズの音は変わりません">Sound</span>
      <div class="dub-sound"><select class="js-sound"><option value="">${t.mode}-Basic</option>${list.map((p, k) => `<option value="${k}"${tk.sound?.name === p.name ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}${tk.sound && !list.some((p) => p.name === tk.sound.name) ? `<option value="keep" selected>${esc(tk.sound.name)} (copy)</option>` : ''}</select><a href="${M.open}" target="_blank" title="${t.mode} を開いて音を作る(Sound + で保存すると、ここの一覧に出ます)">Open in ${t.mode}</a></div></div>
      <div class="dub-sec"><span class="dub-lbl" data-hint="音色を少しだけいじる。細かい設定は各モードに戻って直す">Macro</span><div class="dub-two">${M.macro.map(([n], m) => sliderRow('m.' + m, n, tk.macro[m] ?? macroPos(i, m), (tk.macro[m] ?? macroPos(i, m)).toFixed(2))).join('')}</div></div>`;
  }
  h += `<div class="dub-sec"><span class="dub-lbl" data-hint="このトラックに挿すエフェクト(上から順)。押すと下に設定、スイッチでオン/オフ">Insert</span><div class="dub-ins">${tk.inserts.map((x, k) => `<button class="dub-insb${selFx === x.type ? ' on' : ''}" data-ins="${k}" type="button"><span>${INS[x.type]}</span><i class="dub-sw${x.on ? '' : ' off'}" data-insw="${k}"></i></button>`).join('')}${tk.inserts.length < 3 ? `<span class="dub-insadd"><button class="dub-insb dub-insb--add js-insadd" type="button">+</button><span class="dub-insmenu" hidden>${Object.keys(INS).filter((k) => !tk.inserts.some((x) => x.type === k)).map((k) => `<button data-insnew="${k}" type="button">${INS[k]}</button>`).join('')}</span></span>` : ''}</div></div>
    <div class="dub-sec"><span class="dub-lbl" data-hint="共有の返り(下の4つ)に送る量">Send</span><div class="dub-two">${RET.map(([k, n], s) => sliderRow('send.' + s, n, tk.send[s], tk.send[s].toFixed(2))).join('')}</div></div>
    <div class="dub-sec"><span class="dub-lbl">Mix</span><div class="dub-two">${sliderRow('vol', 'Volume', tk.vol, tk.vol.toFixed(2))}${sliderRow('pan', 'Pan', tk.pan, tk.pan === 0 ? 'C' : (tk.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(tk.pan) * 100), '', -1, 1, 0.01)}</div></div>
    <details class="dub-fold"><summary><i class="ui-chev"></i>Record</summary><div class="dub-opts">${opt('rcount', 1, 'Count 1', S.rec.count, '録るとき1小節カウント')}${opt('rclick', 1, 'Click', S.rec.click, '録るときのクリック')}${opt('rodr', 1, 'Overdub', S.rec.overdub === 1, '重ねて録る')}${opt('rodr', 0, 'Replace', S.rec.overdub === 0, '前の中身を消して録る')}</div></details>
    <details class="dub-fold"><summary><i class="ui-chev"></i>Pattern</summary><div class="dub-opts"><button class="ui-opt js-laneclr2" type="button" title="このパターンの動き(オートメーション)を消す">Clear Lane</button></div></details>`;
  col.innerHTML = h;
  fillAll();
  $('.js-xytrk').textContent = `Phaser · Track ${t.n}`;
}
const colEl = $('.js-col');
colEl.addEventListener('input', (e) => {
  const k = e.target.dataset.p; if (!k) return;
  const i = S.selTrack, tk = T(i), v = +e.target.value, b = $(`[data-pv="${k}"]`, colEl);
  if (k.startsWith('m.')) { const m = +k.slice(2); setMacro(i, m, v); b.textContent = v.toFixed(2); return; }
  if (k.startsWith('send.')) { tk.send[+k.slice(5)] = v; b.textContent = v.toFixed(2); }
  else if (k === 'vol') { tk.vol = v; b.textContent = v.toFixed(2); }
  else if (k === 'pan') { tk.pan = Math.abs(v) < 0.03 ? 0 : v; b.textContent = tk.pan === 0 ? 'C' : (tk.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(tk.pan) * 100); }
  else if (k === 's.amt') { pat(i).amt = v; b.textContent = Math.round(v * 100) + '%'; drawRoll(); }
  else if (k === 's.rev') { pat(i).rev = v; b.textContent = Math.round(v * 100) + '%'; drawRoll(); }
  applyMix(); save();
});
colEl.addEventListener('change', async (e) => {
  if (e.target.matches('.js-pkey')) { pat(S.selTrack).key = +e.target.value; save(); return; }
  if (!e.target.matches('.js-sound')) return;
  const i = S.selTrack, v = e.target.value;
  if (v === 'keep') return;
  const p = v === '' ? null : savedSounds(i)[+v];
  T(i).sound = p ? JSON.parse(JSON.stringify(p)) : null; T(i).macro = [null, null, null, null];
  save(); await applySound(i); drawCol(); drawGrid();
});
colEl.addEventListener('click', (e) => {
  const i = S.selTrack, tk = T(i);
  const rc = e.target.closest('[data-rcount], [data-rclick], [data-rodr]');
  if (rc) { if (rc.dataset.rcount) S.rec.count = S.rec.count ? 0 : 1; if (rc.dataset.rclick) S.rec.click = S.rec.click ? 0 : 1; if (rc.dataset.rodr != null) S.rec.overdub = +rc.dataset.rodr; save(); drawTransport(); drawEdHead(); const open = [...colEl.querySelectorAll('details')].map((d) => d.open); drawCol(); [...colEl.querySelectorAll('details')].forEach((d, k) => (d.open = open[k])); return; }
  if (e.target.closest('.js-laneclr2')) { pushUndo(); pat(i).auto = []; save(); drawLane(); drawGrid(); return; }
  const sw = e.target.closest('[data-insw]'); if (sw) { const x = tk.inserts[+sw.dataset.insw]; x.on = x.on ? 0 : 1; wireInserts(i); save(); drawCol(); return; }
  const ib = e.target.closest('[data-ins]'); if (ib) { selFx = tk.inserts[+ib.dataset.ins].type; showFx(); drawCol(); return; }
  if (e.target.closest('.js-insadd')) { const m = $('.dub-insmenu', colEl); m.hidden = !m.hidden; return; }
  const nw = e.target.closest('[data-insnew]'); if (nw) { tk.inserts.push({ type: nw.dataset.insnew, on: 1 }); selFx = nw.dataset.insnew; wireInserts(i); save(); drawCol(); showFx(); return; }
  const pe = e.target.closest('[data-pe]'); if (pe) { const P = pat(i); P.pe = P.pe ? 0 : 1; save(); drawCol(); return; }
  const ps = e.target.closest('[data-pscale]'); if (ps) { pat(i).scale = ps.dataset.pscale; save(); drawCol(); return; }
  const tf = e.target.closest('[data-tfit]'); if (tf) { const P = pat(i); if (tf.dataset.tfit === 'orig') P.orig = 1; else delete P.orig; save(); drawAll(); return; }
  const fa = e.target.closest('[data-frall]'); if (fa) { const P = pat(i); if (P.fr) { pushUndo(); delete P.fr; queueFit(P); save(); drawAll(); } return; }
  const bf = e.target.closest('[data-bfade]'); if (bf) { pat(i).fade = +bf.dataset.bfade; save(); drawCol(); return; }
  const src = e.target.closest('[data-src]'); if (src) { const P = pat(i), k = +src.dataset.src; P.src[k] = P.src[k] ? 0 : 1; save(); drawCol(); drawGrid(); return; }
  if (e.target.closest('.js-rand')) { pushUndo(); pat(i).seed = Math.floor(Math.random() * 10000); save(); drawCol(); drawGrid(); drawRoll(); }
});

/* ---------- bottom: returns row + effect panel ---------- */
function drawRets() {
  $('.js-rets').innerHTML = `<span class="dub-rets__lbl">Returns</span>` + RET.map(([k, n]) => `<button class="fxbox dub-retb${selFx === k ? ' is-sel' : ''}" data-ret="${k}" type="button"><span class="fxbox__name">${n}</span><i class="sw${S.ret[k].off ? ' off' : ''}" data-retsw="${k}" title="オン/オフ"></i></button>`).join('');
}
$('.js-rets').addEventListener('click', (e) => {
  if (e.target.closest('.js-kick')) { audio().then(kickSpring); return; }
  const sw = e.target.closest('[data-retsw]'); if (sw) { const r = S.ret[sw.dataset.retsw]; r.off = r.off ? 0 : 1; applyReturns(); save(); drawRets(); return; }
  const b = e.target.closest('[data-ret]'); if (!b) return; selFx = b.dataset.ret; showFx(); drawRets(); drawCol();
});
const FX = {
  phaser: (f) => `<div class="dub-fxh"><span class="dub-fxttl">Phaser</span><span class="dub-fxsub">Insert · Track ${TRACKS[S.selTrack].n}</span></div>
    <div class="dub-ph">${[0, 1].map((u) => `<div class="dub-fxu"><span class="dub-fxu__t" title="${u ? 'Y' : 'X'} = XY パッドで動く">Phaser ${u + 1}</span>
      <div hidden>${sliderRow(`ph.${u}.man`, 'Manual', f.p[u].man, Math.round(90 * Math.pow(2, f.p[u].man * 5.6)) + 'Hz', '手で動かすつまみ(XY パッドで動く)')}</div>
      ${sliderRow(`ph.${u}.rate`, 'Rate', f.p[u].rate, rateTxt(f.p[u].rate, f.sync), '揺れの速さ')}
      ${sliderRow(`ph.${u}.depth`, 'Depth', f.p[u].depth, Math.round(f.p[u].depth * 100) + '%', '揺れの深さ(0=手のつまみだけ)')}
      ${sliderRow(`ph.${u}.fb`, 'Feedback', f.p[u].fb, Math.round(f.p[u].fb * 100) + '%', 'くせの強さ')}</div>`).join('')}
      <div class="dub-phopts">
        <span class="dub-lbl" data-hint="2台目の Rate/Depth/Feedback を1台目にそろえる">Link</span><span class="dub-opts">${opt('f.link', 0, 'Free', !f.link)}${opt('f.link', 1, 'Link', f.link)}</span>
        <span class="dub-lbl">Wave</span><span class="dub-opts">${opt('f.wave', 'sine', 'Sine', f.wave === 'sine')}${opt('f.wave', 'square', 'Square', f.wave === 'square')}</span>
        <span class="dub-lbl" data-hint="Series=1台目→2台目 / Parallel=並べて混ぜる">Route</span><span class="dub-opts">${opt('f.route', 'series', 'Series', f.route === 'series')}${opt('f.route', 'parallel', 'Parallel', f.route === 'parallel')}</span>
        <span class="dub-lbl" data-hint="揺れの速さをテンポに合わせる">Sync</span><span class="dub-opts">${opt('f.sync', 0, 'Free', !f.sync)}${opt('f.sync', 1, '1/16', f.sync)}</span>
      </div></div>`,
  step: (f) => `<div class="dub-fxh"><span class="dub-fxttl">Step Filter</span><span class="dub-lbl">段階的に切り替わるフィルター(11段)</span></div>
    <div class="dub-fx3">${sliderRow('st.hp', 'High Pass', f.hp, f.hp ? HP[f.hp] + 'Hz' : 'Off', '低音を切る。回すと「カチ、カチ」と11段で変わる', 0, 10, 1)}${sliderRow('st.lp', 'Low Pass', f.lp, f.lp ? (LP[f.lp] >= 1000 ? LP[f.lp] / 1000 + 'k' : LP[f.lp]) + 'Hz' : 'Off', '高音を切る(11段)', 0, 10, 1)}${sliderRow('st.res', 'Resonance', f.res, Math.round(f.res * 100) + '%', '切れ目の山')}</div>`,
  drive: (f) => `<div class="dub-fxh"><span class="dub-fxttl">Tape Drive</span><span class="dub-lbl">エコーなしでテープを通すだけ</span></div>
    <div class="dub-fx3">${sliderRow('dr.drive', 'Drive', f.drive, Math.round(f.drive * 100) + '%', '歪み')}${sliderRow('dr.tone', 'Tone', f.tone, Math.round(f.tone * 100) + '%', 'こもり(左ほどこもる)')}${sliderRow('dr.wow', 'Wow', f.wow, Math.round(f.wow * 100) + '%', 'テープのゆれ')}${sliderRow('dr.gen', 'Generations', f.gen, f.gen + 'x', '録り直し回数。重ねるほど劣化する', 1, 6, 1)}</div>`,
  tape: (r) => retPanel('Tape Echo', 'tape', `${timeRow('tape', r)}${sliderRow('r.tape.fb', 'Feedback', r.fb, Math.round(r.fb * 100) + '%', 'くり返しの量')}${sliderRow('r.tape.tone', 'Tone', r.tone, Math.round(r.tone * 100) + '%', 'くり返すたびのこもり')}${sliderRow('r.tape.wow', 'Wow', r.wow, Math.round(r.wow * 100) + '%', '回転むら')}${sliderRow('r.tape.level', 'Level', r.level, Math.round(r.level * 100) + '%', '返りの音量')}`),
  dd: (r) => retPanel('Digital Delay', 'dd', `${timeRow('dd', r)}${sliderRow('r.dd.fb', 'Feedback', r.fb, Math.round(r.fb * 100) + '%', 'くり返しの量(劣化しない)')}${sliderRow('r.dd.lo', 'Low Cut', r.lo, Math.round(20 * Math.pow(2, r.lo * 7)) + 'Hz', 'くり返しの中の低音カット')}${sliderRow('r.dd.hi', 'High Cut', r.hi, (800 * Math.pow(2, r.hi * 4.5) / 1000).toFixed(1) + 'k', 'くり返しの中の高音カット')}${sliderRow('r.dd.level', 'Level', r.level, Math.round(r.level * 100) + '%', '返りの音量')}`),
  spring: (r) => retPanel('Spring', 'spring', `${sliderRow('r.spring.decay', 'Decay', r.decay, (0.6 + r.decay * 2.4).toFixed(1) + 's', '響きの長さ')}${sliderRow('r.spring.tone', 'Tone', r.tone, Math.round(r.tone * 100) + '%', '明るさ')}${sliderRow('r.spring.drive', 'Drive', r.drive, Math.round(r.drive * 100) + '%', '入れる量を上げると歪む(金属的)')}${sliderRow('r.spring.level', 'Level', r.level, Math.round(r.level * 100) + '%', '返りの音量')}`, '<button class="dub-tbtn js-kick2" type="button" title="スプリングを叩く">Kick</button>'),
  big: (r) => retPanel('Big Reverb', 'big', `${sliderRow('r.big.size', 'Size', r.size, (1 + r.size * 7).toFixed(1) + 's', '広さ・長さ')}${sliderRow('r.big.damp', 'Damp', r.damp, Math.round(r.damp * 100) + '%', '高音の吸われ方')}${sliderRow('r.big.pre', 'Pre Delay', r.pre, Math.round(r.pre * 120) + 'ms', '響きが始まるまで')}${sliderRow('r.big.level', 'Level', r.level, Math.round(r.level * 100) + '%', '返りの音量')}`),
};
const timeRow = (k, r) => sliderRow(`r.${k}.time`, 'Time', r.time, TIMES[r.time][0], '遅れ(テンポに合わせる)', 0, TIMES.length - 1, 1);
const retPanel = (name, k, rows, extra = '') => `<div class="dub-fxh"><span class="dub-fxttl">${name}</span><span class="dub-lbl">Return · all tracks send here</span>${extra}</div><div class="dub-fx3">${rows}</div>`;
function showFx() {
  const i = S.selTrack, box = $('.js-fx'), isM = selFx === 'master';
  $('.js-mfx').hidden = !isM; box.hidden = isM; $('.js-rets').classList.toggle('is-hide', isM); $('.js-master').classList.toggle('on', isM);
  if (isM) return;
  if (INS[selFx] && !T(i).inserts.some((x) => x.type === selFx)) selFx = T(i).inserts[0]?.type || 'tape';
  box.innerHTML = INS[selFx] ? FX[selFx](T(i).fx[selFx]) + (T(i).inserts.some((x) => x.type === selFx) ? `<button class="dub-fxrm js-fxrm" type="button" title="このトラックから外す">Remove</button>` : '') : FX[selFx](S.ret[selFx]);
  fillAll(); drawRets();
}
function syncFxValues() { // after the XY pad moved the manual knobs
  const f = T(S.selTrack).fx.phaser;
  [0, 1].forEach((u) => { const el = $(`[data-p="ph.${u}.man"]`, $('.js-fx')); if (el) { el.value = f.p[u].man; fillOne(el); $(`[data-pv="ph.${u}.man"]`).textContent = Math.round(90 * Math.pow(2, f.p[u].man * 5.6)) + 'Hz'; } });
}
$('.js-fx').addEventListener('input', (e) => {
  const k = e.target.dataset.p; if (!k) return;
  const i = S.selTrack, f = T(i).fx, v = +e.target.value, [a, b, c] = k.split('.');
  if (a === 'ph') f.phaser.p[+b][c] = v;
  else if (a === 'st') f.step[b] = v;
  else if (a === 'dr') f.drive[b] = v;
  else if (a === 'r') { S.ret[b][c] = v; applyReturns(); }
  applyFx(i); save();
  // only the value label changes (redrawing the panel would break the drag)
  const tmp = document.createElement('div'); tmp.innerHTML = INS[selFx] ? FX[selFx](f[selFx]) : FX[selFx](S.ret[selFx]);
  const nv = $(`[data-pv="${k}"]`, tmp), ov = $(`[data-pv="${k}"]`, $('.js-fx')); if (nv && ov) ov.textContent = nv.textContent;
});
$('.js-fx').addEventListener('click', (e) => {
  const i = S.selTrack, f = T(i).fx.phaser, b = e.target.closest('button'); if (!b) return;
  if (b.matches('.js-kick2')) { audio().then(kickSpring); return; }
  if (b.matches('.js-fxrm')) { const tk = T(i); tk.inserts = tk.inserts.filter((x) => x.type !== selFx); wireInserts(i); selFx = tk.inserts[0]?.type || 'tape'; save(); showFx(); drawCol(); return; }
  if (b.dataset['f.link'] != null) f.link = +b.dataset['f.link'];
  if (b.dataset['f.wave']) f.wave = b.dataset['f.wave'];
  if (b.dataset['f.route']) f.route = b.dataset['f.route'];
  if (b.dataset['f.sync'] != null) f.sync = +b.dataset['f.sync'];
  applyFx(i); save(); showFx();
});
$('.js-master').addEventListener('click', () => { selFx = selFx === 'master' ? (T(S.selTrack).inserts[0]?.type || 'tape') : 'master'; showFx(); drawCol(); });

/* ---------- master (the shared finishing rack) ---------- */
const rackBox = document.createElement('div');
rack = finishRack(rackBox, { defaults: { tcOn: 1, teOn: 0, eqOn: 0, ...(S.master || {}) } });
if (S.master) rack.set(S.master);
$('.js-mfx').append($('.fx-row', rackBox), $('.fx-area', rackBox));
$('.js-mfx').addEventListener('input', () => save()); $('.js-mfx').addEventListener('click', () => save());
{ // the switch on the Master box: lit while any of Comp / Echo / EQ is on (press the box to set them)
  const msw = $('.js-msw'); const show = () => { const st = rack.get(); msw.classList.toggle('off', !(st.tcOn || st.teOn || st.eqOn)); };
  setInterval(show, 500); show();
}

/* ---------- XY pad ---------- */
const pad = $('.js-pad'), padCv = $('.js-padcv'), pg = padCv.getContext('2d'), trail = [];
function drawPadDot() {
  const f = T(S.selTrack).fx.phaser, x = f.p[0].man, y = f.p[1].man, d = $('.js-paddot');
  d.style.left = x * 100 + '%'; d.style.top = (1 - y) * 100 + '%';
  trail.push([x, y, performance.now()]); if (trail.length > 60) trail.shift();
}
function drawPadTrail() {
  const W = 190, now = performance.now();
  pg.setTransform(2, 0, 0, 2, 0, 0); pg.clearRect(0, 0, W, W);
  pg.strokeStyle = 'rgba(160,179,87,.5)'; pg.lineWidth = 0.5;
  for (let k = 1; k < 4; k++) { pg.beginPath(); pg.moveTo((k * W) / 4, 0); pg.lineTo((k * W) / 4, W); pg.moveTo(0, (k * W) / 4); pg.lineTo(W, (k * W) / 4); pg.stroke(); }
  const pts = trail.filter((p) => now - p[2] < 1500);
  if (pts.length > 1) { pg.strokeStyle = '#f39a1d'; pg.lineWidth = 1.5; pg.beginPath(); pts.forEach((p, k) => { const x = p[0] * W, y = (1 - p[1]) * W; k ? pg.lineTo(x, y) : pg.moveTo(x, y); }); pg.stroke(); }
}
let padDrag = false;
const padAt = (e) => { const r = pad.getBoundingClientRect(); setXY((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height); };
pad.addEventListener('pointerdown', (e) => {
  padDrag = true; pad.setPointerCapture(e.pointerId); audio();
  const i = S.selTrack, tk = T(i); // the pad plays the Phaser: put one in if this track has none
  if (!tk.inserts.some((x) => x.type === 'phaser') && tk.inserts.length < 3) { tk.inserts.unshift({ type: 'phaser', on: 1 }); wireInserts(i); drawCol(); }
  padAt(e);
});
pad.addEventListener('pointermove', (e) => { if (padDrag) padAt(e); });
pad.addEventListener('pointerup', () => (padDrag = false));
$$('.js-perf').forEach((b) => {
  const k = b.dataset.perf;
  b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); audio().then(() => setPerf(k, 1)); });
  const up = () => { if (perf[k]) setPerf(k, 0); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
});

/* ---------- video ---------- */
const vcv = $('.js-vcv'), vg = vcv.getContext('2d'), VW = 576, vq = [], foot = TRACKS.map(() => []);
function footage(i, t) {
  const a = A[i]; if (!a) return;
  const b = new Float32Array(256); a.tap.getFloatTimeDomainData(b);
  const w = new Float32Array(48); for (let k = 0; k < 48; k++) w[k] = b[k * 5];
  foot[i].push({ t, w }); if (foot[i].length > 400) foot[i].shift();
}
const photoOf = (i) => docOf(i)?.querySelector('.js-img');
function drawMats() {
  $('.js-mats').innerHTML = [0, 1, 2, 3, 4].map((i) => `<button class="dub-mat${S.video.mat[i] ? ' on' : ''}" data-mat="${i}" type="button" title="Track ${i + 1} の写真"><canvas width="64" height="64"></canvas><small>${i + 1}</small></button>`).join('') + `<button class="dub-mat dub-mat--w${S.video.mat[5] ? ' on' : ''}" data-mat="5" type="button" title="鳴った音の波形(時刻つき)">Wave</button>`;
  $$('.dub-mat canvas').forEach((c, i) => { const p = photoOf(i); if (p && p.width) { const g = c.getContext('2d'), s = Math.min(p.width, p.height); g.drawImage(p, (p.width - s) / 2, (p.height - s) / 2, s, s, 0, 0, 64, 64); } });
}
$('.js-mats').addEventListener('click', (e) => { const b = e.target.closest('[data-mat]'); if (!b) return; const k = +b.dataset.mat; S.video.mat[k] = S.video.mat[k] ? 0 : 1; save(); drawMats(); });
function drawPiece(ev) {
  const r = rng(ev.cell), n = ev.n, V = S.video, i = ev.src;
  let cols = n <= 4 ? 2 : n <= 16 ? 4 : 8, rows = n / cols; if (n === 8) { cols = 4; rows = 2; }
  let dx, dy, dw, dh;
  if (V.layout === 'grid') {
    const c = ev.cell % n; dw = VW / cols; dh = VW / rows; dx = (c % cols) * dw; dy = Math.floor(c / cols) * dh;
    if (V.shape === 'strip') { dw = VW / n; dx = (ev.cell % n) * dw; dy = 0; dh = VW; }
  } else {
    const s = 0.15 + r() * 0.35; dw = VW * s * (V.shape === 'strip' ? 0.25 : 1); dh = V.shape === 'strip' ? VW * (0.6 + r() * 0.4) : VW * s;
    dx = r() * (VW - dw); dy = r() * (VW - dh);
  }
  const p = photoOf(i);
  if (S.video.mat[i] && p && p.width) {
    const frac = ev.from / n, sw = p.width / n * (V.shape === 'strip' ? 1 : Math.max(1, n / 4)), sx = clamp(frac * p.width, 0, p.width - sw);
    const sh = V.shape === 'strip' ? p.height : Math.min(p.height, sw * (dh / dw)), sy = r() * (p.height - sh);
    vg.globalAlpha = 0.95; vg.drawImage(p, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  if (S.video.mat[5]) { // the sound of that moment
    const f = foot[i]; let best = null; for (const x of f) if (!best || Math.abs(x.t - ev.srcTime) < Math.abs(best.t - ev.srcTime)) best = x;
    if (best) { vg.globalAlpha = 1; vg.strokeStyle = '#e0e6b4'; vg.lineWidth = 2; vg.beginPath(); best.w.forEach((v, k) => { const x = dx + (k / 47) * dw, y = dy + dh / 2 - clamp(v * 2.2, -1, 1) * dh * 0.45; k ? vg.lineTo(x, y) : vg.moveTo(x, y); }); vg.stroke(); }
  }
  vg.globalAlpha = 1;
}
function videoFrame() {
  const fade = 0.03 + (1 - S.video.trail) * 0.3;
  vg.fillStyle = `rgba(27,42,19,${fade})`; vg.fillRect(0, 0, VW, VW);
  if (ctx) { const now = ctx.currentTime; while (vq.length && vq[0].time <= now) drawPiece(vq.shift()); if (vq.length > 200) vq.splice(0, vq.length - 200); }
  if (!(tr.on && play[5].cur >= 0)) $('.js-vinfo').textContent = 'Slicer off';
}
$('.js-vfull').addEventListener('click', () => vcv.requestFullscreen?.());
$('.js-trail').addEventListener('input', (e) => { S.video.trail = +e.target.value; $('.js-trailv').textContent = Math.round(S.video.trail * 100) + '%'; save(); });
$('.dub-vopts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.layout) S.video.layout = b.dataset.layout; if (b.dataset.shape) S.video.shape = b.dataset.shape; save(); drawVopts(); });
function drawVopts() {
  $$('[data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === S.video.layout));
  $$('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === S.video.shape));
  $('.js-trail').value = S.video.trail; $('.js-trailv').textContent = Math.round(S.video.trail * 100) + '%';
}

/* ---------- Rec Out + export ---------- */
let recBufs = null, lastWav = null;
function onRecData({ data }) { if (data.done) return; if (recBufs) { recBufs.l.push(data.l); recBufs.r.push(data.r); } if (patRec) patRec.push(data); }
$('.js-recout').addEventListener('click', async () => {
  await audio();
  const b = $('.js-recout');
  if (!recBufs) { recBufs = { l: [], r: [] }; recNode.port.postMessage({ on: true }); b.classList.add('on'); b.querySelector('span').textContent = 'Recording'; return; }
  recNode.port.postMessage({ on: false }); await sleep(60);
  const { l, r } = recBufs; recBufs = null; b.classList.remove('on');
  const n = l.reduce((s, x) => s + x.length, 0);
  lastWav = wav([l, r], n, ctx.sampleRate);
  b.querySelector('span').textContent = `Rec Out · ${(n / ctx.sampleRate).toFixed(1)}s`;
});
function wav(chs, n, sr) {
  const buf = new ArrayBuffer(44 + n * 4), d = new DataView(buf), w = (o, s) => [...s].forEach((c, k) => d.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); d.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 4, true);
  let o = 44; const L = chs[0], R = chs[1];
  for (let c = 0; c < L.length; c++) for (let k = 0; k < L[c].length; k++) { d.setInt16(o, clamp(L[c][k], -1, 1) * 32767, true); d.setInt16(o + 2, clamp(R[c][k], -1, 1) * 32767, true); o += 4; }
  return new Blob([buf], { type: 'audio/wav' });
}
function midiFile() { // type 1: one track per (Dub track, pattern) that has notes. 96 ticks per quarter (1 step = 24)
  const chunks = [], vlq = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; }, str = (s) => [...new TextEncoder().encode(s)];
  const mtrk = (ev) => { const b = [...ev, 0x00, 0xff, 0x2f, 0x00]; return [...str('MTrk'), (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255, ...b]; };
  const us = Math.round(60e6 / getBpm()); chunks.push(mtrk([0x00, 0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255]));
  TRACKS.forEach((t, i) => {
    if (t.slicer) return;
    T(i).pats.forEach((P, k) => {
      if (!P.notes.length) return;
      const evs = [];
      P.notes.forEach((n) => { evs.push([Math.round(n.s * 24), 0x90 | i, n.m, Math.round((n.v ?? 0.9) * 127)]); evs.push([Math.round((n.s + n.l) * 24), 0x80 | i, n.m, 0]); });
      evs.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
      const name = str(`T${t.n} ${t.name} P${k + 1}`), out = [0x00, 0xff, 0x03, ...vlq(name.length), ...name]; let last = 0;
      evs.forEach(([tk, a, b, c]) => { out.push(...vlq(tk - last), a, b, c); last = tk; });
      chunks.push(mtrk(out));
    });
  });
  const n = chunks.length, head = [...str('MThd'), 0, 0, 0, 6, 0, 1, (n >> 8) & 255, n & 255, 0, 96];
  return new Blob([new Uint8Array([...head, ...chunks.flat()])], { type: 'audio/midi' });
}
// Patterns · WAV: every filled pattern on its own, one after another: Play, let it loop twice, keep the second pass
// (so what rings over from the end - echo, reverb, a long note - is already there at its start: a seamless loop),
// cut exactly to the pattern's length. Mute / solo are set aside meanwhile; everything is put back afterwards.
let patRec = null, patJob = null;
async function exportPatterns() {
  if (patJob) { patJob.cancel = true; return; } // pressed again: stop
  const sounds = (i, P) => (TRACKS[i].slicer ? P.seed != null && slicePool(P).length > 0 : isAud(i, P) ? !!P.take : P.notes.length > 0); // patterns that make a sound (not just movements)
  const list = []; TRACKS.forEach((t, i) => T(i).pats.forEach((P, k) => { if (sounds(i, P)) list.push([i, k]); }));
  if (!list.length) { alert('中身のあるパターンがありません'); return; }
  await audio();
  const secs = list.reduce((a, [i, k]) => a + patSteps(T(i).pats[k]) * stepDur() * 2 + 0.4, 0);
  if (!confirm(`中身のあるパターン ${list.length} 個を、1つずつ鳴らして録ります(約 ${Math.ceil(secs)} 秒)。録っている間は音が鳴ります。`)) return;
  const btn = $('.js-expats span'), job = (patJob = { cancel: false }), keep = { play: play.map((p) => ({ ...p })), mix: S.tracks.map((t) => [t.mute, t.solo]) };
  if (tr.on) stop(); recArmed = false; tr.rec = false; drawTransport();
  S.tracks.forEach((t) => { t.mute = 0; t.solo = 0; }); applyMix();
  for (let w = 0; w < 200 && (fitBusy || fitQ.size); w++) await sleep(50); // fitted takes ready first
  const files = [], sr = ctx.sampleRate;
  try {
    for (let n = 0; n < list.length && !job.cancel; n++) {
      const [i, k] = list[n], P = T(i).pats[k], len = patSteps(P) * stepDur();
      btn.textContent = `Exporting ${n + 1} / ${list.length}`;
      play.forEach((p) => { p.cur = -1; p.next = undefined; p.silent = false; }); play[i].next = k;
      patRec = []; recNode.port.postMessage({ on: true });
      await startStop();
      const from = Math.round((tr.start + len) * sr), to = from + Math.round(len * sr); // the second pass, in frames
      while (ctx.currentTime < tr.start + 2 * len + 0.15 && !job.cancel) await sleep(40);
      stop(); recNode.port.postMessage({ on: false }); await sleep(80);
      const bl = patRec; patRec = null; if (job.cancel) break;
      const N = to - from, L = new Float32Array(N), R = new Float32Array(N);
      for (const b of bl) for (let j = 0; j < b.l.length; j++) { const f = b.at + j - from; if (f >= 0 && f < N) { L[f] = b.l[j]; R[f] = b.r[j]; } }
      let pk = 0; for (let j = 0; j < N; j++) pk = Math.max(pk, Math.abs(L[j]), Math.abs(R[j])); if (pk < 1e-3) continue; // no sound (only movements recorded): no file
      const name = `T${TRACKS[i].n}-P${k + 1}_${TRACKS[i].name.replace(/[^A-Za-z0-9]+/g, '-')}.wav`;
      files.push([name, new Uint8Array(await wav([[L], [R]], N, sr).arrayBuffer())]);
      { const buf = new Float32Array(outMeter.l?.fftSize || 2048), lvl = () => { if (!outMeter.l) return 0; let m = 0; for (const a of [outMeter.l, outMeter.r]) { a.getFloatTimeDomainData(buf); for (const x of buf) m = Math.max(m, Math.abs(x)); } return m; };
        for (let w = 0; w < 120 && !job.cancel && lvl() > 3e-4; w++) await sleep(50); } // the last notes, echoes and reverb die away (at most 6 s) before the next one starts
    }
    if (!job.cancel && files.length) download(await zip(files), `${S.name}_patterns.zip`);
  } finally {
    patRec = null; patJob = null; recNode.port.postMessage({ on: false });
    if (tr.on) stop();
    play.forEach((p, i) => Object.assign(p, keep.play[i], { cur: keep.play[i].cur, next: undefined }));
    S.tracks.forEach((t, i) => { [t.mute, t.solo] = keep.mix[i]; }); applyMix();
    btn.textContent = job.cancel ? 'Patterns · WAV (stopped)' : 'Patterns · WAV'; drawAll();
  }
}
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
$('.dub-export').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ex]'); if (!b) return;
  if (b.dataset.ex === 'wav') { if (!lastWav) { alert('まだ録っていません。Rec Out を押して録り、もう一度押して止めてから書き出してください'); return; } download(lastWav, `${S.name}.wav`); }
  if (b.dataset.ex === 'midi') download(midiFile(), `${S.name}.mid`);
  if (b.dataset.ex === 'pats') exportPatterns();
});

/* ---------- output meter ---------- */
{
  const ml = $('.js-ml'), mr = $('.js-mr'), pk = $('.js-peak'), lim = $('.js-lim'); let bl, br, hold = -99, holdT = 0, limT = 0;
  const lvl = (a, buf) => { a.getFloatTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v)); return p; };
  const toH = (p) => Math.max(0, Math.min(1, 1 + (p > 1e-5 ? 20 * Math.log10(p) : -99) / 48)) * 100 + '%';
  const loop = () => {
    const now = performance.now();
    if (outMeter.l) {
      bl ||= new Float32Array(outMeter.l.fftSize); br ||= new Float32Array(outMeter.r.fftSize);
      const L = lvl(outMeter.l, bl), Rr = lvl(outMeter.r, br), P = Math.max(L, Rr), dB = P > 1e-5 ? 20 * Math.log10(P) : -99;
      ml.style.height = toH(L); mr.style.height = toH(Rr);
      if (dB > hold || now - holdT > 1500) { hold = dB; holdT = now; }
      pk.textContent = hold > -98 ? hold.toFixed(1) + ' dB' : '-∞ dB';
      if (dB > -1.2) limT = now; lim.classList.toggle('is-on', now - limT < 600);
    }
    videoFrame(); drawPadTrail();
    if (tr.on) drawRollHeadOnly();
    gridLive();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
let lastHead = 0;
// the grid, every frame: how far each playing pattern is (a line along the bottom of its cell), and a lamp by each
// track's number that lights with its sound (hollow when muted / not soloed: it plays but is not heard)
const lampBuf = new Float32Array(512), lampLv = TRACKS.map(() => 0); let live = [];
function gridLive() {
  if (!ctx) return;
  const solo = S.tracks.some((t) => t.solo);
  TRACKS.forEach((t, i) => {
    const a = A[i], el = live[i]?.lamp; if (!a || !el) return;
    a.tap.getFloatTimeDomainData(lampBuf); let pk = 0; for (let k = 0; k < lampBuf.length; k++) pk = Math.max(pk, Math.abs(lampBuf[k]));
    lampLv[i] = Math.max(pk > 0.003 ? Math.min(1, 0.35 + Math.log10(pk * 1000) / 3.5) : 0, lampLv[i] * 0.9); // fast up, slow down
    el.style.opacity = lampLv[i].toFixed(2);
    const tk = S.tracks[i]; el.classList.toggle('is-off', !!tk.mute || (solo && !tk.solo));
    const c = live[i].cell;
    if (c && play[i].cur >= 0) { const pos = posNow(i), L = patSteps(T(i).pats[play[i].cur]); c.style.setProperty('--p', pos == null ? 0 : ((pos % L) / L).toFixed(3)); } // (the track may have stopped since the grid was drawn)
  });
}
function drawRollHeadOnly() { const n = performance.now(); if (n - lastHead < 50) return; lastHead = n; drawRoll(); }

/* ---------- keyboard / MIDI ---------- */
const KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
let oct = 4;
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input[type=number], input[type=text], select') || e.repeat && !(e.code in KEYS)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); doUndo(); return; }
  if (mod && e.code === 'KeyC') { clip = JSON.stringify(pat(S.selTrack)); return; }
  if (mod && e.code === 'KeyV') { if (clip) { const c = JSON.parse(clip); if (!!TRACKS[S.selTrack].slicer === ('seed' in c)) { pushUndo(); T(S.selTrack).pats[T(S.selTrack).sel] = c; save(); drawAll(); } } return; }
  if (mod) return;
  if (e.code === 'Space') { e.preventDefault(); startStop(); return; }
  if (e.code === 'Escape') { stop(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') { pushUndo(); T(S.selTrack).pats[T(S.selTrack).sel] = newPat(TRACKS[S.selTrack].slicer); save(); drawAll(); return; }
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); S.selTrack = clamp(S.selTrack + (e.code === 'ArrowUp' ? -1 : 1), 0, 5); save(); drawAll(); return; }
  if (/^Digit[1-8]$/.test(e.code)) { $(`[data-cell="${S.selTrack}:${+e.code.slice(5) - 1}"]`)?.click(); return; }
  if (e.code === 'KeyZ') { oct = Math.max(1, oct - 1); return; }
  if (e.code === 'KeyX') { oct = Math.min(7, oct + 1); return; }
  if (e.code in KEYS) { e.preventDefault(); if (!e.repeat) keyDown(e.code, 12 * (oct + 1) + KEYS[e.code]); }
});
addEventListener('keyup', (e) => { if (e.code in KEYS) keyUp(e.code); });
addEventListener('blur', () => { for (const k of [...held.keys()]) keyUp(k); });
$('.js-midi').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) return;
  try {
    const acc = await navigator.requestMIDIAccess();
    const bind = () => { for (const inp of acc.inputs.values()) inp.onmidimessage = ({ data: [st, n, v] }) => { const t = st & 0xf0; if (t === 0x90 && v > 0) keyDown('m' + n, n, v / 127); else if (t === 0x80 || (t === 0x90 && v === 0)) keyUp('m' + n); $('.js-midi').classList.add('is-note'); setTimeout(() => $('.js-midi').classList.remove('is-note'), 250); }; $('.js-midi').classList.toggle('is-on', acc.inputs.size > 0); };
    acc.onstatechange = bind; bind();
  } catch {}
});
// the first touch anywhere starts the sound (browsers need a click before audio)
addEventListener('pointerdown', () => audio(), { once: true, capture: true });

/* ---------- start ---------- */
function drawAll() { drawTransport(); drawGrid(); drawEdHead(); drawRoll(); drawLane(); drawCol(); showFx(); drawPadDot(); drawVopts(); }
makeFrames();
drawAll();
sizeRoll();
window.__dub = { S, play, tr, A, R, eng, takes, fits, get ctx() { return ctx; }, audio, startStop, stop, keyDown, keyUp, setXY, setPerf, slicePlan, vq, foot, drawAll };
