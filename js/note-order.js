// Photo reading, shared by every mode that turns colors into notes (AIR, Bolt):
//   "red =" (which note the red hue plays) and the color -> note order.
// Default order: the color wheel in order (12 hue sectors from red = C, C#, D ... above the red note).
// "Random" shuffles which note each sector plays (brightness -> octave stays). Orders can be saved and recalled.
// Storage:
//   the current reading (red + order) = localStorage 'photoSynth.read', the same for every page; another open tab
//     follows along (the 'storage' event). So the same photo reads as the same notes in every mode.
//   the saved orders = IndexedDB meta 'notePerms' (shared, as before).
// Not here (each mode keeps its own, they are part of the instrument): note fineness and the octave range.
import * as DB from './store.js?v=6';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY = 'photoSynth.read';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const chips = (perm, red, cls = 'perm__chip') =>
  NAMES.map((_, i) => `<span class="${cls}" style="background:hsl(${i * 30},80%,45%)">${NAMES[(red + (perm ? perm[i] : i)) % 12]}</span>`).join('');
const same = (a, b) => !!a && !!b && a.every((v, i) => v === b[i]);
const okPerm = (p) => Array.isArray(p) && p.length === 12;

function readShared() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && Number.isInteger(v.red)) return { red: v.red, perm: okPerm(v.perm) ? v.perm : null };
  } catch {}
  return null;
}

// box: an empty element. onChange(red, perm): perm = array of 12 (or null = default).
// oldKey: this page's old per-page order (IndexedDB meta), used once if nothing is shared yet.
export function noteOrderUI(box, { oldKey, onChange }) {
  let red = 0, perm = null, saved = [];
  box.innerHTML = `
    <div class="row"><span>赤 =</span><select data-p="red">${NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select><b></b></div>
    <div class="row"><span>色と音の対応</span><span class="perm">
      <button class="btn btn--s" data-p="rand" type="button">ランダムに入れ替える</button>
      <button class="btn btn--s" data-p="reset" type="button">基本に戻す</button>
      <button class="btn btn--s" data-p="save" type="button">保存</button></span><b data-p="state"></b></div>
    <div class="perm__list" data-p="now"></div>
    <div class="perm__saved" data-p="saved"></div>
    <p class="note">基本=色相環の順に半音ずつ(赤→橙→黄…がC→C#→D…)。ランダム=12色それぞれが鳴らす音名を入れ替えます(明るさ→オクターブはそのまま)。ここは全モード共通です(同じ写真は AIR でも Bolt でも同じ音名で読みます)。名前をクリックで呼び出し、×で消す。</p>`;
  const q = (k) => box.querySelector(`[data-p="${k}"]`);
  const draw = () => {
    q('red').value = red;
    q('now').innerHTML = chips(perm, red);
    const hit = saved.find((s) => same(s.perm, perm));
    q('state').textContent = !perm ? '基本(色相環の順)' : hit ? hit.name : 'ランダム(未保存)';
    q('saved').innerHTML = saved.map((s, i) => `<div class="perm__item${same(s.perm, perm) ? ' is-on' : ''}">
      <button class="perm__name" data-use="${i}" type="button">${esc(s.name)}</button>
      <span class="perm__mini">${chips(s.perm, red, 'perm__chip perm__chip--s')}</span>
      <button class="perm__del" data-del="${i}" type="button" title="この並びを消す">×</button></div>`).join('');
  };
  // apply a reading; keep = also store it (so the other pages and later visits read the same)
  const apply = (r, p, keep = true) => {
    red = r; perm = p ? [...p] : null;
    if (keep) localStorage.setItem(KEY, JSON.stringify({ red, perm }));
    draw(); onChange(red, perm);
  };
  const storeSaved = () => DB.setMeta('notePerms', saved).catch(() => {});
  q('red').addEventListener('change', (e) => apply(+e.target.value, perm));
  q('rand').addEventListener('click', () => { const p = [...Array(12).keys()]; for (let i = 11; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } apply(red, p); });
  q('reset').addEventListener('click', () => apply(red, null));
  // re-read the shared list first, so another page's changes are not overwritten
  const fresh = async () => { const l = await DB.getMeta('notePerms').catch(() => null); if (Array.isArray(l)) saved = l.filter((s) => s && okPerm(s.perm)); };
  q('save').addEventListener('click', async () => {
    await fresh();
    if (!perm || saved.some((s) => same(s.perm, perm))) return; // the default and already-saved orders need no entry
    let n = saved.length + 1; while (saved.some((s) => s.name === '並び' + n)) n++;
    saved.push({ name: '並び' + n, perm: [...perm] }); storeSaved(); draw();
  });
  q('saved').addEventListener('click', async (e) => {
    const u = e.target.closest('[data-use]'), d = e.target.closest('[data-del]');
    if (u) apply(red, saved[+u.dataset.use].perm);
    else if (d) { const gone = saved[+d.dataset.del]; await fresh(); saved = saved.filter((s) => !(s.name === gone.name && same(s.perm, gone.perm))); storeSaved(); draw(); }
  });
  // another tab changed the reading: follow it (without storing it again)
  addEventListener('storage', (e) => { if (e.key !== KEY) return; const v = readShared(); if (v) apply(v.red, v.perm, false); });
  // start: the shared reading now (so the first sound is already right), then the saved list
  const now = readShared();
  if (now) apply(now.red, now.perm, false); else draw();
  Promise.all([DB.getMeta('notePerms').catch(() => null), now || !oldKey ? null : DB.getMeta(oldKey).catch(() => null)]).then(([list, old]) => {
    saved = Array.isArray(list) ? list.filter((s) => s && okPerm(s.perm)) : [];
    if (!now && okPerm(old)) apply(0, old); else draw(); // first visit after the change: carry this page's old order over
  });
  return { get red() { return red; }, get perm() { return perm; }, redraw: draw };
}
