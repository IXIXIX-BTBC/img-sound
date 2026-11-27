// IMG SOUND screen frame (11/19 Figma "写真シンセ UIワイヤー", AIR 58:5038 and the mode screens).
// Each page keeps its own HTML and script (they work as before); this module, loaded last, builds the
// 1440 x 1024 screen and MOVES the page's real controls into it (moving keeps every listener and reference).
// What is not on the new screen stays in the old layout, which opens from the menu as "詳しい表示".
// Stage 1 (11/19): layout + every existing feature. Stage 2: moving terrain, Sound with Scene, Project.
import { outMeter } from './out.js?v=5';
import { snapshot, restore } from './presets.js?v=2';
import { appLinks } from './app-link.js?v=1';
import { projectButton } from './project.js?v=5';
import { DEFAULT_SOUNDS } from './default-sounds.js?v=5';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
// "+" on something saved and changed (*): overwrite it, or save as a new one
const saveChoice = (what, name) => dlg({ title: 'Save ' + what, msg: `“${name}” has changes. Overwrite it, or save as a new ${what.toLowerCase()}?`, ok: 'Overwrite', alt: 'Save as new' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A dialog inside the device (instead of the browser's prompt / confirm).
//  save: dlg({ title, name, names, cur, what }) -> the name, or null.  Typing a name that exists turns Save into Overwrite;
//        when something is loaded (cur), one press puts its name back (= update it).
//  ask:  dlg({ title, msg, ok }) -> true / false
//  choice: dlg({ title, msg, ok: 'Overwrite', alt: 'Save as new' }) -> true (ok) / 'alt' / false
function dlg({ title, name = null, names = [], cur = '', what = '', msg = '', ok = 'Save', alt = '' }) {
  const host = document.querySelector('.js-ui-stage') || document.body;
  const bg = document.createElement('div'); bg.className = 'ui-dlg';
  const isSave = name != null;
  bg.innerHTML = `<div class="ui-dlg__box" role="dialog" aria-modal="true">
    <div class="ui-dlg__ttl">${esc(title)}</div>
    ${isSave ? `<label class="ui-dlg__lbl">Name</label><input class="ui-dlg__in" type="text" maxlength="40" value="${esc(name)}" spellcheck="false">
      <div class="ui-dlg__note"></div>
      ${cur ? `<div class="ui-dlg__cur">Loaded: <b>${esc(cur)}</b> <button class="ui-opt ui-dlg__upd" type="button" title="今読み込んでいる${esc(what)}を上書きする">Update this</button></div>` : ''}` : `<p class="ui-dlg__msg">${esc(msg)}</p>`}
    <div class="ui-dlg__btns"><button class="ui-opt ui-dlg__no" type="button">Cancel</button>${alt ? `<button class="ui-opt ui-dlg__alt" type="button">${esc(alt)}</button>` : ''}<button class="ui-opt ui-dlg__ok on" type="button">${esc(ok)}</button></div>
  </div>`;
  host.append(bg);
  const $q = (x) => bg.querySelector(x), inp = $q('.ui-dlg__in'), okB = $q('.ui-dlg__ok'), note = $q('.ui-dlg__note');
  const check = () => {
    const v = inp.value.trim(), ex = names.includes(v);
    okB.textContent = ex ? 'Overwrite' : ok; okB.disabled = !v;
    note.textContent = !v ? 'Enter a name' : ex ? `“${v}” is replaced with the current ${what}.` : `Saved as a new ${what}.`;
    note.classList.toggle('is-warn', ex);
  };
  return new Promise((res) => {
    const end = (v) => { bg.remove(); removeEventListener('keydown', key, true); res(v); };
    const go = () => { if (!isSave) return end(true); const v = inp.value.trim(); if (v) end(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(isSave ? null : false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } else e.stopPropagation(); };
    addEventListener('keydown', key, true); // typing a name must not play the keys
    $q('.ui-dlg__no').addEventListener('click', () => end(isSave ? null : false));
    okB.addEventListener('click', go);
    $q('.ui-dlg__alt')?.addEventListener('click', () => end('alt'));
    bg.addEventListener('pointerdown', (e) => { if (e.target === bg) end(isSave ? null : false); });
    if (isSave) { inp.addEventListener('input', check); $q('.ui-dlg__upd')?.addEventListener('click', () => { inp.value = cur; check(); inp.focus(); inp.select(); }); check(); inp.focus(); inp.select(); } else okB.focus();
  });
}
const MODE = document.body.dataset.uiMode; // AIR | Bolt | Quake
if (!new URLSearchParams(location.search).has('dub')) appLinks(MODE); // one-window app: switch modes without leaving
const PAGE = document.body.dataset.uiPage; // pixel | lead | bass (the preset key)

/* ---------- words: Japanese label -> English name (the Japanese stays as the hint) ---------- */
const WORDS = {
  // AIR
  '音階の細かさ': 'Resolution', '暗い側': 'Dark', '明るい側': 'Bright', '山の強調': 'Peak Emphasis', '弱い成分を切る': 'Floor',
  '成分の最大数': 'Max Partials', '近い音をまとめる': 'Merge Close', '寄せる強さ': 'Snap', '和音の種類': 'Chord', '範囲の横幅=': 'Width', 'ならし': 'Smooth',
  '波形の倍音の数': 'Harmonics', 'サインを混ぜる': 'Sine Mix', 'ノイズの量': 'Amount', '太さ': 'Width', 'ノイズの量の揺れ': 'Amount Drift',
  '太さの揺れ': 'Width Drift', 'ずらす幅': 'Spread', 'ピッチの揺れ幅': 'Pitch Depth', '音量の揺れ幅': 'Level Depth', 'うねり(ゆっくり)': 'Swell',
  '震え(細かく)': 'Flutter', '速さ': 'Rate', '音ごとの速さの違い': 'Rate Spread', '速さのうねり': 'Rate Drift', 'そろい具合': 'Coherence',
  'A 立ち上がり': 'Attack', 'D 落ちる速さ': 'Decay', 'S 残る量': 'Sustain', 'R 離した後': 'Release', '高い成分ほどDが短い': 'Decay Tilt',
  '写真の形の効き': 'Photo Shape', '響きの量': 'Mix', '距離': 'Distance', '空間の広さ(余韻)': 'Size', '旅の性格': 'Character',
  'さまよう広さ': 'Range', '広さの変化': 'Size Change', '速さの揺れ': 'Rate Swing', '戻る力': 'Home', '立ち寄り': 'Visit',
  // Bolt
  '行の位置': 'Position', '行の太さ': 'Width', 'なめらかさ': 'Smooth', '倍音の時間差': 'Time Offset', '倍音のずれ': 'Deviation',
  '倍音の伸び': 'Stretch', '倍音の残る長さ': 'Length', '胴体の量': 'Body', '響きの鋭さ': 'Body Q', 'サブの量': 'Sub', '一緒に揺らす': 'Together',
  '揺れの速さ': 'Rate', 'つなぎ方': 'Connect', '直列の深さ': 'Serial Depth', '混ぜ具合': 'Mix', 'ユニゾン': 'Unison', 'ずらし幅': 'Detune',
  '左右の広がり': 'Stereo', '行の波形の音量': 'Wave Level', '波形のぼかし': 'Blur', '押すと走る量': 'Run Amount', '走る速さ': 'Run Time',
  'LFO の量': 'LFO Amount', 'LFO の速さ': 'LFO Rate', 'カットオフ': 'Cutoff', 'レゾナンス': 'Resonance', 'エンベロープ量': 'Env Amount',
  '減衰': 'Decay', 'キー追従': 'Key Track', '同時に鳴らす数': 'Voices', 'グライド': 'Glide', 'アクセント': 'Accent', '歪み': 'Drive',
  '1行の成分の数': 'Partials', '基音の量': 'Root', '響き': 'Mix', 'BPM': 'BPM',
  // Quake
  '写真の効き': 'Photo Amount', 'ノイズの効き': 'Noise Amount', 'ひりつきの量': 'Amount', 'キンの高さ': 'Tone', '保つ時間': 'Hold',
  '落ちる速さ': 'Fall', '保つ間の減り': 'Hold Loss', '伸び': 'Stretch', '揺れの量': 'Amount', 'ワブルの量': 'Amount', 'LFOの速さ': 'LFO Rate',
  'LFOの形': 'LFO Shape', '閉じた所': 'Min', '開いた所': 'Max', 'クセ': 'Resonance', '写真の動き': 'Photo Motion', '芯の倍音も動かす': 'Core',
  'ずらし': 'Detune', '波形の走り': 'Scan', '細かい揺れ': 'Jitter', '小節ごとの変化': 'Drift', '音程のひと押し': 'Pitch Kick',
  'ひと押しの長さ': 'Kick Time', 'クリックの量': 'Click', 'クリックの明るさ': 'Click Tone', 'クリックの長さ': 'Click Length',
  // buttons and choices
  'ノーマル': 'Normal', '和音より': 'Consonant', '不協和音より': 'Dissonant', 'なし': 'Off', 'あり': 'On', 'オフ': 'Off', 'オン': 'On',
  '1 ピクセルの位置': 'Pixel', '2 その色の行': 'Row', '3 上下の順': 'Rank', 'サイン波': 'Sine', '写真の行の波形': 'Photo Row',
  'シーンを順に': 'Route', 'さまよう(パーリン)': 'Flow', '1周': 'Round', '30秒': '30s', '1分': '1min', '3分': '3min', '5分': '5min', '10分': '10min', '毎回新しい流れ': 'New Each Loop',
  '同じ流れをくり返す': 'Repeat', '新しい種': 'New Seed', '半音にそろえる': 'Semitone', '細かく(1/8半音)': '1/8 Semitone',
  '長三和音(明るい)': 'Major', '短三和音(暗い)': 'Minor', 'sus4(開いた響き)': 'Sus4', '7th(ブルージー)': '7th', '長三和音': 'Major', '短三和音': 'Minor',
  '毎回同じ': 'Fixed', '押すたびに少しずらす': 'Shift', 'ばらけた響き': 'Scattered', '楽器': 'Instrument', 'フィルター オフ': 'Off', 'フィルター オン': 'On',
  '1音(グライドあり)': 'Mono', '和音(グライドなし)': 'Poly', 'レガート(押したままは打ち直さない)': 'Legato', '毎回打ち直す': 'Retrigger',
  '並列(足し算)': 'Parallel', '直列:色で波形をゆがめる': 'Warp', '直列:色を波形に掛け合わせる': 'Multiply', '1小節': '1 bar', '2分': '1/2', '4分': '1/4',
  '8分': '1/8', '8分3連': '1/8T', '16分': '1/16', '4音': '4', '8音': '8', '写真あり': 'Photo', '写真なし(元のサイン)': 'No Photo (Sine)',
  'ローパス オフ': 'Off', 'ローパス オン': 'On', '音のもと: 写真': 'Photo', 'ノコギリ': 'Saw', 'リース': 'Reese', '毎回最初から(安定)': 'Retrigger',
  '走りっぱなし(生っぽい)': 'Free Run', 'EQ オン': 'On', 'EQ オフ(聴き比べ)': 'Off', 'サイン': 'Sine', '写真の道筋': 'Photo Path', '三角': 'Tri',
  '使わない': 'Off', 'A 速さ×開き': 'A', 'B 手でワウ': 'B', 'C 写真をなぞる': 'C', 'D 速さ×手の位置': 'D', // XY Pad modes: one letter each so they fit one row (the full name is the hint)
  '離すと戻る': 'Return', '離してもそのまま': 'Hold', '▶ フレーズを鳴らす': '▶ Play Phrase', '型のLFOの形を使う': 'Phrase', 'ワブルの欄の形のまま': 'Wobble',
  '縦: ふつう': 'Normal', '縦: 反転': 'Flip', '根音': 'Root', 'XYパッド': 'XY Pad', '定番のワブルのフレーズ': 'Phrases', '波形': 'Wave',
  'ノコギリ(下がる)': 'Saw', '矩形': 'Square', 'ベース': 'Bass', 'ワブル': 'Wobble', '最初の状態に戻す': 'Reset', '詳しく': 'More',
  '＋ 今の範囲をシーンに追加': 'Add Scene', '▶ ループ再生': '▶ Loop', '■ ループ停止': '■ Stop Loop', '▶ 1回鳴らす(C4)': '▶ Play Once (C4)',
};
const tr = (t) => { t = t.trim(); return WORDS[t] ?? WORDS[t.replace(/\s+/g, ' ')] ?? null; };

/* ---------- each mode: which settings, in which order (signal flow), what is open ---------- */
const CONF = {
  AIR: {
    title: 'Air', play: '.js-play',
    secs: [['音の並べ方', 'Pitch Map', 1], ['成分の選び方', 'Partials'], ['響き', 'Harmony', 1], ['成分の素材', 'Source', 1], ['ノイズ', 'Noise'],
      ['時間の形', 'Time Shape'], ['毎回少し違う', 'Variation'], ['揺らぎ', 'Drift'], ['打鍵の形', 'ADSR'], ['空間', 'Space']],
    hide: ['鍵盤', '強い成分'],
    waves: '.js-wavesbox',
    macro: [['Tone', '.js-gamma', '山の強調(はっきり⇔厚く)'], ['Motion', '.js-wobcents', '揺らぎ: ピッチの揺れ幅'], ['Texture', '.js-noise', 'ノイズの量'], ['Space', '.js-rvb', '空間: 響きの量']],
    adsr: ['.js-a', '.js-d', '.js-s', '.js-release'],
  },
  Bolt: {
    title: 'Bolt', play: '.js-start',
    secs: [['行', 'Row', 1], ['2つの層', 'Layers'], ['成分の素材', 'Source', 1], ['行の動き', 'Row Motion'], ['フィルター', 'Filter'], ['発音', 'Voice'],
      ['音の並べ方', 'Pitch Map'], ['空間', 'Space']],
    waves: '.js-ldwaves',
    macro: [['Tone', '.js-cutoff', 'フィルター: カットオフ'], ['Motion', '.js-lfoamt', '行の動き: LFO の量'], ['Texture', '.js-drive', '発音: 歪み'], ['Space', '.js-rvb', '空間: 響き']],
    adsr: ['.js-a', '.js-d', '.js-s', '.js-r'],
  },
  Quake: {
    title: 'Quake', play: '.js-hold', start: '.js-start',
    secs: [['写真から読んだ個性', 'Photo', 1], ['音の作り', '@engine'], ['ローパス', 'Lowpass'], ['ひりつき', 'Bite'], ['上の倍音の揺れ', 'Upper Wobble'],
      ['ワブル', 'Wobble'], ['アタック', 'Attack'], ['発音', 'Envelope']],
    hide: ['EQ'],
    macro: [['Tone', '.js-bf', 'ローパス: カットオフ(Bass)'], ['Motion', '.js-wamt', 'ワブルの量(Wobble)'], ['Texture', '.js-gamt', 'ひりつきの量(Bass)'], ['Space', '[data-k="teEcho"]', 'テープエコー: エコーの音量']],
    adsr: ['.js-a', '.js-d', '.js-s', '.js-r'],
  },
}[MODE];

/* ---------- icons ---------- */
const ICON = { // shapes exported from Figma (Header / panel heads / effect boxes)
  AIR: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">' + [9.47, 16.49, 23.51, 30.53].flatMap((y) => [9.47, 16.49, 23.51, 30.53].map((x) => `<circle cx="${x}" cy="${y}" r="1.47"/>`)).join('') + '</svg>',
  Bolt: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor"><path d="M19.9964 20H7.96387L22.9674 8H34.9999L19.9964 20Z"/><path d="M17.0325 32H5L20.0035 20H32.0361L17.0325 32Z"/></svg>',
  Quake: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor"><path d="M23.995 11.2258C28.8325 11.2258 32.767 15.1613 32.767 20C32.767 22.3468 31.8559 24.5484 30.1951 26.2016C28.5342 27.8629 26.3331 28.7742 23.995 28.7742C21.6569 28.7742 19.4478 27.8629 17.795 26.2016C16.1341 24.5403 15.223 22.3387 15.223 20C15.223 15.1613 19.1575 11.2258 23.995 11.2258ZM23.995 8C17.3677 8 11.998 13.371 11.998 20C11.998 26.629 17.3677 32 23.995 32C30.6224 32 35.992 26.629 35.992 20C35.992 13.371 30.6224 8 23.995 8Z"/><path d="M15.997 11.2258C20.8345 11.2258 24.769 15.1613 24.769 20C24.769 24.8387 20.8345 28.7742 15.997 28.7742C11.1595 28.7742 7.22499 24.8387 7.22499 20C7.22499 15.1613 11.1595 11.2258 15.997 11.2258ZM15.997 8C9.36961 8 4 13.371 4 20C4 26.629 9.36961 32 15.997 32C22.6243 32 27.994 26.629 27.994 20C27.994 13.371 22.6243 8 15.997 8Z"/></svg>',
  Dub: '<svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor"><path d="M19.9999 11.2258C24.8374 11.2258 28.7719 15.1613 28.7719 20C28.7719 22.3468 27.8608 24.5484 26.2 26.2016C24.5391 27.8629 22.338 28.7742 19.9999 28.7742C17.6618 28.7742 15.4527 27.8629 13.7999 26.2016C12.139 24.5403 11.2279 22.3387 11.2279 20C11.2279 15.1613 15.1624 11.2258 19.9999 11.2258ZM19.9999 8C13.3725 8 8.00293 13.371 8.00293 20C8.00293 26.629 13.3725 32 19.9999 32C26.6273 32 31.9969 26.629 31.9969 20C31.9969 13.371 26.6273 8 19.9999 8Z"/></svg>',
  midi: '<svg width="33" height="32" viewBox="0 0 33 32" fill="none"><circle cx="15" cy="17" r="12.25" fill="white" stroke="#1B2A13" stroke-width="1.5"/><g fill="#1B2A13"><circle cx="8" cy="17" r="1.6"/><circle cx="10" cy="12" r="1.6"/><circle cx="15" cy="10" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="22" cy="17" r="1.6"/></g><rect x="13" y="24" width="4" height="3" fill="#1B2A13"/></svg>',
  route: '<svg width="36" height="24" viewBox="0 0 36 24" fill="currentColor"><path d="M0 24C6.64989 24 12.0378 18.629 12.0378 12C12.0378 5.37097 6.64989 0 0 0V24Z"/><path d="M11.884 24C18.5339 24 23.9218 18.629 23.9218 12C23.9218 5.37097 18.5339 0 11.884 0V24Z"/><path d="M23.9622 24C30.612 24 35.9999 18.629 35.9999 12C35.9999 5.37097 30.612 0 23.9622 0V24Z"/></svg>',
  flow: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12.241 3.22581C16.9825 3.22581 20.839 7.16129 20.839 12C20.839 16.8387 16.9825 20.7742 12.241 20.7742H11.759C7.01745 20.7742 3.16101 16.8387 3.16101 12C3.16101 7.90323 5.9269 4.45968 9.6569 3.5C9.27758 2.96774 9.0484 2.31452 9.0484 1.6129C9.0484 1.12903 9.15904 0.669355 9.3487 0.258065C4.01449 1.39516 0 6.22581 0 12C0 18.621 5.27889 24 11.759 24H12.241C18.729 24 24 18.6129 24 12C24 5.3871 18.7211 0 12.241 0H12.2094C11.3401 0 10.6289 0.725806 10.6289 1.6129C10.6289 2.5 11.3401 3.22581 12.2094 3.22581H12.241Z"/></svg>',
  bass: '<svg width="46" height="22" viewBox="0 0 46 22" fill="currentColor"><path d="M11.213 21.8733C9.75241 21.8733 8.27662 21.5995 6.86168 21.0213C2.70816 19.3173 0.0760718 15.5137 0 11.0711V10.8581H6.08575C6.11618 12.9577 7.27247 14.6161 9.17426 15.392C10.7566 16.031 13.0844 16.0919 14.9101 14.2966L26.0318 3.29658C29.1659 0.177633 33.715 -0.811302 37.9142 0.679706C41.9156 2.10986 44.6694 5.57873 45.0954 9.73225C45.141 10.1735 45.1715 10.6147 45.1715 11.0711H39.0857C39.0857 10.8277 39.0857 10.5995 39.0553 10.3713C38.7814 7.73917 36.7427 6.73502 35.8755 6.43074C34.3388 5.88302 32.0567 5.89823 30.3222 7.61746L19.2005 18.6174C17.0401 20.7475 14.1646 21.8885 11.2434 21.8885L11.213 21.8733Z"/></svg>',
  wob: '<svg width="42" height="22" viewBox="0 0 42 22" fill="currentColor"><path d="M34.2019 22L29.3181 17.1162L24.4343 22L21.9848 19.5505C19.5961 17.1618 17.6334 14.1037 15.9751 10.1936C14.9253 7.69847 12.491 6.08575 9.76762 6.08575H0V0H9.76762C14.9253 0 19.5657 3.0733 21.574 7.82018C22.4716 9.9502 23.4606 11.7455 24.5712 13.2517L29.3181 8.50483L34.2019 13.3886L36.9405 10.6501L41.2461 14.9557L34.2171 21.9848L34.2019 22Z"/></svg>',
};

/* ---------- build ---------- */
function build() {
  const ui = document.createElement('div');
  ui.className = 'ui';
  ui.innerHTML = `
  <div class="ui-stage js-ui-stage" data-view="wave" data-umode="${MODE}">
    <div class="ui-card"></div>
    <a class="ui-abs ui-logo" href="../" title="写真シンセ"><img src="../img/logo.svg" alt="IMG SOUND"></a>
    <nav class="ui-abs ui-modes">
      <a class="ui-mode${MODE === 'AIR' ? ' on' : ''}" href="../pixel/" title="AIR(アンビエント)">${ICON.AIR}</a>
      <a class="ui-mode${MODE === 'Bolt' ? ' on' : ''}" href="../lead/" title="Bolt(リード)">${ICON.Bolt}</a>
      <a class="ui-mode${MODE === 'Quake' ? ' on' : ''}" href="../bass/" title="Quake(ベース)">${ICON.Quake}</a>
      <a class="ui-mode ui-mode--dub" href="../dub/" title="Dub(フレーズ)">${ICON.Dub}</a>
    </nav>
    <div class="ui-abs ui-vol js-ui-vol"></div>
    <button class="ui-abs ui-midi js-ui-midi" type="button" title="MIDI: 押して接続">${ICON.midi}<i class="ui-midi__dot"></i></button>
    <button class="ui-abs ui-btn ui-transport js-ui-play" type="button" title="鳴らす / 止める(Esc で全部止める)"><i class="ui-play"></i></button>
    <button class="ui-abs ui-btn ui-project is-dis" type="button"><span>Project</span><i class="ui-plus"></i></button>
    <button class="ui-abs ui-btn ui-menu js-ui-menu" type="button" title="メニュー"><i class="ui-menuic"></i></button>
    <div class="ui-abs ui-menubox js-ui-menubox" hidden>
      <button class="js-ui-more" type="button">詳しい表示(元の画面)を開く</button>
      <button class="js-ui-notes" type="button">説明の文章を表示する</button>
      <button class="js-ui-panic" type="button">全部止める(Esc)</button>
      <button class="js-ui-export" type="button">写真を書き出す</button>
      <div class="ui-menubox__sep"></div>
      <div class="ui-menubox__cm js-ui-cmfull"></div>
      <div class="ui-menubox__st js-ui-status"></div>
    </div>

    <!-- Scene -->
    <div class="ui-abs ui-scene">
      <div class="ui-scene__head"><span class="js-ui-scenename">Scene-01</span><i class="ui-scene__bar"></i></div>
      <div class="ui-scene__photo js-ui-photo"></div>
      <div class="ui-scene__thumbs js-ui-thumbs"></div>
    </div>
    <i class="ui-abs ui-line" style="left:360px;top:139px;width:24px;height:4px"></i>
    <div class="ui-abs ui-cmap">
      <span class="ui-cmap__lbl" data-hint="色と音の対応。Basic=色相環の順(赤→C…)/ Random=12色の音名を入れ替える。細かい設定はメニューから">Color Map</span>
      <button class="ui-btn js-ui-basic" type="button">Basic</button><button class="ui-btn js-ui-random" type="button">Random</button>
    </div>
    <button class="ui-abs ui-btn ui-sceneadd js-ui-sceneadd" type="button"><span>Scene</span><i class="ui-plus"></i></button>

    <!-- main panel -->
    <div class="ui-abs ui-panel"></div>
    <div class="ui-abs ui-phead">
      <span class="ui-title">${CONF.title}</span><span class="ui-ptools js-ui-ptools"></span>
    </div>
    <div class="ui-abs ui-sname">
      <span class="js-ui-sname" title="押すと Sound の一覧">Sound-01</span>
      <ul class="ui-sdrop js-ui-sdrop"></ul>
    </div>
    <div class="ui-abs ui-bpm js-ui-bpm" title="テンポ(全モード共通)。押して変更"><span class="js-ui-bpmv">120</span><div class="ui-bpm__pop js-ui-bpmpop" hidden></div></div>
    <div class="ui-abs ui-visual js-ui-visual">
      <div class="ui-now"><canvas class="js-ui-now" width="1290" height="560"></canvas></div>
      <div class="ui-wfs js-ui-wfs"><span class="ui-wfs__lbl">Waveforms</span></div>
      <div class="ui-terrain js-ui-terrain"><span>Terrain — coming in stage 2</span></div>
    </div>
    <div class="ui-abs ui-viewtg js-ui-viewtg"><button class="ui-opt on" data-v="wave" type="button">Wave</button><button class="ui-opt" data-v="terrain" type="button">Terrain</button></div>
    <i class="ui-abs ui-colline"></i>
    <div class="ui-abs ui-col js-ui-col"></div>
    <button class="ui-abs ui-full js-ui-full" type="button" title="設定を薄緑の画面いっぱいに"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1h5v5M13 1 8 6M6 13H1V8M1 13l5-5"/></svg></button>

    <!-- lower row -->
    <div class="ui-low">
      <div class="ui-abs ui-lbox js-ui-lbox" data-tab="macro">
        <div class="ui-lbox__tabs"><button class="ui-ltab on" data-t="macro" type="button">Macro</button><button class="ui-ltab" data-t="adsr" type="button">ADSR</button><button class="ui-ltab" data-t="visual" type="button">Visual</button></div>
        <div class="ui-lpane ui-lpane--macro js-ui-macro"></div>
        <div class="ui-lpane ui-lpane--adsr js-ui-adsr"></div>
        <div class="ui-lpane ui-lpane--visual"><span>Visual — coming in stage 2</span></div>
      </div>
      <i class="ui-abs ui-line" style="left:406px;top:687px;width:4px;height:25px"></i>
      <i class="ui-abs ui-line" style="left:586px;top:731px;width:724px;height:4px"></i>
      <i class="ui-abs ui-line" style="left:1151px;top:731px;width:4px;height:88px"></i>
      <div class="ui-abs ui-fxrow js-ui-fxrow"></div>
      <div class="ui-abs ui-fxarea js-ui-fxarea"></div>
      <button class="ui-abs ui-btn ui-soundadd js-ui-soundadd" type="button" title="今の音を Sound として保存"><span>Sound</span><i class="ui-plus"></i></button>
      <div class="ui-abs ui-slist"><span class="ui-slist__ttl">Sound List</span><button class="ui-slist__big js-ui-slbig" type="button" title="一覧を大きく表示"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1h5v5M13 1 8 6M6 13H1V8M1 13l5-5"/></svg></button><ul class="js-ui-slist"></ul></div>
      <div class="ui-abs ui-bigsl js-ui-bigsl" hidden><div class="ui-bigsl__head"><span>Sound List</span><span class="ui-bigsl__n js-ui-bigsln"></span><button class="ui-bigsl__close js-ui-bigslclose" type="button" title="閉じる(エフェクトの表示に戻る)">×</button></div><ul class="ui-bigsl__list js-ui-bigslul"></ul></div>
      <div class="ui-abs ui-bigsl js-ui-bigloop" hidden><div class="ui-bigsl__head"><span>Loop List</span><span class="ui-bigsl__n js-ui-bigloopn"></span><button class="ui-bigsl__close js-ui-bigloopclose" type="button" title="閉じる(エフェクトの表示に戻る)">×</button></div><ul class="ui-bigsl__list js-ui-bigloopul"></ul></div>
      <div class="ui-abs ui-out">
        <span class="ui-out__ttl">Output</span>
        <div class="ui-out__body">
          <div class="ui-meter"><b><i class="js-ui-ml"></i></b><span>L</span></div>
          <div class="ui-meter"><b><i class="js-ui-mr"></i></b><span>R</span></div>
          <div class="ui-peak"><span class="ui-peak__lbl">Peak</span><span class="ui-peak__v js-ui-peak">-∞ dB</span><span class="ui-peak__lim js-ui-lim"><i></i>Limit</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="ui-hint js-ui-hint"></div>
  <div class="ui-dropov js-ui-dropov"><span>Drop photos to add</span></div>`;
  document.body.prepend(ui);
  return ui;
}

function move() {
  const ui = $('.ui'), old = $('main.px'), hd = $('header.hd');
  old.classList.add('ui-oldmain'); hd.classList.add('ui-oldhd');
  // close button for the old layout overlay
  const close = document.createElement('button'); close.className = 'ui-oldclose js-ui-oldclose'; close.type = 'button'; close.textContent = '× 閉じる';
  old.prepend(close);

  // header
  const vol = $('.js-volume'); const volBox = $('.js-ui-vol', ui);
  volBox.innerHTML = '<div class="ui-vol__head"><span>Volume</span><b class="ui-val js-ui-volv"></b></div>';
  volBox.append(vol);
  const showVol = () => { const v = +vol.value; $('.js-ui-volv', ui).textContent = v > 0.001 ? (20 * Math.log10(v)).toFixed(0) + 'dB' : '-∞'; };
  vol.addEventListener('input', showVol); showVol();
  const status = $('.js-status'); if (status) $('.js-ui-status', ui).append(status);
  // Color Map details (note order) into the menu
  const no = $('.js-noteorder'); if (no) $('.js-ui-cmfull', ui).append(no);
  // presets bar (the old one) into the menu too, so nothing is lost
  const pre = $('.js-presets'); if (pre) $('.js-ui-cmfull', ui).append(pre);

  // photo + thumbnails
  $('.js-ui-photo', ui).append($('.js-drop'));
  $('.js-ui-thumbs', ui).append($('.js-cards'));

  // visual area: now playing (drawn here) + the mode's own pictures
  const wfs = $('.js-ui-wfs', ui), vis = $('.js-ui-visual', ui);
  if (MODE === 'AIR' || MODE === 'Bolt') {
    const w = $(CONF.waves);
    if (w) {
      wfs.append(w);
      // Waveforms as 6 framed cards (Figma): the page draws 6 slots side by side on one canvas; each card shows one slot
      const src = w.querySelector('canvas'); src.classList.add('ui-wsrc');
      const cards = document.createElement('div'); cards.className = 'ui-wcards';
      const cvs = [...Array(6)].map(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 180; c.className = 'ui-inv'; const d = document.createElement('div'); d.className = 'ui-wcard'; d.append(c); cards.append(d); return c; });
      w.append(cards);
      const copy = () => { const sw = src.width / 6; cvs.forEach((c, i) => { const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, i * sw, 0, sw, src.height, 0, 0, c.width, c.height); }); };
      setInterval(() => { if (!w.hidden) copy(); }, 300); copy();
    }
  }
  if (MODE === 'Bolt') { // Figma 118:6530: the row being read, its brightness left -> right (what the row-wave layer plays)
    const box = document.createElement('div'); box.className = 'ui-rowb';
    box.innerHTML = '<span class="ui-rowb__lbl" data-hint="今読んでいる行の明るさ(左→右)。行の波形の層が鳴らしている形そのもの。Position や Row Motion で行が動くと、この線も動きます">Row brightness (now) — what the row wave plays</span><canvas width="1200" height="150"></canvas>';
    vis.append(box);
    const cv = box.querySelector('canvas'), g = cv.getContext('2d'), img = $('.js-img'), rb = $('.js-rowbase');
    let lastKey = '';
    const draw = () => {
      if (!img || !img.width) return;
      const row = window.__ld?.liveRow ?? +rb.value, y = Math.round(Math.min(1, Math.max(0, row)) * (img.height - 1));
      const key = img.width + 'x' + img.height + ':' + y + ':' + (img._v || 0); if (key === lastKey) return; lastKey = key;
      let d; try { d = img.getContext('2d').getImageData(0, y, img.width, 1).data; } catch { return; }
      const W = cv.width, H = cv.height, n = img.width, L = (x) => (0.2126 * d[x * 4] + 0.7152 * d[x * 4 + 1] + 0.0722 * d[x * 4 + 2]) / 255;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(160,179,87,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      const path = () => { g.beginPath(); for (let x = 0; x < n; x++) { const X = (x / (n - 1)) * W, Y = H - 6 - L(x) * (H - 12); x ? g.lineTo(X, Y) : g.moveTo(X, Y); } };
      path(); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(160,179,87,.35)'; g.fill();
      path(); g.strokeStyle = '#1b2a13'; g.lineWidth = 2.5; g.stroke();
    };
    setInterval(draw, 80); draw();
  }
  if (MODE === 'AIR') buildLoopView(vis);
  if (MODE === 'Quake') {
    vis.classList.add('ui-visual--quake');
    const boxes = $$('.mx__box');
    const scope = boxes.find((b) => $('.js-scope', b)), xy = boxes.find((b) => $('.js-xy', b)), ph = boxes.find((b) => $('.js-phrases', b));
    if (scope) { const hb = scope.querySelector('.wave__head b'); if (hb) hb.textContent = 'Wave'; scope.classList.add('ui-q-scope'); $$('canvas', scope).forEach((c) => c.classList.add('ui-inv')); vis.append(scope); }
    for (const [b, c] of [[xy, 'ui-q-xy'], [ph, 'ui-q-ph']]) {
      if (!b) continue; b.classList.add(c); vis.append(b); dress(b);
      const hb = b.querySelector('.wave__head b'); if (hb && tr(hb.textContent)) hb.textContent = tr(hb.textContent);
      for (const l of b.querySelectorAll('.loopbar__lbl')) l.hidden = true;
    }
    // phrase names in English (the order of bass/phrases.js); the page re-renders the list, so keep renaming
    const PHR = ['Wob Build', 'Triplet Stumble', 'Call & Answer', 'Half-time Gap', 'Choppy', 'Speed Up & Drop'];
    const phrs = $('.js-phrases');
    const nameP = () => [...phrs.children].forEach((el, i) => { const t = el.querySelector('.phr__hd b'); const want = `${i + 1}  ${PHR[i] || ''}`; if (t && PHR[i] && t.textContent !== want) { t.dataset.hint ||= t.textContent; t.textContent = want; } });
    if (phrs) { new MutationObserver(nameP).observe(phrs, { childList: true, subtree: true, characterData: true }); nameP(); }
    // the component view with the EQ dots goes into the EQ section (below, after sections are placed)
  }

  // settings column
  const col = $('.js-ui-col', ui);
  const grps = $$('aside.panel > .grp');
  const take = (key) => { const i = grps.findIndex((g) => ($('.grp__ttl', g)?.textContent || '').trim().startsWith(key)); return i < 0 ? null : grps.splice(i, 1)[0]; };
  (CONF.hide || []).forEach((k) => take(k));
  for (const [key, en, open] of CONF.secs) {
    const sec = take(key);
    if (!sec) continue;
    if (en === '@engine') continue; // Quake: the engine switch moves to the panel head; the old buttons stay in the old layout
    makeSection(sec, en, !!open);
    col.append(sec);
  }
  grps.forEach((g) => { makeSection(g, ($('.grp__ttl', g)?.textContent || '').trim(), false); col.append(g); }); // anything not listed: at the end
  if (MODE === 'Quake') {
    // Wobble: the wobble layer (sound source + the LFO path read from the photo) under the XY pad and phrases
    const wl = $('.js-wpath')?.closest('.mx__box');
    if (wl) {
      wl.classList.add('ui-q-wob'); // its graphs draw in the screen's own colors (no inverting)
      const hb = wl.querySelector('.wave__head b'); if (hb) { hb.dataset.hint = hb.textContent + ' — ' + (wl.querySelector('.wave__head span')?.textContent || ''); hb.textContent = 'Wobble layer (source · LFO path)'; }
      vis.append(wl); window.__drawWPath?.();
    }
    // the three explanatory graphs go into their own sections, right under the title (they hide with the engine)
    for (const [cv, sec, en] of [['.js-gritcv', 'Bite', 'Bite partials (at the strike)'], ['.js-shimcv', 'Upper Wobble', 'Upper wobble shape'], ['.js-attack', 'Attack', 'The strike (first 120 ms)']]) {
      const box = $(cv)?.closest('.mx__box'), s2 = $$('.ui-sec', col).find((x) => x.dataset.sec === sec);
      if (!box || !s2) continue;
      box.classList.add('ui-q-graph'); $$('canvas', box).forEach((c) => c.classList.add('ui-inv'));
      const hb = box.querySelector('.wave__head b'); if (hb) { hb.dataset.hint = hb.textContent + ' — ' + (box.querySelector('.wave__head span')?.textContent || ''); hb.textContent = en; }
      // Figma 115:7850: framed boxes in a 2-column grid under the wave
      let grid = vis.querySelector('.ui-q-graphs'); if (!grid) { grid = document.createElement('div'); grid.className = 'ui-q-graphs'; vis.append(grid); }
      grid.append(box);
    }
  }

  // effects
  const fin = $('.js-finish');
  $('.js-ui-fxrow', ui).append($('.fx-row', fin));
  $('.js-ui-fxarea', ui).append($('.fx-area', fin));
}

// AIR: Loop mode (Figma 17:14562). The page's own loop controls are moved in.
function buildLoopView(vis) {
  const loop = $('.js-loop'); if (!loop) return;
  const box = loop.closest('.px__list');
  const lv = document.createElement('div'); lv.className = 'ui-loopv';
  lv.innerHTML = `<div class="ui-loopv__bar"><div class="ui-loopv__ttl">Loop</div><div class="ui-loopv__modes"></div><button class="ui-loopv__play js-ui-loopplay" type="button" title="ループを再生 / 停止"><i class="ui-play"></i></button><div class="ui-loopv__len"></div><div class="ui-loops"><span class="ui-loops__name js-ui-loopname" title="押すと保存した Loop の一覧">Loop-01</span><button class="ui-loops__big js-ui-loopbig" type="button" title="保存した Loop の一覧を大きく表示"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1h5v5M13 1 8 6M6 13H1V8M1 13l5-5"/></svg></button><button class="ui-loops__save js-ui-loopsave" type="button" title="今のシーンの並びとループの設定を保存"><i class="ui-plus"></i></button><ul class="ui-loops__drop js-ui-loopdrop"></ul></div></div>
    <div class="ui-loopv__scenes"><button class="ui-loopv__add js-ui-loopadd" type="button" title="今の範囲をシーンに追加"><i class="ui-plus ui-plus--l"></i></button></div>
    <div class="ui-loopv__params"></div>
    <p class="ui-loopv__msg"></p>`;
  const q = (c) => lv.querySelector(c);
  const modes = $$('[data-loopmode]'); modes.forEach((b) => q('.ui-loopv__modes').append(b));
  const play = q('.js-ui-loopplay'); play.addEventListener('click', () => loop.click());
  const showPlay = () => play.classList.toggle('is-on', loop.classList.contains('is-on'));
  new MutationObserver(showPlay).observe(loop, { attributes: true, attributeFilter: ['class'] }); showPlay();
  for (const el of $$('[data-scenesopt]', box)) { if (el.matches('.loopbar__lbl')) { el.dataset.hint = el.textContent.trim(); el.textContent = 'Round'; } q('.ui-loopv__len').append(el); }
  const add = $('.js-addscene'); q('.js-ui-loopadd').addEventListener('click', () => add?.click());
  q('.ui-loopv__scenes').append($('.js-scenes'));
  q('.ui-loopv__msg').append($('.js-loop-msg'));
  const NAMES = { '.js-wrange': 'Wander', '.js-wsize': 'Wander Drift', '.js-wspeed': 'Speed', '.js-wspeedvar': 'Speed Drift', '.js-whome': 'Pull Back', '.js-wvisit': 'Dwell' };
  const params = q('.ui-loopv__params');
  for (const [sel, en] of Object.entries(NAMES)) { const r = $(sel)?.closest('.row'); if (!r) continue; const sp = r.querySelector('span'); sp.dataset.hint = sp.textContent.trim(); sp.textContent = en; r.dataset.wander = '1'; params.append(r); }
  const lv0 = $('.js-loopvol');
  if (lv0) { const r = document.createElement('div'); r.className = 'row'; const sp = document.createElement('span'); sp.textContent = 'Level'; sp.dataset.hint = 'ループの音量'; const old = lv0.closest('label'); r.append(sp, lv0, $('.js-loopvol-v')); params.append(r); if (old) old.hidden = true; }
  // Flow: new flow each loop / repeat the same flow, and a new seed
  const seedBar = $('.js-wnewseed')?.closest('.loopbar');
  if (seedBar) { seedBar.classList.add('ui-loopv__seed'); seedBar.dataset.wander = '1'; params.after(seedBar); }
  const wtype = $('.js-wtype')?.closest('.row'); if (wtype) { const sp = wtype.querySelector('span'); sp.dataset.hint = sp.textContent.trim(); sp.textContent = 'Character'; wtype.dataset.wander = '1'; params.append(wtype); }
  // saved Loops: the scene order + the loop settings, under a name (localStorage, this page only)
  {
    const KEY = 'photoSynth.loops.pixel', CUR = 'photoSynth.loop.pixel';
    const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
    const put = (a) => localStorage.setItem(KEY, JSON.stringify(a));
    const SLIDERS = ['.js-loopvol', '.js-wtype', '.js-wrange', '.js-wsize', '.js-wspeed', '.js-wspeedvar', '.js-whome', '.js-wvisit'];
    const TABS = ['loopmode', 'looplen', 'wkeep'];
    const grab = () => ({
      v: Object.fromEntries(SLIDERS.map((sl) => [sl, $(sl)?.value])),
      tabs: Object.fromEntries(TABS.map((a) => [a, $(`[data-${a}].is-on`)?.dataset[a]])),
    });
    const apply = async (st) => {
      for (const [a, val] of Object.entries(st.tabs || {})) { const b = val != null && $(`[data-${a}="${val}"]`); if (b && !b.classList.contains('is-on')) b.click(); }
      for (const [sl, val] of Object.entries(st.v || {})) { const el = $(sl); if (el && val != null && el.value !== val) { el.value = val; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }
    };
    const day = (t) => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
    const nameEl = q('.js-ui-loopname'), drop = q('.js-ui-loopdrop');
    let cur = localStorage.getItem(CUR) || '', base = null; // base = the loaded loop as it is on screen (to see changes)
    const now = () => JSON.stringify({ s: (window.__airScenes?.get() || []).map((x) => [x.pid, x.rect]), ...grab() });
    const isDirty = () => !!cur && base != null && now() !== base;
    const draw = () => {
      const a = all();
      nameEl.textContent = cur ? cur + (isDirty() ? ' *' : '') : 'Loop-' + String(a.length + 1).padStart(2, '0') + '*';
      drop.innerHTML = a.map((x, i) => `<li class="${x.name === cur ? 'on' : ''}" data-i="${i}"><span>${esc(x.name)}</span><small>${x.scenes.length} scenes · ${day(x.t)}</small><button type="button" class="ui-loops__del" data-del="${i}" title="消す">×</button></li>`).join('') || '<li class="ui-empty">No loops yet. ＋ saves the current scenes and settings.</li>';
      const bul = $('.js-ui-bigloopul');
      if (bul) {
        bul.innerHTML = a.map((x, i) => `<li class="${x.name === cur ? 'on' : ''}" data-i="${i}"><span class="ui-bigsl__name">${esc(x.name)}</span><small>${x.tabs?.loopmode === 'wander' ? 'Wander' : x.scenes.length + ' scenes'} · ${day(x.t)}</small><button class="ui-sdel" data-del="${i}" type="button" title="消す">×</button></li>`).join('') || '<li class="ui-empty">No loops yet. Save with +</li>';
        $('.js-ui-bigloopn').textContent = a.length ? a.length + ' loops' : '';
      }
    };
    q('.js-ui-loopsave').addEventListener('click', async () => {
      const api = window.__airScenes; if (!api) return;
      if (isDirty() && all().some((x) => x.name === cur)) {
        const c = await saveChoice('Loop', cur); if (!c) return;
        if (c === true) { const a = all(), at = a.findIndex((x) => x.name === cur); a[at] = { name: cur, t: Date.now(), scenes: api.get(), ...grab() }; put(a); base = now(); draw(); return; }
      }
      const a = all(); let n = a.length + 1; while (a.some((x) => x.name === 'Loop-' + String(n).padStart(2, '0'))) n++;
      const nm = await dlg({ title: 'Save Loop', name: 'Loop-' + String(n).padStart(2, '0'), names: a.map((x) => x.name), cur, what: 'loop' }); if (!nm) return;
      const rec = { name: nm, t: Date.now(), scenes: api.get(), ...grab() };
      const at = a.findIndex((x) => x.name === nm);
      if (at >= 0) a[at] = rec; else a.push(rec);
      put(a); cur = nm; localStorage.setItem(CUR, cur); base = now(); draw();
    });
    nameEl.addEventListener('click', () => { draw(); drop.classList.toggle('is-open'); });
    let chk = 0; const recheck = () => { clearTimeout(chk); chk = setTimeout(() => { if (!cur) return; const want = cur + (isDirty() ? ' *' : ''); if (nameEl.textContent !== want) nameEl.textContent = want; }, 200); };
    for (const ev of ['input', 'change', 'click']) document.addEventListener(ev, (e) => { if (e.isTrusted) recheck(); }, true);
    if (cur) setTimeout(() => { base = now(); draw(); }, 1500);
    const del = async (i) => { const a = all(), x = a[i]; if (x && await dlg({ title: 'Delete Loop', msg: `Delete “${x.name}”? The scenes themselves stay.`, ok: 'Delete' })) { a.splice(i, 1); put(a); if (x.name === cur) { cur = ''; localStorage.removeItem(CUR); } draw(); } };
    const load = async (i) => {
      const x = all()[i]; if (!x) return;
      if (loop.classList.contains('is-on')) loop.click(); // stop, then swap the order
      window.__airScenes?.set(x.scenes); await apply(x);
      cur = x.name; localStorage.setItem(CUR, cur); setTimeout(() => { base = now(); draw(); }, 50);
    };
    drop.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]'); if (d) { del(+d.dataset.del); return; }
      const li = e.target.closest('[data-i]'); if (!li) return;
      await load(+li.dataset.i); drop.classList.remove('is-open');
    });
    // big list: takes the place of the effect settings, like the Sound List (only one of the two at a time)
    const bigBox = $('.js-ui-bigloop'), bigBtn = q('.js-ui-loopbig');
    if (bigBox) {
      const setBig = (on) => {
        if (on) { const sb = $('.js-ui-bigsl'); if (sb) sb.hidden = true; $('.js-ui-slbig')?.classList.remove('on'); }
        bigBox.hidden = !on; bigBtn.classList.toggle('on', on);
        $('.js-ui-stage')?.classList.toggle('is-bigsl', on || !$('.js-ui-bigsl')?.hidden);
        if (on) { drop.classList.remove('is-open'); draw(); }
      };
      bigBtn.addEventListener('click', () => setBig(bigBox.hidden));
      $('.js-ui-bigloopclose').addEventListener('click', () => setBig(false));
      $('.js-ui-fxrow')?.addEventListener('click', () => setBig(false), true);
      $('.js-ui-slbig')?.addEventListener('click', () => { if (!bigBox.hidden) { bigBox.hidden = true; bigBtn.classList.remove('on'); } }, true);
      $('.js-ui-bigloopul').addEventListener('click', (e) => {
        const d = e.target.closest('[data-del]'); if (d) { del(+d.dataset.del); return; }
        const li = e.target.closest('[data-i]'); if (li) load(+li.dataset.i);
      });
      addEventListener('storage', (e) => { if (e.key === KEY) draw(); });
    }
    document.addEventListener('click', (e) => { if (!e.target.closest('.ui-loops')) drop.classList.remove('is-open'); });
    draw();
  }
  dress(lv);
  // Figma 104:5803: the range moving over the photo (the page's own loop picture, 240 x 160) left of Now Playing
  const lvCv = $('.js-loopview');
  if (lvCv) {
    const ph = document.createElement('div'); ph.className = 'ui-loopv-photo';
    ph.append(lvCv); const pos = $('.js-loop-pos'); if (pos) ph.append(pos);
    vis.prepend(ph);
  }
  vis.append(lv);
  const showMode = () => { lv.dataset.lmode = $('[data-loopmode].is-on')?.dataset.loopmode || 'scenes'; };
  modes.forEach((b) => new MutationObserver(showMode).observe(b, { attributes: true, attributeFilter: ['class'] })); showMode();
}

// an old ".grp" becomes a folding section: English title, rows as name/value/slider, small selects as buttons
function makeSection(sec, en, open) {
  sec.classList.add('ui-sec'); sec.dataset.sec = en;
  const h2 = $('.grp__ttl', sec);
  const ja = h2 ? h2.textContent.trim() : '';
  const head = document.createElement('button'); head.type = 'button'; head.className = 'ui-sec__h';
  head.innerHTML = `<i class="ui-chev"></i><span>${esc(en)}</span>`; head.title = ja;
  if (h2) h2.replaceWith(head); else sec.prepend(head);
  sec.classList.toggle('is-closed', !open);
  dress(sec);
}

function dress(root) {
  // labels
  for (const r of $$('.row', root)) {
    const sp = r.querySelector(':scope > span'); if (!sp || sp.dataset.hint) continue;
    const ja = sp.textContent.trim(), en = tr(ja);
    sp.dataset.hint = ja; if (en) sp.textContent = en;
    const sel = r.querySelector(':scope > select');
    if (sel) { r.classList.add('ui-row-sel'); selToOpts(sel); }
  }
  for (const b of $$('.tabs__btn, .btn', root)) { const en = tr(b.textContent); if (en) { b.dataset.hint ||= b.textContent.trim(); b.textContent = en; } }
  for (const l of $$('label.loopbar__vol', root)) { const t = l.firstChild; if (t && t.nodeType === 3) { l.dataset.hint = t.textContent.trim(); t.textContent = 'Level '; } }
  for (const s of $$('details.more > summary', root)) s.textContent = 'More';
  for (const c of $$('.mini canvas, .mx__box canvas', root)) c.classList.add('ui-inv');
  // wrappers that only group rows: let the rows flow into the 2-column grid
  for (const d of $$('div', root)) {
    if (!d.closest('.ui-sec') || d.matches('.row, .tabs, .mini, .loopbar, .eq, .pcards, .loopnow, .bs__chars, .perm, .wander__grid') || d.closest('.row, .tabs, .mini')) continue;
    if (d.querySelector(':scope > .row, :scope > .tabs, :scope > .note, :scope > p, :scope > .mini, :scope > div')) d.classList.add('ui-flat');
  }
}

// a small <select> becomes a row of option buttons (the select stays, hidden, and is what the page reads)
function selToOpts(sel) {
  const n = sel.options.length; if (!n || n > 6) return;
  const box = document.createElement('div'); box.className = 'ui-opts';
  const draw = () => { box.innerHTML = [...sel.options].map((o) => `<button type="button" class="ui-opt${o.value === sel.value ? ' on' : ''}" data-val="${esc(o.value)}" data-hint="${esc(o.textContent)}">${esc(tr(o.textContent) || o.textContent)}</button>`).join(''); };
  draw();
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-val]'); if (!b) return; sel.value = b.dataset.val; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); draw(); });
  sel.addEventListener('change', draw);
  sel.classList.add('ui-hidesel'); sel.after(box);
  sel._uiDraw = draw;
}

