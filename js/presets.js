// Presets: save / load the sound settings of a page under a name (kept in this browser, localStorage).
// It works on the page's own controls, so every page can use it without knowing its settings:
//   save = remember every slider, select and on/off tab as it is now
//   load = put them back by "operating" them (the same input / click the hand would make), so the sound, the
//          hidden/shown panels and the page's state all follow exactly as if done by hand.
// Not included: volume, the shared tempo, the photo and its area, note order (it has its own save), the XY pad.
const KEY = (page) => 'photoSynth.presets.' + page;
const SKIP = '.js-volume, .js-bpm, .js-presets *, .js-noteorder *, [data-nopreset], [data-nopreset] *';

const list = (page) => { try { return JSON.parse(localStorage.getItem(KEY(page))) || []; } catch { return []; } };
const store = (page, arr) => localStorage.setItem(KEY(page), JSON.stringify(arr));

// a stable name for a control: its js- class or its first data- attribute (+ which one, when several share it)
function idOf(el) {
  const js = [...el.classList].find((c) => c.startsWith('js-'));
  if (js) return '.' + js;
  const da = [...el.attributes].find((a) => a.name.startsWith('data-'));
  if (!da) return null;
  return da.value ? `[${da.name}="${da.value}"]` : `[${da.name}]`;
}
function controls(root) {
  const seen = new Map(), out = [];
  for (const el of root.querySelectorAll('input[type=range], select')) {
    if (el.matches(SKIP)) continue;
    const id = idOf(el); if (!id) continue;
    const n = seen.get(id) || 0; seen.set(id, n + 1);
    out.push({ el, key: id + '#' + n });
  }
  return out;
}
// on/off tabs: a .tabs__btn with one data- attribute; the lit one of each group
function tabs(root) {
  return [...root.querySelectorAll('.tabs__btn.is-on')].filter((b) => !b.matches(SKIP)).map((b) => {
    const da = [...b.attributes].find((a) => a.name.startsWith('data-'));
    return da ? `[${da.name}="${da.value}"]` : null;
  }).filter(Boolean);
}

export function snapshot(root = document) {
  const v = {};
  for (const { el, key } of controls(root)) v[key] = el.value;
  const extra = window.__presetExtra?.get(); // a page may add what its controls don't show (Quake: the other instrument's values)
  return extra ? { v, tabs: tabs(root), extra } : { v, tabs: tabs(root) };
}
export async function restore(snap, root = document) {
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  // 1. modes and switches first (they may reset or swap other values), 2. then every slider/select, twice so
  //    linked pairs (lowest/highest octave) settle
  for (const sel of snap.tabs) { const b = root.querySelector(sel); if (b && !b.classList.contains('is-on')) b.click(); }
  await new Promise((r) => setTimeout(r, 0));
  for (let pass = 0; pass < 2; pass++) {
    for (const { el, key } of controls(root)) {
      if (!(key in snap.v) || el.value === snap.v[key]) continue;
      el.value = snap.v[key];
      fire(el, el.tagName === 'SELECT' ? 'change' : 'input');
      if (el.tagName !== 'SELECT') fire(el, 'change');
    }
  }
  for (const sel of snap.tabs) { const b = root.querySelector(sel); if (b && !b.classList.contains('is-on')) b.click(); }
  window.__presetExtra?.set(snap.extra || null);
}

// the small bar: [preset list] [load] [delete]  [name] [save]
export function presetBar(box, { page }) {
  box.classList.add('pre', 'js-presets');
  box.innerHTML = `<span class="pre__ttl">プリセット</span><select class="pre__sel" data-psel></select>
    <button class="btn" data-pload type="button">読み込む</button><button class="btn" data-pdel type="button">消す</button>
    <input class="pre__name" data-pname type="text" placeholder="名前" maxlength="40"><button class="btn" data-psave type="button">今の音を保存</button>
    <span class="pre__msg" data-pmsg></span>`;
  const q = (s) => box.querySelector(s);
  const msg = (t) => { q('[data-pmsg]').textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => (q('[data-pmsg]').textContent = ''), 2500); };
  const fill = (pick) => {
    const arr = list(page);
    q('[data-psel]').innerHTML = arr.length ? arr.map((p, i) => `<option value="${i}">${p.name.replace(/[<&>"]/g, '')}</option>`).join('') : '<option value="">(まだありません)</option>';
    if (pick != null) q('[data-psel]').value = pick;
  };
  fill();
  q('[data-psave]').addEventListener('click', () => {
    const name = q('[data-pname]').value.trim() || new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const arr = list(page), snap = snapshot();
    const at = arr.findIndex((p) => p.name === name);
    if (at >= 0) { if (!confirm(`「${name}」を今の音で上書きしますか?`)) return; arr[at] = { name, t: Date.now(), ...snap }; }
    else arr.push({ name, t: Date.now(), ...snap });
    store(page, arr); fill(at >= 0 ? at : arr.length - 1); q('[data-pname]').value = ''; msg(`「${name}」を保存しました`);
  });
  q('[data-pload]').addEventListener('click', async () => {
    const p = list(page)[+q('[data-psel]').value]; if (!p) return;
    await restore(p); msg(`「${p.name}」を読み込みました`);
  });
  q('[data-pdel]').addEventListener('click', () => {
    const arr = list(page), i = +q('[data-psel]').value; if (!arr[i]) return;
    if (!confirm(`「${arr[i].name}」を消しますか?(元に戻せません)`)) return;
    const [d] = arr.splice(i, 1); store(page, arr); fill(); msg(`「${d.name}」を消しました`);
  });
}
