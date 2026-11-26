// Shared finishing rack: tube compressor -> tape echo -> 4-band EQ. The same block on every page.
//   const rack = finishRack(box, { defaults: { tcOn: 0, teOn: 0 }, eq: true });
//   in the audio setup:  const { input, output } = await rack.connect(ctx);  source -> input, output -> the rest
//   presets: rack.get() / rack.set(obj)
// Page-specific hooks: onEchoMode(mode) (ambient: modes 5-12 turn its room reverb on).
// Look (11/19 Figma "IMG SOUND"): a row of 3 effect boxes (name + on/off switch; press the box to open its settings)
// and the panel below it: nothing selected = an overview (4 main sliders of each effect), selected = that effect.
// The screen frame (js/shell.js) moves `.fx-row` and `.fx-area` into place.
import { makeEq, eqResponse, EQ_DEFAULT } from './eq.js?v=3';
import { getBpm, onBpm } from './tempo.js?v=1';

export const HEAD_CM = 2.4; // must match tapeecho-worklet.js
export const FINISH_DEFAULT = () => ({
  tcOn: 0, tcIn: 1.5, tcThresh: 0.5, tcRel: 0.4, tcOut: 1, tcBal: 0.15,
  teOn: 0, teMode: 1, teSync: 0, teSpeed: 26, teInt: 0.45, teEcho: 0.5, teBass: 0, teTreble: 0, teWow: 0.3, teAge: 0.3, teWidth: 0,
  eqOn: 0, eq: EQ_DEFAULT(),
});

const pct = (v) => Math.round(v * 100) + '%';
const db = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
const dbf = (v, ref) => { const d = 20 * Math.log10(v / ref); return (d > 0 ? '+' : '') + d.toFixed(1) + 'dB'; };
const sec = (v) => (v >= 1 ? v.toFixed(2) + 's' : Math.round(v * 1000) + 'ms');
const fmtF = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : String(Math.round(f)));
const EQ_LO = Math.log(20), EQ_HI = Math.log(16000), EQ_DB = 15;
const fToK = (f) => (Math.log(f) - EQ_LO) / (EQ_HI - EQ_LO);
const kToF = (k) => Math.exp(EQ_LO + k * (EQ_HI - EQ_LO));

// [state key, label, min, max, step, format, which unit, hint]
const KNOBS = [
  ['tcThresh', 'Depth', 0, 1, 0.01, pct, 'tc', '効きの深さ。In のメーターの横の三角でも動かせます。下げるほど小さい音から潰れ始めます'],
  ['tcIn', 'Input', 0.3, 6, 0.01, (v) => dbf(v, 1.5), 'tc', '入力。上げるほど管が深く使われ、倍音が増えて温かくなります'],
  ['tcRel', 'Release', 0, 1, 0.01, (v) => sec(0.27 + v), 'tc', 'リリース。潰したあと戻るまでの時間(0.27〜1.27秒)'],
  ['tcOut', 'Output', 0.25, 4, 0.01, (v) => dbf(v, 1), 'tc', '出力。潰して小さくなった分を戻します'],
  ['tcBal', 'Balance', 0, 1.5, 0.01, (v) => v.toFixed(2) + 'V', 'tc', '左右の偏り。偶数倍音(太さ)が増えます'],
  ['teSpeed', 'Speed', 12, 40, 0.1, (v) => `${Math.round((HEAD_CM / v) * 1000)}ms`, 'te', 'リピートレート(テープの速さ)。表示はヘッド1の遅れ。動かすと、くり返し中の音の音程がうねります'],
  ['teInt', 'Intensity', 0, 1.3, 0.01, (v) => v.toFixed(2) + (v >= 0.95 ? '!' : ''), 'te', 'インテンシティ(くり返しの量)。約95%以上で発振します(! の表示)'],
  ['teEcho', 'Echo', 0, 1, 0.01, (v) => v.toFixed(2), 'te', 'エコーの音量'],
  ['teBass', 'Bass', -10, 10, 0.5, db, 'te', '低音(100Hz)の上げ下げ(dB)'],
  ['teTreble', 'Treble', -10, 10, 0.5, db, 'te', '高音(5kHz)の上げ下げ(dB)'],
  ['teWow', 'Wow', 0, 3, 0.01, (v) => (v > 0 ? `${Math.round(v * 15)}ct` : '0'), 'te', '回転むら。くり返しの音程が揺れます(±セント)'],
  ['teAge', 'Age', 0, 1, 0.01, (v) => v.toFixed(2), 'te', 'テープの古さ。こもり・歪み・ヒスが増えます'],
  ['teWidth', 'Stereo', 0, 1, 0.01, (v) => Math.round(v * 100) + '%', 'te', 'エコーの左右の広がり。0 = 真ん中(元の機械と同じ)。上げるほど、くり返しが左右に広がる(モノラルで聞いたときの音は変わらない)'],
];
const K = Object.fromEntries(KNOBS.map((r) => [r[0], r]));
const MODES = ['ヘッド1', 'ヘッド2', 'ヘッド3', 'ヘッド2+3', 'ヘッド1+リバーブ', 'ヘッド2+リバーブ', 'ヘッド3+リバーブ', 'ヘッド1+2+リバーブ',
  'ヘッド2+3+リバーブ', 'ヘッド1+3+リバーブ', 'ヘッド1+2+3+リバーブ', 'リバーブのみ'];