/* ---------- behaviour ---------- */
function wire(ui) {
  const stage = $('.js-ui-stage', ui), hint = $('.js-ui-hint', ui);

  // hints: press a name
  const showHint = (el) => {
    const name = el.textContent.trim(), text = el.dataset.hint || '';
    hint.innerHTML = `<b>${esc(name)}</b>${esc(text)}`; hint.classList.add('is-on');
    const r = el.getBoundingClientRect(), hw = hint.offsetWidth, hh = hint.offsetHeight;
    hint.style.left = Math.min(innerWidth - hw - 8, Math.max(8, r.left)) + 'px';
    hint.style.top = (r.top - hh - 8 > 8 ? r.top - hh - 8 : r.bottom + 8) + 'px';
  };
  document.addEventListener('click', (e) => {
    const lbl = e.target.closest('.ui .row > span[data-hint], .ui [data-hint]:not(button):not(.ui-opt)');
    if (lbl && lbl.dataset.hint) { showHint(lbl); return; }
    hint.classList.remove('is-on');
    if (!e.target.closest('.js-ui-sname, .js-ui-sdrop')) $('.js-ui-sdrop', ui).classList.remove('is-open');
    if (!e.target.closest('.js-ui-menu, .js-ui-menubox')) $('.js-ui-menubox', ui).hidden = true;
    if (!e.target.closest('.js-ui-bpm')) $('.js-ui-bpmpop', ui).hidden = true;
  });

  // sections fold
  $('.js-ui-col', ui).addEventListener('click', (e) => { const h = e.target.closest('.ui-sec__h'); if (h) h.parentElement.classList.toggle('is-closed'); });
  $('.js-ui-full', ui).addEventListener('click', () => stage.classList.toggle('is-full'));

  // view toggle (Terrain = stage 2)
  $('.js-ui-viewtg', ui).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; $$('.ui-opt', b.parentElement).forEach((x) => x.classList.toggle('on', x === b)); stage.dataset.view = b.dataset.v; });

  // menu
  $('.js-ui-menu', ui).addEventListener('click', () => { const m = $('.js-ui-menubox', ui); m.hidden = !m.hidden; });
  projectButton($('.ui-project', ui)); // Save / Open Project (everything, one file)
  $('.js-ui-more', ui).addEventListener('click', () => document.body.classList.add('ui-show-old'));
  $('.js-ui-oldclose').addEventListener('click', () => document.body.classList.remove('ui-show-old'));
  $('.js-ui-notes', ui).addEventListener('click', (e) => { const on = document.body.classList.toggle('ui-show-notes'); e.target.textContent = on ? '説明の文章を隠す' : '説明の文章を表示する'; });
  $('.js-ui-panic', ui).addEventListener('click', () => $('.js-panic')?.click());
  { const ex = $('.js-export'), b = $('.js-ui-export', ui); if (ex) b.addEventListener('click', () => ex.click()); else b.remove(); }

  // MIDI
  const midiBtn = $('.js-midi'), midi = $('.js-ui-midi', ui);
  midi.addEventListener('click', () => midiBtn?.click());
  const showMidi = () => { const t = midiBtn?.textContent || ''; midi.classList.toggle('is-on', /MIDI: [1-9]/.test(t)); midi.title = /MIDI:/.test(t) ? t : 'MIDI: 押して接続'; };
  if (midiBtn) new MutationObserver(showMidi).observe(midiBtn, { childList: true, characterData: true, subtree: true });
  addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.target.closest?.('input[type=text]')) return; midi.classList.remove('is-note'); void midi.offsetWidth; midi.classList.add('is-note'); });

  // transport: the page's own play button (AIR: drone C4, Quake: hold C2, Bolt: start the sound)
  const play = $(CONF.play), tp = $('.js-ui-play', ui);
  const showPlay = () => tp.classList.toggle('is-on', !!play?.classList.contains('is-on'));
  tp.addEventListener('click', () => {
    if (MODE === 'Bolt' && play.classList.contains('is-on')) { $('.js-panic')?.click(); return; }
    if (CONF.start) $(CONF.start)?.click();
    play?.click();
  });
  if (play) new MutationObserver(showPlay).observe(play, { attributes: true, attributeFilter: ['class'] });
  showPlay();

  // BPM
  const bpmIn = $('.js-bpm'), bpmBox = $('.js-ui-bpm', ui), pop = $('.js-ui-bpmpop', ui);
  if (bpmIn) {
    const r = bpmIn.closest('.row') || bpmIn.closest('label') || bpmIn;
    pop.append(r);
    const show = () => ($('.js-ui-bpmv', ui).textContent = bpmIn.value);
    bpmIn.addEventListener('input', show); show();
    setInterval(show, 1000); // the shared tempo can change from another tab
    bpmBox.addEventListener('click', (e) => { if (e.target.closest('.js-ui-bpmpop')) return; if (dragged) { dragged = false; return; } pop.hidden = !pop.hidden; }); // a drag is not a click
    // drag up/down on the number
    let y0 = null, v0 = 0, dragged = false;
    bpmBox.addEventListener('pointerdown', (e) => { if (e.target.closest('.js-ui-bpmpop')) return; y0 = e.clientY; v0 = +bpmIn.value; dragged = false; });
    addEventListener('pointermove', (e) => { if (y0 == null) return; const v = Math.round(v0 + (y0 - e.clientY) / 3); if (v !== +bpmIn.value) { bpmIn.value = v; bpmIn.dispatchEvent(new Event('input', { bubbles: true })); pop.hidden = true; dragged = true; } });
    addEventListener('pointerup', () => { y0 = null; });
  } else bpmBox.classList.add('is-dis');

  // Color Map
  const cm = (k) => $(`.js-noteorder [data-p="${k}"]`);
  $('.js-ui-basic', ui).addEventListener('click', () => cm('reset')?.click());
  $('.js-ui-random', ui).addEventListener('click', () => cm('rand')?.click());
  const showCm = () => { const st = cm('state')?.textContent || ''; const basic = st.startsWith('基本'); $('.js-ui-basic', ui).classList.toggle('on', basic); $('.js-ui-random', ui).classList.toggle('on', !basic && !!st); };
  if (cm('state')) new MutationObserver(showCm).observe(cm('state'), { childList: true, characterData: true, subtree: true }); else $('.ui-cmap', ui).classList.add('is-dis');
  showCm();
  if (MODE === 'Quake') $('.ui-cmap', ui).classList.add('is-dis'); // Quake reads the photo without the color -> note map

  // Scene name = which photo; Scene + = add the range as a scene (AIR's loop scenes)
  const cards = $('.js-cards');
  // the title = the recalled scene's name (or the one the loop is on); a photo picked by hand = that photo's number
  // after a recall, touching the range on the photo (or Bolt's row / band) marks the name with *
  const scWrap = $('.js-scenes'); let curScene = -1, dirty = false;
  const scName = (k) => 'Scene-' + String(k + 1).padStart(2, '0');
  const showScene = () => {
    const sc = scWrap ? [...scWrap.querySelectorAll('.scard')] : [], now = sc.findIndex((c) => c.classList.contains('is-now'));
    if (curScene >= sc.length) curScene = -1;
    const i = [...cards.children].findIndex((c) => c.classList.contains('is-on'));
    $('.js-ui-scenename', ui).textContent = now >= 0 ? scName(now) : curScene >= 0 ? scName(curScene) + (dirty ? ' *' : '') : scName(Math.max(0, i));
  };
  const touch = (e) => { if (!e.isTrusted || curScene < 0 || dirty) return; dirty = true; showScene(); };
  $('.js-ov')?.addEventListener('pointerdown', touch);
  document.addEventListener('input', (e) => { if (e.target.closest?.('.js-rowbase, .js-band')) touch(e); }, true);
  new MutationObserver(showScene).observe(cards, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  cards.addEventListener('click', () => { curScene = -1; dirty = false; setTimeout(showScene); }, true);
  if (scWrap) {
    scWrap.addEventListener('click', (e) => { const c = e.target.closest('.scard'); if (!c || e.target.closest('.pcard__btn')) return; curScene = [...scWrap.querySelectorAll('.scard')].indexOf(c); dirty = false; setTimeout(showScene); }, true);
    new MutationObserver(showScene).observe(scWrap, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  }
  showScene();
  const add = $('.js-addscene'), addBtn = $('.js-ui-sceneadd', ui);
  if (add) addBtn.addEventListener('click', async () => {
    if (curScene >= 0 && dirty && window.__sceneOverwrite) {
      const c = await saveChoice('Scene', scName(curScene)); if (!c) return;
      if (c === true) { const i = curScene; await window.__sceneOverwrite(i); curScene = i; dirty = false; showScene(); return; }
    }
    add.click(); setTimeout(() => { const n = scWrap ? scWrap.querySelectorAll('.scard').length : 0; if (n) { curScene = n - 1; dirty = false; showScene(); } }, 150); }); else { addBtn.classList.add('is-dis'); addBtn.title = 'Scene の保存は2段目で作ります'; }
  // the ≡ next to the Scene name (or the name) opens the saved scenes as a list: thumbnail / name / date.
  // The list mirrors the page's own scene cards (.js-scenes); pressing a row presses that card (= recall).
  const scs = $('.js-scenes');
  if (scs) {
    const drop = document.createElement('div'); drop.className = 'ui-abs ui-scdrop js-ui-scdrop'; drop.hidden = true;
    drop.innerHTML = '<ul class="ui-sclist"></ul>';
    stage.append(drop);
    const list = drop.querySelector('.ui-sclist');
    const day = (t) => { if (!t) return '—'; const d = new Date(+t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
    const draw = () => {
      const cards = [...scs.querySelectorAll('.scard')];
      list.innerHTML = cards.length ? '' : '<li class="ui-empty">No scenes yet. Pick an area and press Scene +.</li>';
      cards.forEach((c, k) => {
        const li = document.createElement('li'); li.className = 'ui-sclist__item' + (c.classList.contains('is-now') ? ' on' : '');
        const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
        const src = c.querySelector('canvas');
        const paint = () => { if (!src) return; const g = cv.getContext('2d'), side = Math.min(src.width, src.height); g.clearRect(0, 0, 96, 96); g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 96, 96); };
        paint(); setTimeout(paint, 300); // Bolt / Quake draw their thumbnails a moment later
        const nm = `Scene ${String(k + 1).padStart(2, '0')}`;
        li.innerHTML = `<span class="ui-sclist__name">${nm}</span><span class="ui-sclist__date">${day(c.dataset.t)}</span><button type="button" class="ui-sclist__del" title="このシーンを消す">×</button>`;
        li.prepend(cv);
        li.addEventListener('click', (e) => {
          if (e.target.closest('.ui-sclist__del')) { const x = c.querySelector('.pcard__btn[title*="消"], .pcard__btn[title*="外す"]'); x?.click(); setTimeout(draw, 50); return; }
          c.click(); setOpen(false);
        });
        list.append(li);
      });
    };
    // the name = the scene in use; only the ≡ on the right opens the list
    const head = $('.ui-scene__head', ui), bar = $('.ui-scene__bar', ui); bar.title = '押すと保存したシーンの一覧';
    // the list takes the place of the photo and its thumbnails (press ≡ again to go back to the photo)
    const setOpen = (on) => { drop.hidden = !on; stage.classList.toggle('is-sclist', on); head.classList.toggle('on', on); if (on) draw(); };
    bar.addEventListener('click', () => setOpen(drop.hidden));
    new MutationObserver(() => { if (!drop.hidden) draw(); }).observe(scs, { childList: true });
    if (add) addBtn.addEventListener('click', () => setTimeout(() => setOpen(true), 100));
  }

  // AIR: loop icons in the panel head (Route = scenes in order, Flow = wander)
  const tools = $('.js-ui-ptools', ui);
  if (MODE === 'AIR') {
    tools.innerHTML = `<button class="ui-ptool" data-amode="play" type="button" title="演奏(鍵盤で鳴らす画面)">${ICON.route}</button><button class="ui-ptool" data-amode="loop" type="button" title="Loop(シーンをたどる / さまよう)">${ICON.flow}</button>`;
    const setA = (m) => { stage.dataset.amode = m; $$('[data-amode]', tools).forEach((x) => x.classList.toggle('is-sel', x.dataset.amode === m)); };
    tools.addEventListener('click', (e) => { const x = e.target.closest('[data-amode]'); if (x) setA(x.dataset.amode); });
    const loop = $('.js-loop');
    if (loop) new MutationObserver(() => $('[data-amode="loop"]', tools).classList.toggle('is-on', loop.classList.contains('is-on'))).observe(loop, { attributes: true, attributeFilter: ['class'] });
    setA(new URLSearchParams(location.search).get('amode') === 'loop' ? 'loop' : 'play');
  }
  // Quake: the engine switch in the panel head (Bass / Wobble)
  if (MODE === 'Quake') {
    tools.innerHTML = `<button class="ui-ptool" data-eng="0" type="button" title="Engine: Bass(芯+ひりつき+上の倍音の揺れ)">${ICON.bass}</button><button class="ui-ptool" data-eng="1" type="button" title="Engine: Wobble(サブ固定+1つのフィルターでうねる)">${ICON.wob}</button>`;
    const showEng = () => { const m = $('[data-mode].is-on')?.dataset.mode ?? '0'; $$('[data-eng]', tools).forEach((b) => b.classList.toggle('is-on', b.dataset.eng === m)); stage.dataset.engine = m === '1' ? 'wob' : 'bass'; };
    tools.addEventListener('click', (e) => { const b = e.target.closest('[data-eng]'); if (b) $(`[data-mode="${b.dataset.eng}"]`)?.click(); setTimeout(showEng, 30); });
    $$('[data-mode]').forEach((x) => new MutationObserver(showEng).observe(x, { attributes: true, attributeFilter: ['class'] }));
    showEng();
  }

  // left box tabs
  $('.js-ui-lbox', ui).addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (!t) return; $$('.ui-ltab', ui).forEach((x) => x.classList.toggle('on', x === t)); $('.js-ui-lbox', ui).dataset.tab = t.dataset.t; });
  buildMacro(ui); buildAdsr(ui);

  // Sound (= the page's presets) + list
  sounds(ui);

  // drop a photo anywhere
  const dropov = $('.js-ui-dropov', ui), dz = $('.js-drop'); let depth = 0;
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; dropov.classList.add('is-on'); } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dropov.classList.remove('is-on'); } });
  addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if (!isFiles(e)) return; depth = 0; dropov.classList.remove('is-on');
    if (e.target.closest?.('.js-drop, .js-cards')) return; // the page handles these itself
    e.preventDefault(); dz.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, bubbles: true, cancelable: true }));
  });

  // keep slider fills and option buttons in step with values the page sets by itself
  const fillAll = () => {
    for (const el of $$('.ui input[type=range]')) { const p = ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100; el.style.setProperty('--p', p + '%'); }
    for (const s of $$('.ui select.ui-hidesel')) { const on = s.nextElementSibling?.querySelector('.on'); if (!on || on.dataset.val !== s.value) s._uiDraw?.(); }
  };
  document.addEventListener('input', fillAll, true);
  setInterval(fillAll, 400); fillAll();

  // keep the name dark while a slider is being dragged, even when the pointer leaves the row
  document.addEventListener('pointerdown', (e) => { const r = e.target.closest?.('.ui .row'); if (!r || !e.target.matches('input[type=range]')) return; r.classList.add('is-drag'); addEventListener('pointerup', () => r.classList.remove('is-drag'), { once: true }); }, true);
  // scrolling areas fade out at the edge instead of cutting off (only on the side that has more to scroll)
  const fade = (el) => {
    // the mask is set only while the area really scrolls: a mask makes its own layer, and the dark pictures
    // drawn by the pages (flipped with mix-blend-mode) would then lose the green behind them
    const upd = () => { const top = el.scrollTop > 1, more = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      el.classList.toggle('ui-fade', top || more);
      el.style.setProperty('--ft', top ? (getComputedStyle(el).getPropertyValue('--fade-top').trim() || '32px') : '0px'); el.style.setProperty('--fb', more ? '32px' : '0px'); }; el.addEventListener('scroll', upd, { passive: true }); new ResizeObserver(upd).observe(el); setInterval(upd, 600); upd();
  };
  fade($('.js-ui-visual', ui)); fade($('.js-ui-col', ui));
  // the design's scroll bar: a thin line on the right edge of the green panel with a dark piece that moves
  // (the browser's own bar is hidden). Drag the piece to scroll too.
  const bar = (el, cls) => {
    const t = document.createElement('i'); t.className = 'ui-abs ui-sbar ' + cls; t.innerHTML = '<b></b>'; $('.js-ui-stage', ui).append(t);
    const thumb = t.firstChild;
    const upd = () => {
      const can = el.scrollHeight > el.clientHeight + 1; t.hidden = !can; if (!can) return;
      const h = t.clientHeight, th = Math.max(24, (h * el.clientHeight) / el.scrollHeight);
      thumb.style.height = th + 'px'; thumb.style.top = ((h - th) * el.scrollTop) / (el.scrollHeight - el.clientHeight) + 'px';
    };
    el.addEventListener('scroll', upd, { passive: true }); new ResizeObserver(upd).observe(el); setInterval(upd, 600); upd();
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const y0 = e.clientY, s0 = el.scrollTop, k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
      const mv = (ev) => { const h = t.clientHeight, th = thumb.clientHeight; el.scrollTop = s0 + ((ev.clientY - y0) / k) * (el.scrollHeight - el.clientHeight) / Math.max(1, h - th); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
  };
  bar($('.js-ui-col', ui), 'ui-sbar--col'); bar($('.js-ui-visual', ui), 'ui-sbar--vis');
  // after touching a slider or a list, give the keyboard back to the instrument
  // (the pages ignore note keys while an input / select has focus)
  // sliders: as soon as the pointer is up. Lists (<select>): only after a choice is made — blurring on pointer-up
  // would close the list the moment it opens.
  const release = (sel) => { const a = document.activeElement; if (a && a.matches?.(sel) && !a.closest('.ui-oldmain')) a.blur(); };
  document.addEventListener('pointerup', () => setTimeout(() => release('input[type=range]'), 0), true);
  document.addEventListener('change', (e) => { if (e.target.matches?.('select, input[type=range]')) setTimeout(() => release('select, input[type=range]'), 0); }, true);
  englishPass(ui);
  meters(ui);
  // zoom buttons on the main waveform (Now Playing on AIR / Bolt, the computed wave on Quake)
  if (MODE === 'Quake') { const sc = $('.ui-q-scope'); if (sc) zoomCtl(sc, { steps: [1, 2, 3, 6, 12, 24], def: 2, label: (n) => n + (n > 1 ? ' cycles' : ' cycle'), on: (n) => { window.__scopeCycles = n; window.__drawScope?.(); } }); }
  else { const nw = $('.ui-now', ui); if (nw) { zoomCtl(nw, { steps: [10, 20, 40, 85, 170, 340, 680, 1000, 1500], def: 3, label: (ms) => ms + ' ms', on: (ms) => { nowMs = ms; } }); nowTypeCtl(nw); } }
  fit(ui);
}

/* ---------- English on the screen (hints stay Japanese): values, list choices and messages the pages write ---------- */
const JA = /[぀-ヿ一-鿿]/;
const REPL = [
  [/^気に入った範囲を選んで.*$/, 'Pick an area and press Scene +. With 2 or more scenes the loop moves between them.'],
  [/^見本の色相環はシーンにできません.*$/, 'The sample color wheel cannot be a scene — add a photo first.'],
  [/^先にシーンを1つ以上追加してください$/, 'Add at least one scene first.'],
  [/^まだありません。写真と(範囲|行)を決めて.*$/, 'No scenes yet. Pick a photo and area, then Scene +.'],
  [/^ゆったり漂う\(パーリン\)$/, 'Drift'], [/^ときどき鋭く動く\(リッジ\)$/, 'Ridge'], [/^渦を巻く\(ワープ\)$/, 'Swirl'], [/^とどまって移る\(セル\)$/, 'Cell'],
  [/種 (\d+)/g, 'Seed $1'],
  [/^色→音階 (\d+) : 行の波形 (\d+)$/, 'Color $1 : Row $2'],
  [/さまよって (\d+)分(\d+)秒・/, (m, a, b) => `Flow ${a}:${String(b).padStart(2, '0')} · `],
  [/・シーン(\d+)に立ち寄り中/, ' · visiting Scene $1'], [/・シーンに近づいている/, ' · nearing a scene'], [/\(種 (\d+)\)/, ' (Seed $1)'],
  [/^(\d+)秒 \/ (\d+)秒・シーン(\d+)/, '$1s / $2s · Scene $3'],
  [/^なし$/, 'Off'], [/^歪み$/, 'Saturation'], [/^非対称$/, 'Asymmetry'], [/^形の崩れ$/, 'Shape'], [/^抵抗$/, 'Resistance'], [/^ジッター$/, 'Jitter'], [/^ドリフト$/, 'Drift'], [/^ノイズ$/, 'Noise'], [/^■ (止める|停止|フレーズを止める)$/, '■ Stop'], [/^▶ フレーズを鳴らす$/, '▶ Play Phrase'],
  [/^(\d+(?:\/\d+)?)小節(?:\(.*\))?$/, (m, a) => `${a} bar`],
  [/(\d+)本$/, '$1'], [/^±(\d+)行$/, '±$1'],
  [/回\/秒$/, '/s'], [/回\/分$/, '/min'], [/半音$/, ' st'], [/セント$/, 'ct'], [/秒$/, 's'],
];
function toEn(t) { if (!JA.test(t)) return t; let out = t; for (const [re, to] of REPL) out = out.replace(re, to); return out; }
function englishPass(ui) {
  const fix = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) {
      const el = n.parentElement; if (!el || el.closest('.note, .help, .ui-hint, .ui-menubox, .ui-oldmain')) continue;
      const t = n.textContent; if (!JA.test(t)) continue;
      const e = toEn(t.trim()); if (e !== t.trim()) n.textContent = e;
    }
  };
  let busy = false;
  const run = () => { if (busy) return; busy = true; fix(ui); busy = false; };
  new MutationObserver(() => { if (!busy) requestAnimationFrame(run); }).observe(ui, { subtree: true, childList: true, characterData: true });
  run();
}