const EQ_T = [['lowshelf', 'Low'], ['peaking', 'Peak'], ['highshelf', 'High']];
const EQ_NAMES = ['Low', 'Mid 1', 'Mid 2', 'High'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const row = (k) => { const [, label, mn, mx, st, , , hint] = K[k];
  return `<div class="row"><span data-hint="${esc(hint)}">${label}</span><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}"><b data-v="${k}"></b></div>`; };
const ghost = '<div class="row ghost"></div>';
// overview mirror: drives the real control (data-k / EQ gain), not saved by presets
const ovRow = (label, target, hint) => `<div class="row"><span data-hint="${esc(hint)}">${label}</span><input type="range" data-ov="${target}" data-nopreset><b data-ovv="${target}"></b></div>`;
// the on/off state is kept by hidden tabs (so presets save/restore it as before); the switch presses them
const onOff = (attr) => `<div class="tabs" hidden><button class="tabs__btn" data-${attr}="0" type="button">off</button><button class="tabs__btn" data-${attr}="1" type="button">on</button></div>`;

const ICON = { // from Figma (Effect Box)
  tc: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="12.5" fill="white" stroke="#1B2A13"/><line x1="0" y1="12.5" x2="5.47" y2="12.5" stroke="black"/><line x1="4.79" y1="8.39" x2="21.21" y2="8.39" stroke="black"/><line x1="4.79" y1="12.5" x2="21.21" y2="12.5" stroke="black" stroke-dasharray="4 2"/><path d="M21.2101 20.8685V17.1053H4.78906V22.579" stroke="black"/><path d="M13 0.342163V8.55269" stroke="black"/></svg>',
  te: '<svg width="29" height="14" viewBox="0 0 29 14" fill="none"><circle cx="7" cy="7" r="6.5" fill="white" stroke="#1B2A13"/><circle cx="22" cy="7" r="6.5" fill="white" stroke="#1B2A13"/></svg>',
  fq: '<svg width="23" height="20" viewBox="0 0 23 20" fill="none" stroke="black"><line x1="2.5" y1="0" x2="2.5" y2="20"/><line x1="5" y1="4.5" x2="0" y2="4.5"/><line x1="8.5" y1="0" x2="8.5" y2="20"/><line x1="11" y1="11.5" x2="6" y2="11.5"/><line x1="14.5" y1="0" x2="14.5" y2="20"/><line x1="17" y1="8.5" x2="12" y2="8.5"/><line x1="20.5" y1="0" x2="20.5" y2="20"/><line x1="23" y1="5.5" x2="18" y2="5.5"/></svg>',
};

export function finishRack(box, { defaults = {}, eq: withEq = true, onEchoMode = null, echoNote = '' } = {}) {
  const F = { ...FINISH_DEFAULT(), ...defaults };
  let tube = null, echo = null, eqU = null, inA = null, outA = null, specBuf = null;
  let sel = null; // which effect's settings are open: null = overview, 'tc' | 'te' | 'fq'
  let band = 2;   // EQ: the band being edited

  const fxBox = (u, name) => `<div class="fxbox" data-fx="${u}"><span class="fxbox__icon">${ICON[u]}</span><span class="fxbox__name">${name}</span><i class="sw" data-sw="${u}" title="オン/オフ"></i></div>`;
  box.innerHTML = `
    <div class="fx-row">${fxBox('tc', 'Tube Comp')}${fxBox('te', 'Tape Echo')}${withEq ? fxBox('fq', 'EQ') : ''}</div>
    <div class="fx-area" data-sel="">
      ${onOff('tc')}${onOff('te')}${withEq ? onOff('fq') : ''}
      <div class="fx-ov">
        <div class="fx-ov__col" data-col="tc">${ovRow('Input', 'tcIn', K.tcIn[7])}${ovRow('Depth', 'tcThresh', K.tcThresh[7])}${ovRow('Release', 'tcRel', K.tcRel[7])}${ovRow('Output', 'tcOut', K.tcOut[7])}</div>
        <div class="fx-ov__col" data-col="te">${ovRow('Speed', 'teSpeed', K.teSpeed[7])}${ovRow('Intensity', 'teInt', K.teInt[7])}${ovRow('Echo', 'teEcho', K.teEcho[7])}${ovRow('Wow', 'teWow', K.teWow[7])}</div>
        ${withEq ? `<div class="fx-ov__col" data-col="fq">${EQ_NAMES.map((n, i) => ovRow(n, 'eq' + i, '帯域' + (i + 1) + 'の高さ(dB)')).join('')}</div>` : ''}
      </div>

      <div class="fx-pn" data-pn="tc">
        <div class="fx-pn__head"><span class="fx-pn__ttl" data-hint="真空管コンプ。手本: 1960年代の放送用の真空管コンプ。出力の音を聴いて効く量を決める、ゆっくりやわらかいコンプ。アタック約33ms、リリース0.27〜1.27秒">Tube Comp</span></div>
        <div class="tc">
          <div class="tc__meters">
            <div class="mtr"><span class="mtr__name" data-hint="圧縮量。今どれだけ音を潰しているか(dB)">Comp</span><div class="mtr__body"><div class="mtr__scale"><i>0</i><i>-6</i><i>-12</i><i>-18</i></div><div class="mtr__bar"><b class="mtr__fill mtr__fill--top" data-gr></b></div></div><span class="val" data-grv>0.0</span></div>
            <div class="mtr"><span class="mtr__name" data-hint="入力の音量。オレンジの線(Depth)より上に出た分が潰れます。三角を上下にドラッグで Depth">In</span><div class="mtr__body"><div class="mtr__scale"><i>0</i><i>-12</i><i>-24</i><i>-36</i></div><div class="mtr__bar js-tcin"><b class="mtr__fill" data-inl></b><i class="mtr__th" data-th></i><i class="mtr__tri" data-th-h title="Depth"></i></div><span class="mtr__dep">Depth</span></div><span class="val" data-inv>-∞</span></div>
          </div>
          <div class="tc__rows">${row('tcIn')}${row('tcRel')}${row('tcOut')}${row('tcBal')}<div hidden>${row('tcThresh')}</div></div>
        </div>
      </div>

      <div class="fx-pn" data-pn="te">
        <div class="fx-pn__head"><span class="fx-pn__ttl" data-hint="テープエコー。手本: 1970年代のスタジオ用テープエコー。録音ヘッド1つと再生ヘッド3つ。くり返すたびにテープとアンプを通るので、こもって少しずつ歪みます。${esc(echoNote)}">Tape Echo</span>
          <span class="fx-pn__lbl" data-hint="エコーの間隔。Free=手で / 1/16=ヘッド1がテンポの16分音符になる速さ">Sync</span>
          <div class="tabs fx-tabs"><button class="tabs__btn" data-tesync="0" type="button">Free</button><button class="tabs__btn" data-tesync="1" type="button">1/16</button></div></div>
        <div class="fx-grid">
          <div class="row"><span data-hint="モード(どのヘッドを使うか、リバーブ)。今: ">Mode</span><input type="range" data-temode-r data-nopreset min="1" max="12" step="1"><b data-temode-v></b></div>
          ${row('teSpeed')}${row('teInt')}${row('teEcho')}${row('teBass')}${row('teTreble')}${row('teWow')}${row('teAge')}${row('teWidth')}
          <select data-temode hidden>${MODES.map((m, i) => `<option value="${i + 1}">${i + 1} ${m}</option>`).join('')}</select>
        </div>
      </div>

      ${withEq ? `<div class="fx-pn" data-pn="fq">
        <div class="fx-pn__head"><span class="fx-pn__ttl" data-hint="4バンドのEQ。Band で選んだ帯域を右で調整。グラフの丸を押しても選べます">EQ</span>
          <span class="fx-pn__lbl fx-pn__lbl--r" data-hint="調整する帯域">Band</span>
          <div class="tabs fx-tabs fx-tabs--band" data-nopreset>${[0, 1, 2, 3].map((i) => `<button class="tabs__btn" data-eqband="${i}" type="button">${i + 1}</button>`).join('')}</div>
          <span class="fx-pn__lbl" data-hint="Low=その高さより下をまとめて / Peak=山と谷 / High=上をまとめて">Type</span>
          <div class="tabs fx-tabs" data-nopreset>${EQ_T.map(([v, l]) => `<button class="tabs__btn" data-eqt="${v}" type="button">${l}</button>`).join('')}</div>
          <button class="fx-pn__reset" data-eqreset type="button" title="EQを平らに戻す">Flat</button></div>
        <div class="eqp">
          <canvas class="eqp__cv" data-eqcv width="792" height="264"></canvas>
          <div class="eqp__rows">${F.eq.map((b, i) => `<div class="peq" data-band="${i}">
            <select data-eqtype hidden>${EQ_T.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            <div class="row"><span data-hint="帯域(どの高さ)">Freq</span><input type="range" data-eqf min="0" max="1" step="0.001"><b data-eqfv></b></div>
            <div class="row"><span data-hint="高さ(どれだけ上げ下げ、±15dB)">Gain</span><input type="range" data-eqg min="-15" max="15" step="0.5"><b data-eqgv></b></div>
            <div class="row"><span data-hint="幅(Q)。小さい=広くなだらか / 大きい=狭くとがる。Low/High は固定">Width</span><input type="range" data-eqq min="0.3" max="8" step="0.05"><b data-eqqv></b></div></div>`).join('')}</div>
        </div>
      </div>` : ''}
    </div>`;
  // the screen frame moves these two parts out of `box`, so look inside them, not inside box
  const fxRow = box.querySelector('.fx-row'), area = box.querySelector('.fx-area');
  const q = (s) => fxRow.querySelector(s) || area.querySelector(s), qq = (s) => [...fxRow.querySelectorAll(s), ...area.querySelectorAll(s)];

  // ---- sending to the audio
  const echoSpeed = () => (F.teSync ? Math.min(40, Math.max(12, HEAD_CM / (60 / getBpm() / 4))) : F.teSpeed);
  const sendTube = () => { if (tube) tube.port.postMessage({ on: F.tcOn, input: F.tcIn, thresh: F.tcThresh, release: F.tcRel, output: F.tcOut, balance: F.tcBal }); };
  const sendEcho = () => { if (echo) echo.port.postMessage({ on: F.teOn, mode: F.teMode, speed: echoSpeed(), intensity: F.teInt, echo: F.teEcho, bass: F.teBass, treble: F.teTreble, wow: F.teWow, age: F.teAge, width: F.teWidth ?? 0 }); };
  const sendEq = () => { if (eqU) eqU.set(F.eq, F.eqOn); };
  const showGR = (gr) => {
    const v = Math.max(-18, Math.min(0, F.tcOn ? gr || 0 : 0));
    q('[data-gr]').style.height = (-v / 18) * 100 + '%';
    q('[data-grv]').textContent = v.toFixed(1);
  };
  const showTh = () => { const p = F.tcThresh * 100 + '%'; q('[data-th]').style.top = p; q('[data-th-h]').style.top = p; };

  // ---- showing the state
  function showOv(k) {
    const el = q(`[data-ov="${k}"]`); if (!el) return;
    let src;
    if (k.startsWith('eq')) { const i = +k.slice(2); src = q(`[data-band="${i}"] [data-eqg]`); q(`[data-ovv="${k}"]`).textContent = db(F.eq[i].g); }
    else { src = q(`[data-k="${k}"]`); q(`[data-ovv="${k}"]`).textContent = q(`[data-v="${k}"]`).textContent; }
    el.min = src.min; el.max = src.max; el.step = src.step; el.value = src.value; el.disabled = src.disabled;
  }
  function showKnob(k) {
    const r = K[k];
    const el = q(`[data-k="${k}"]`);
    if (k === 'teSpeed' && F.teSync) { const s = echoSpeed(); el.value = s; q('[data-v="teSpeed"]').textContent = '♪' + r[5](s); el.disabled = true; }
    else { el.disabled = false; el.value = F[k]; q(`[data-v="${k}"]`).textContent = r[5](F[k]); }
    if (k === 'tcThresh') showTh();
    showOv(k);
  }
  function showMode() {
    q('[data-temode]').value = F.teMode; q('[data-temode-r]').value = F.teMode; q('[data-temode-v]').textContent = F.teMode;
    q('[data-temode-r]').previousElementSibling.dataset.hint = 'モード(どのヘッドを使うか、リバーブ)。今: ' + MODES[F.teMode - 1];
  }
  function showTabs() {
    for (const [attr, key] of [['tc', 'tcOn'], ['te', 'teOn'], ['tesync', 'teSync'], ['fq', 'eqOn']]) qq(`[data-${attr}]`).forEach((b) => b.classList.toggle('is-on', +b.dataset[attr] === +F[key]));
    for (const [u, key] of [['tc', 'tcOn'], ['te', 'teOn'], ['fq', 'eqOn']]) {
      const on = !!F[key];
      qq(`[data-sw="${u}"]`).forEach((s) => s.classList.toggle('off', !on));
      qq(`[data-col="${u}"], [data-pn="${u}"]`).forEach((c) => c.classList.toggle('is-off', !on));
    }
    if (!F.tcOn) showGR(0);
  }
  function showSel() {
    area.dataset.sel = sel || '';
    qq('.fxbox').forEach((b) => b.classList.toggle('is-sel', b.dataset.fx === sel));
    if (sel === 'fq') drawEq();
  }
  function showEq() {
    if (!withEq) return;
    F.eq.forEach((b, i) => {
      const r = q(`[data-band="${i}"]`);
      r.hidden = i !== band;
      r.querySelector('[data-eqtype]').value = b.type; r.querySelector('[data-eqf]').value = fToK(b.f); r.querySelector('[data-eqg]').value = b.g; r.querySelector('[data-eqq]').value = b.q;
      r.querySelector('[data-eqfv]').textContent = fmtF(b.f);
      r.querySelector('[data-eqgv]').textContent = db(b.g);
      r.querySelector('[data-eqqv]').textContent = b.type === 'peaking' ? b.q.toFixed(2) : '—';
      r.querySelector('[data-eqq]').disabled = b.type !== 'peaking';
      showOv('eq' + i);
    });
    qq('[data-eqband]').forEach((x) => x.classList.toggle('is-on', +x.dataset.eqband === band));
    qq('[data-eqt]').forEach((x) => x.classList.toggle('is-on', x.dataset.eqt === F.eq[band].type));
    drawEq();
  }
  function drawEq() {
    const cv = q('[data-eqcv]'); if (!cv || !cv.offsetParent) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, s = W / 396;
    const yOf = (d) => H / 2 - (d / EQ_DB) * (H / 2 - 10 * s);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = '#a0b357'; g.lineWidth = s;
    g.strokeRect(s / 2, s / 2, W - s, H - s);
    g.globalAlpha = 0.6;
    for (const f of [100, 1000, 10000]) { const x = fToK(f) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.globalAlpha = 1;
    if (outA) { // what is sounding now (after the EQ), faint, behind the curve
      specBuf ||= new Float32Array(outA.frequencyBinCount); outA.getFloatFrequencyData(specBuf);
      const bin = outA.context.sampleRate / outA.fftSize, yS = (db) => H - Math.max(0, Math.min(1, (db + 100) / 80)) * (H - 4 * s);
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 2) { const k = Math.max(1, Math.min(specBuf.length - 1, Math.round(kToF(x / W) / bin))); g.lineTo(x, yS(specBuf[k])); }
      g.lineTo(W, H); g.closePath(); g.fillStyle = 'rgba(27,42,19,.16)'; g.fill();
      g.strokeStyle = 'rgba(27,42,19,.35)'; g.lineWidth = s; g.stroke();
    }
    g.setLineDash([3 * s, 3 * s]); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#a0b357'; g.font = `${10 * s}px Syne, sans-serif`;
    for (const [t, f] of [['100', 100], ['1k', 1000], ['10k', 10000]]) g.fillText(t, fToK(f) * W + 3 * s, H - 4 * s);
    // curve + area
    g.beginPath();
    for (let x = 0; x <= W; x += 2) { const y = yOf(eqResponse(F.eq, kToF(x / W))); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = F.eqOn ? '#1b2a13' : 'rgba(27,42,19,.4)'; g.lineWidth = 1.5 * s; g.stroke();
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(160,179,87,.35)'; g.fill();
    F.eq.forEach((b, i) => {
      const x = fToK(b.f) * W, y = yOf(b.g), on = i === band;
      g.beginPath(); g.arc(x, y, 8 * s, 0, 2 * Math.PI); g.fillStyle = on ? '#1b2a13' : '#e0e6b4'; g.fill(); g.strokeStyle = '#1b2a13'; g.lineWidth = s; g.stroke();
      g.fillStyle = on ? '#e0e6b4' : '#1b2a13'; g.font = `bold ${10 * s}px Poppins, Syne, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), x, y + 0.5 * s); g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    });
  }
  function showAll() {
    KNOBS.forEach(([k]) => showKnob(k));
    showMode(); showTabs(); showEq(); showSel();
  }

  // ---- controls
  qq('[data-k]').forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.k; F[k] = +el.value; showKnob(k);
    if (k.startsWith('tc')) sendTube(); else sendEcho();
  }));
  qq('[data-ov]').forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.ov;
    const src = k.startsWith('eq') ? q(`[data-band="${k.slice(2)}"] [data-eqg]`) : q(`[data-k="${k}"]`);
    src.value = el.value; src.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  qq('[data-tc]').forEach((b) => b.addEventListener('click', () => { F.tcOn = +b.dataset.tc; showTabs(); sendTube(); }));
  qq('[data-te]').forEach((b) => b.addEventListener('click', () => { F.teOn = +b.dataset.te; showTabs(); sendEcho(); }));
  qq('[data-tesync]').forEach((b) => b.addEventListener('click', () => { F.teSync = +b.dataset.tesync; showTabs(); showKnob('teSpeed'); sendEcho(); }));
  // switch = press the hidden on/off tab (so presets and the page see the same thing as before)
  qq('[data-sw]').forEach((s) => s.addEventListener('click', (e) => {
    e.stopPropagation();
    const u = s.dataset.sw, key = { tc: 'tcOn', te: 'teOn', fq: 'eqOn' }[u];
    q(`[data-${u}="${F[key] ? 0 : 1}"]`).click();
  }));
  qq('.fxbox').forEach((b) => b.addEventListener('click', () => { sel = sel === b.dataset.fx ? null : b.dataset.fx; showSel(); }));
  q('[data-temode]').addEventListener('change', (e) => { F.teMode = +e.target.value; showMode(); if (onEchoMode) onEchoMode(F.teMode); sendEcho(); });
  q('[data-temode-r]').addEventListener('input', (e) => { const s = q('[data-temode]'); s.value = e.target.value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  onBpm(() => { if (F.teSync) { showKnob('teSpeed'); sendEcho(); } });
  // Depth: drag the triangle (or the In meter) up/down
  {
    const bar = q('.js-tcin');
    const setFromY = (e) => {
      const r = bar.getBoundingClientRect(), v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      const el = q('[data-k="tcThresh"]'); el.value = v.toFixed(2); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); setFromY(e); bar.onpointermove = setFromY; });
    bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
  }
  if (withEq) {
    qq('[data-fq]').forEach((b) => b.addEventListener('click', () => { F.eqOn = +b.dataset.fq; showTabs(); sendEq(); drawEq(); }));
    q('.eqp__rows').addEventListener('input', (e) => {
      const r = e.target.closest('[data-band]'); if (!r) return;
      const b = F.eq[+r.dataset.band];
      if (e.target.matches('[data-eqf]')) b.f = kToF(+e.target.value);
      else if (e.target.matches('[data-eqg]')) b.g = +e.target.value;
      else if (e.target.matches('[data-eqq]')) b.q = +e.target.value;
      sendEq(); showEq();
    });
    q('.eqp__rows').addEventListener('change', (e) => {
      if (!e.target.matches('[data-eqtype]')) return;
      F.eq[+e.target.closest('[data-band]').dataset.band].type = e.target.value; sendEq(); showEq();
    });
    qq('[data-eqband]').forEach((x) => x.addEventListener('click', () => { band = +x.dataset.eqband; showEq(); }));
    qq('[data-eqt]').forEach((x) => x.addEventListener('click', () => {
      const s = q(`[data-band="${band}"] [data-eqtype]`); s.value = x.dataset.eqt; s.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    // the graph is also a control: drag a dot = frequency (left/right) and gain (up/down),
    // wheel on it = width (Peak only), double-click = gain back to 0. Pressing picks the nearest dot.
    const cvEq = q('[data-eqcv]');
    const at = (e) => { const r = cvEq.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, h: r.height }; };
    const gOfY = (y, h) => { const half = 0.5 - 20 / 264; return Math.max(-EQ_DB, Math.min(EQ_DB, ((0.5 - y) / half) * EQ_DB)); };
    const nearest = (p) => { let best = band, d = 1e9; F.eq.forEach((b, i) => { const dx = fToK(b.f) - p.x, dy = (0.5 - (b.g / EQ_DB) * (0.5 - 20 / 264)) - p.y, dd = dx * dx * 4 + dy * dy; if (dd < d) { d = dd; best = i; } }); return best; };
    const setBand = (i, f, g) => { const b = F.eq[i]; if (f != null) b.f = Math.min(16000, Math.max(20, f)); if (g != null) b.g = Math.round(g * 2) / 2; sendEq(); showEq(); };
    cvEq.addEventListener('pointerdown', (e) => {
      const p = at(e); band = nearest(p); showEq();
      cvEq.setPointerCapture(e.pointerId);
      const move = (ev) => { const m = at(ev); setBand(band, kToF(Math.min(1, Math.max(0, m.x))), gOfY(m.y, m.h)); };
      cvEq.onpointermove = move;
      cvEq.onpointerup = () => { cvEq.onpointermove = null; cvEq.onpointerup = null; };
    });
    cvEq.addEventListener('wheel', (e) => {
      const b = F.eq[band]; if (b.type !== 'peaking') return;
      e.preventDefault(); b.q = Math.min(8, Math.max(0.3, b.q * (e.deltaY > 0 ? 0.9 : 1.1))); sendEq(); showEq();
    }, { passive: false });
    cvEq.addEventListener('dblclick', (e) => { band = nearest(at(e)); setBand(band, null, 0); });
    cvEq.style.cursor = 'grab';
    q('[data-eqreset]').addEventListener('click', () => { F.eq = EQ_DEFAULT(); sendEq(); showEq(); });
  }
  showAll();

  // input level for the In meter
  const inBuf = new Float32Array(1024);
  const tickIn = () => {
    if (inA && sel === 'tc') {
      inA.getFloatTimeDomainData(inBuf); let pk = 0; for (const v of inBuf) pk = Math.max(pk, Math.abs(v));
      const dB = pk > 1e-5 ? 20 * Math.log10(pk) : -99;
      q('[data-inl]').style.height = Math.max(0, Math.min(1, 1 + dB / 36)) * 100 + '%';
      q('[data-inv]').textContent = dB > -99 ? dB.toFixed(1) : '-∞';
    }
    if (outA && sel === 'fq') drawEq();
    requestAnimationFrame(tickIn);
  };
  requestAnimationFrame(tickIn);

  return {
    state: F,
    // build the audio part: input -> tube -> echo -> (EQ) -> output
    async connect(c) {
      await c.audioWorklet.addModule(new URL('./tubecomp-worklet.js?v=1', import.meta.url));
      await c.audioWorklet.addModule(new URL('./tapeecho-worklet.js?v=3', import.meta.url));
      tube = new AudioWorkletNode(c, 'tube-comp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      echo = new AudioWorkletNode(c, 'tape-echo', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      tube.port.onmessage = ({ data }) => showGR(data.gr);
      const inTap = c.createGain(); inA = c.createAnalyser(); inA.fftSize = 1024;
      inTap.connect(tube); inTap.connect(inA);
      tube.connect(echo);
      let output = echo;
      if (withEq) { eqU = makeEq(c); echo.connect(eqU.input); output = eqU.output; outA = c.createAnalyser(); outA.fftSize = 4096; outA.smoothingTimeConstant = 0.8; output.connect(outA); }
      sendTube(); sendEcho(); sendEq();
      return { input: inTap, output };
    },
    get: () => JSON.parse(JSON.stringify(F)),
    set(obj) {
      const D = FINISH_DEFAULT();
      for (const k of Object.keys(D)) F[k] = obj && obj[k] !== undefined ? JSON.parse(JSON.stringify(obj[k])) : { ...D, ...defaults }[k];
      showAll(); sendTube(); sendEcho(); sendEq();
    },
  };
}