/* ---------- Macro: 4 big knobs, each drives one setting (provisional assignment, see CONF) ---------- */
function knobSvg(p) { // Figma Left Box / Macro: 64 ring (gray track, dark value), 44 white knob, 2px pointer 14 long
  const r = 29, C = 2 * Math.PI * r, arc = C * 0.75, v = arc * p;
  const a = (-135 + 270 * p) * Math.PI / 180, px = 32 + Math.sin(a) * 14, py = 32 - Math.cos(a) * 14;
  return `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="#cccccc" stroke-width="6" stroke-dasharray="${arc} ${C}" transform="rotate(135 32 32)"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="#1b2a13" stroke-width="6" stroke-dasharray="${v} ${C}" transform="rotate(135 32 32)"/><circle cx="32" cy="32" r="21.5" fill="#fff" stroke="#1b2a13" stroke-width="1"/><line x1="32" y1="32" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#1b2a13" stroke-width="2"/></svg>`;
}
function buildMacro(ui) {
  const box = $('.js-ui-macro', ui);
  box.innerHTML = `<div class="ui-knobs">${CONF.macro.map(([n, , h], i) => `<div class="ui-knob" data-m="${i}"><div class="ui-knob__dial"></div><div class="ui-knob__foot"><span data-hint="${esc('仮の割り当て: ' + h)}">${n}</span><b class="ui-val"></b></div></div>`).join('')}</div>`;
  const els = CONF.macro.map(([, sel]) => $(sel));
  const pos = (el) => (el ? (+el.value - +el.min) / ((+el.max - +el.min) || 1) : 0);
  const draw = () => CONF.macro.forEach((_, i) => {
    const k = $(`[data-m="${i}"]`, box), el = els[i], p = pos(el);
    $('.ui-knob__dial', k).innerHTML = knobSvg(p); $('.ui-val', k).textContent = el ? p.toFixed(2) : '—';
    k.classList.toggle('is-dis', !el || el.disabled || !!el.closest('[hidden]'));
  });
  let drag = null;
  box.addEventListener('pointerdown', (e) => { const k = e.target.closest('.ui-knob__dial'); if (!k) return; const i = +k.parentElement.dataset.m; if (!els[i]) return; drag = { i, y: e.clientY, p: pos(els[i]) }; e.preventDefault(); });
  addEventListener('pointermove', (e) => {
    if (!drag) return; const el = els[drag.i];
    const p = Math.min(1, Math.max(0, drag.p + (drag.y - e.clientY) / 150));
    el.value = +el.min + p * (+el.max - +el.min); el.dispatchEvent(new Event('input', { bubbles: true })); draw();
  });
  addEventListener('pointerup', () => { if (drag) { els[drag.i]?.dispatchEvent(new Event('change', { bubbles: true })); drag = null; } });
  document.addEventListener('input', (e) => { if (els.includes(e.target)) draw(); });
  setInterval(draw, 400); draw();
}

/* ---------- ADSR in the left box: the same 4 settings as the page, with the note shape ---------- */
function buildAdsr(ui) {
  const box = $('.js-ui-adsr', ui), names = ['Attack', 'Decay', 'Sustain', 'Release'];
  const els = CONF.adsr.map((s) => $(s));
  box.innerHTML = `<div class="ui-ns"><span>Note Shape</span><svg class="js-ui-ns" viewBox="0 0 270 65" preserveAspectRatio="none"></svg></div>
    <div class="ui-adsr__rows">${names.map((n, i) => `<div class="row"><span data-hint="${esc(els[i]?.closest('.row')?.querySelector('span')?.dataset.hint || n)}">${n}</span><input type="range" data-adsr="${i}" data-nopreset><b data-adsrv="${i}"></b></div>`).join('')}</div>`;
  const mirrors = $$('[data-adsr]', box);
  const draw = () => {
    els.forEach((el, i) => { if (!el) return; const m = mirrors[i]; m.min = el.min; m.max = el.max; m.step = el.step; m.value = el.value; m.style.setProperty('--p', ((+el.value - +el.min) / ((+el.max - +el.min) || 1)) * 100 + '%'); $(`[data-adsrv="${i}"]`, box).textContent = (el.closest('.row')?.querySelector('b')?.textContent || el.value); });
    const [a, d, s, r] = els.map((el) => +(el?.value || 0));
    const hold = Math.max(0.3, (a + d + r) * 0.35), total = a + d + hold + r || 1, W = 270, H = 63;
    const x = (t) => (t / total) * W, y = (v) => 1 + H - v * H;
    const pts = [[0, y(0)], [x(a), y(1)], [x(a + d), y(s)], [x(a + d + hold), y(s)], [W, y(0)]];
    const dd = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    $('.js-ui-ns', box).innerHTML = `<path d="${dd} Z" fill="#a0b357" fill-opacity=".35"/><path d="${dd}" fill="none" stroke="#1b2a13" stroke-width="1.5"/><rect x="${x(a + d + hold).toFixed(1)}" y="0" width="1" height="65" fill="#a0b357"/>`;
  };
  mirrors.forEach((m, i) => m.addEventListener('input', () => { const el = els[i]; if (!el) return; el.value = m.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); draw(); }));
  // the page's own sliders: follow at once (the timer is only for values the page sets by itself)
  document.addEventListener('input', (e) => { if (els.includes(e.target)) draw(); });
  setInterval(draw, 500); draw();
}

/* ---------- Sound: save / list (the page's presets, same storage as before) ---------- */
function sounds(ui) {
  const KEY = 'photoSynth.presets.' + PAGE, D = DEFAULT_SOUNDS[PAGE], BASIC = MODE + '-Basic';
  const list = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const store = (a) => localStorage.setItem(KEY, JSON.stringify(a));
  const ul = $('.js-ui-slist', ui), drop = $('.js-ui-sdrop', ui), name = $('.js-ui-sname', ui), big = $('.js-ui-bigslul', ui), bigBox = $('.js-ui-bigsl', ui);
  const day = (t) => { const d = new Date(t || Date.now()); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  let cur = D ? BASIC : '', base = null; // the name shown (a saved Sound, or <mode>-Basic); base = that sound as the controls show it
  const now = () => JSON.stringify(snapshot());
  const isDirty = () => !!cur && base != null && now() !== base;
  const draw = () => {
    const a = list();
    name.textContent = cur ? cur + (isDirty() ? ' *' : '') : 'Sound-' + String(a.length + 1).padStart(2, '0') + '*'; name.title = cur ? '押すと Sound の一覧' : 'まだ保存していない音(Sound + で保存)';
    const li = a.map((p, i) => `<li class="${p.name === cur ? 'on' : ''}" data-i="${i}"><span>${esc(p.name)}</span><small>${day(p.t)}</small><button class="ui-sdel" data-del="${i}" type="button" title="消す">×</button></li>`).join('');
    ul.innerHTML = li || '<li class="ui-empty">No sounds yet. Sound + saves the current sound.</li>';
    drop.innerHTML = a.map((p, i) => `<li class="${p.name === cur ? 'on' : ''}" data-i="${i}">${esc(p.name)}</li>`).join('') || '<li class="ui-empty">No sounds yet</li>';
    big.innerHTML = a.map((p, i) => `<li class="${p.name === cur ? 'on' : ''}" data-i="${i}"><span class="ui-bigsl__name">${esc(p.name)}</span><small>${day(p.t)}</small><button class="ui-sdel" data-del="${i}" type="button" title="消す">×</button></li>`).join('') || '<li class="ui-empty">No sounds yet. Sound + saves the current sound.</li>';
    $('.js-ui-bigsln', ui).textContent = a.length ? a.length + ' sounds' : '';
  };
  const load = async (i) => { const p = list()[i]; if (!p) return; await restore(D ? { ...p, v: { ...D.v, ...p.v } } : p); cur = p.name; setTimeout(() => { base = now(); draw(); }, 50); }; // controls newer than the Sound get their Basic values
  // any change by hand: see whether the name needs its *
  let chk = 0; const recheck = () => { clearTimeout(chk); chk = setTimeout(() => { const t = name.textContent, want = cur ? cur + (isDirty() ? ' *' : '') : t; if (t !== want) name.textContent = want; }, 150); };
  for (const ev of ['input', 'change', 'click']) document.addEventListener(ev, (e) => { if (e.isTrusted) recheck(); }, true);
  // the page's start values = its default settings (js/default-sounds.js); they are not added to the Sound list
  // it is shown as "<mode>-Basic" (with * once changed); saving it makes a new Sound
  // the default sound right away; until it is in place the keys make no sound (they would play the page's own start values)
  window.__soundReady = !D;
  if (D) {
    const hold = (e) => { if (!window.__soundReady && !e.metaKey && !e.ctrlKey && !e.target.closest?.('input[type=text], textarea')) e.stopImmediatePropagation(); };
    addEventListener('keydown', hold, true); // before the page's own key handlers
    setTimeout(async () => { await restore(D); window.__soundReady = true; removeEventListener('keydown', hold, true); setTimeout(() => { base = now(); draw(); }, 50); }, 0);
  }
  $('.js-ui-soundadd', ui).addEventListener('click', async () => {
    if (isDirty() && list().some((p) => p.name === cur)) {
      const c = await saveChoice('Sound', cur); if (!c) return;
      if (c === true) { const a = list(), at = a.findIndex((p) => p.name === cur); a[at] = { name: cur, t: Date.now(), ...snapshot() }; store(a); base = now(); draw(); return; }
    }
    const a = list(); let n = a.length + 1; while (a.some((p) => p.name === 'Sound-' + String(n).padStart(2, '0'))) n++;
    const nm = await dlg({ title: 'Save Sound', name: 'Sound-' + String(n).padStart(2, '0'), names: a.map((p) => p.name), cur: a.some((p) => p.name === cur) ? cur : '', what: 'sound' }); if (!nm) return; // the Basic sound is not in the list: always a new name
    const snap = snapshot(), at = a.findIndex((p) => p.name === nm);
    if (at >= 0) a[at] = { name: nm, t: Date.now(), ...snap }; else a.push({ name: nm, t: Date.now(), ...snap });
    store(a); cur = nm; base = now(); draw();
  });
  // the big list takes the place of the effect settings (left of it); an effect box or × brings the effects back
  const setBig = (on) => { bigBox.hidden = !on; $('.js-ui-stage', ui).classList.toggle('is-bigsl', on); $('.js-ui-slbig', ui).classList.toggle('on', on); };
  $('.js-ui-slbig', ui).addEventListener('click', () => setBig(bigBox.hidden));
  $('.js-ui-bigslclose', ui).addEventListener('click', () => setBig(false));
  $('.js-ui-fxrow', ui).addEventListener('click', () => setBig(false), true);
  big.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { const a = list(), p = a[+d.dataset.del]; if (p && await dlg({ title: 'Delete Sound', msg: `Delete “${p.name}”? This can't be undone.`, ok: 'Delete' })) { a.splice(+d.dataset.del, 1); store(a); if (p.name === cur) cur = ''; draw(); } return; }
    const li = e.target.closest('[data-i]'); if (li) load(+li.dataset.i);
  });
  ul.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { const a = list(), p = a[+d.dataset.del]; if (p && await dlg({ title: 'Delete Sound', msg: `Delete “${p.name}”? This can't be undone.`, ok: 'Delete' })) { a.splice(+d.dataset.del, 1); store(a); if (p.name === cur) cur = ''; draw(); } return; }
    const li = e.target.closest('[data-i]'); if (li) load(+li.dataset.i);
  });
  name.addEventListener('click', () => drop.classList.toggle('is-open'));
  drop.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) load(+li.dataset.i); drop.classList.remove('is-open'); });
  addEventListener('storage', (e) => { if (e.key === KEY) draw(); });
  draw();
}

/* ---------- Zoom for the main waveform: − (see more time) / + (closer) ---------- */
// steps: the list of views; label(v) = what is shown between the buttons; on(v) = use it. Remembered per page.
function zoomCtl(box, { steps, def, label, on }) {
  const key = 'photoSynth.zoom.' + MODE;
  let i = Math.max(0, Math.min(steps.length - 1, +(localStorage.getItem(key) ?? def)));
  const el = document.createElement('div'); el.className = 'ui-zoom';
  el.innerHTML = '<button class="ui-zoom__b" type="button" data-hint="縮小:もっと長い時間(多くの周期)を見る">−</button><span class="ui-zoom__v"></span><button class="ui-zoom__b" type="button" data-hint="拡大:近くで見る(短い時間・少ない周期)">+</button>';
  const [minus, plus] = el.querySelectorAll('button'), v = el.querySelector('span');
  const show = () => { v.textContent = label(steps[i]); minus.disabled = i >= steps.length - 1; plus.disabled = i <= 0; on(steps[i]); };
  const go = (d) => { i = Math.max(0, Math.min(steps.length - 1, i + d)); localStorage.setItem(key, i); show(); };
  minus.addEventListener('click', () => go(1)); plus.addEventListener('click', () => go(-1));
  box.classList.add('has-zoom'); box.append(el); show();
}
var nowMs = 85; // Now Playing: how much time the bars show
var nowType = 'bars'; // Now Playing: bars | stereo
// Bars / Stereo tabs, to the left of the zoom buttons. Remembered per page.
function nowTypeCtl(box) {
  const key = 'photoSynth.nowType.' + MODE, T = [['bars', 'Bars', '各列の一番大きい値を縦棒で並べる'], ['stereo', 'Stereo', '左右の広がり:縦に細い=真ん中、横に広がる=左右に広い']];
  nowType = T.some((t) => t[0] === localStorage.getItem(key)) ? localStorage.getItem(key) : 'bars';
  const el = document.createElement('div'); el.className = 'ui-ntype';
  el.innerHTML = T.map(([k, n, h]) => `<button class="ui-ntype__b" type="button" data-ntype="${k}" data-nopreset data-hint="${h}">${n}</button>`).join('');
  const show = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ntype === nowType));
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-ntype]'); if (!b) return; nowType = b.dataset.ntype; localStorage.setItem(key, nowType); show(); window.__nowRedraw?.(); });
  box.querySelector('.ui-zoom')?.prepend(el); show();
}

/* ---------- Output meter + Now Playing (read from the speaker tap in out.js) ---------- */
function meters(ui) {
  const ml = $('.js-ui-ml', ui), mr = $('.js-ui-mr', ui), pk = $('.js-ui-peak', ui), lim = $('.js-ui-lim', ui);
  const cv = $('.js-ui-now', ui), g = cv.getContext('2d');
  let bl, br, bm, hold = -99, holdT = 0, limT = 0, drawn = false;
  let hist = null, histL = null, histR = null, hw = 0, lastT = -1; // Now Playing history (2 s ring): the tap only holds ~0.68 s, so each frame's new samples are kept here (mono + left / right for Stereo)
  let lastP = 0; window.__nowRedraw = () => { lastP = 1; };
  { const W = cv.width, H = cv.height; g.fillStyle = 'rgba(27,42,19,.25)'; for (let i = 0; i < 120; i++) g.fillRect(i * W / 120 + W / 120 * 0.3, H / 2 - 1, W / 120 * 0.4, 2); } // before the first sound: a flat line
  const lvl = (a, buf) => { a.getFloatTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v)); return p; };
  const toH = (p) => Math.max(0, Math.min(1, 1 + (p > 1e-5 ? 20 * Math.log10(p) : -99) / 48)) * 100 + '%';
  const tick = () => {
    const now = performance.now();
    if (outMeter.l) {
      bl ||= new Float32Array(outMeter.l.fftSize); br ||= new Float32Array(outMeter.r.fftSize); bm ||= new Float32Array(outMeter.mono.fftSize);
      const L = lvl(outMeter.l, bl), R = lvl(outMeter.r, br), P = Math.max(L, R), dB = P > 1e-5 ? 20 * Math.log10(P) : -99;
      ml.style.height = toH(L); mr.style.height = toH(R);
      if (dB > hold || now - holdT > 1500) { hold = dB; holdT = now; }
      pk.textContent = hold > -98 ? hold.toFixed(1) + ' dB' : '-∞ dB';
      if (dB > -1.2) limT = now; lim.classList.toggle('is-on', now - limT < 600);
      // now playing: bars like the design (peak per column)
      outMeter.mono.getFloatTimeDomainData(bm);
      const sr = outMeter.ctx.sampleRate, t = outMeter.ctx.currentTime;
      if (!hist) { const n = Math.ceil(sr * 2); hist = new Float32Array(n); histL = new Float32Array(n); histR = new Float32Array(n); }
      const fresh = lastT < 0 ? bm.length : Math.min(bm.length, Math.max(0, Math.round((t - lastT) * sr))); lastT = t;
      for (let j = bm.length - fresh, k = 0; j < bm.length; j++, k++) {
        const jl = bl.length - fresh + k; // left / right taps are shorter: their part of the fresh samples (older ones are 0)
        hist[hw] = bm[j]; histL[hw] = jl >= 0 ? bl[jl] : 0; histR[hw] = jl >= 0 ? br[jl] : 0; hw = (hw + 1) % hist.length;
      }
      const HL = hist.length, W = cv.width, H = cv.height, win = Math.min(HL, Math.round((nowMs / 1000) * sr));
      const idx = (back) => (hw - back + HL * 2) % HL; // back = how many samples before now
      const sounding = P > 1e-4 || lastP > 0.5; lastP = P;
      if (sounding) { // something is sounding: draw it (when silent, the last picture stays) — the newest "win" samples
        g.clearRect(0, 0, W, H);
        if (nowType === 'stereo') {
          // left / right as a trace turned 45°: up-down = the middle (L+R), sideways = the difference (L−R)
          const cx = W / 2, cy = H / 2, R = H * 0.46, n = Math.min(win, 6000), st = win / n;
          g.fillStyle = 'rgba(160,179,87,.5)'; g.fillRect(cx - 1, 0, 2, H); g.fillRect(0, cy - 1, W, 2);
          g.strokeStyle = 'rgba(27,42,19,.55)'; g.lineWidth = 1.5; g.beginPath();
          for (let i = 0; i < n; i++) { const j = idx(win - Math.floor(i * st)), l = histL[j], r = histR[j]; const x = cx + Math.max(-2, Math.min(2, (l - r) * 1.6)) * R, y = cy - Math.max(-1, Math.min(1, (l + r) * 0.8)) * R; i ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke();
        } else {
          const N = 120, step = Math.max(1, Math.floor(win / N)), bw = W / N; g.fillStyle = '#1b2a13';
          for (let i = 0; i < N; i++) { let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(hist[idx(win - i * step - j)])); const h = Math.max(2, Math.min(1, m * 1.6) * H * 0.92); g.fillRect(i * bw + bw * 0.3, (H - h) / 2, bw * 0.4, h); }
        }
        drawn = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- fit to the window (same rule as the look-only mock) ---------- */
function fit(ui) {
  const stage = $('.js-ui-stage', ui);
  const TOP_MAX = 579, TOP_MIN = 440, REST = 1024 - TOP_MAX, K_MIN = 0.6;
  const go = () => {
    const W = innerWidth, H = innerHeight;
    let k = Math.min(1, W / 1440);
    let top = Math.min(TOP_MAX, H / k - REST);
    if (top < TOP_MIN) { top = TOP_MIN; k = Math.max(K_MIN, Math.min(k, H / (REST + TOP_MIN))); }
    const d = TOP_MAX - top;
    stage.style.setProperty('--d', d + 'px'); stage.style.transform = `scale(${k})`;
    // the device sits in the middle of the window, both ways (the background fills the whole window)
    const sh = (1024 - d) * k;
    stage.style.marginLeft = Math.max(0, (W - 1440 * k) / 2) + 'px';
    stage.style.marginTop = Math.max(0, (H - sh) / 2) + 'px';
    ui.style.height = Math.max(H, sh) + 'px';
    document.documentElement.style.setProperty('--k', k);
  };
  addEventListener('resize', go); go();
}

/* ---------- start when the page has built its parts (the effect rack is made by the page script) ---------- */
function ready() { return $('.js-finish .fx-row') && $('.js-drop') && $('aside.panel'); }
function start() {
  if (document.body.dataset.uiDone) return; document.body.dataset.uiDone = '1';
  const ui = build(); move(); wire(ui);
  document.body.classList.add('ui-on');
}
if (ready()) start();
else { const mo = new MutationObserver(() => { if (ready()) { mo.disconnect(); start(); } }); mo.observe(document.body, { childList: true, subtree: true }); }
