// Project: everything this app keeps in the browser, in one .zip file, and back.
//   - the settings (localStorage photoSynth.*): every mode's sound, saved Sounds, the tempo, the Dub session …
//   - the databases (IndexedDB): "photo-synth" (photos, scenes, saved slots) and "photoSynthDub" (the recorded takes)
// In the zip: project.json (the settings and every database entry) and bin/N (photos, recordings: the binary parts the
// entries point to as {"$bin": N}). Stored without compression; any zip tool can open it.
// Opening one replaces everything: the mode pages are closed first (so nothing saves over it), then the app reloads.
const DBS = ['photo-synth', 'photoSynthDub'];
const PREFIX = 'photoSynth.';
const FORMAT = 'img-sound-project';

/* ---------- the browser's storage ---------- */
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const openDb = (name, ver, up) => new Promise((res, rej) => { const r = ver ? indexedDB.open(name, ver) : indexedDB.open(name); if (up) r.onupgradeneeded = () => up(r.result); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

async function readDb(name) {
  if (indexedDB.databases && !(await indexedDB.databases()).some((x) => x.name === name)) return null; // not made yet (opening it would make an empty one)
  const d = await openDb(name);
  const out = { name, version: d.version, stores: [] };
  for (const sn of d.objectStoreNames) {
    const t = d.transaction(sn), s = t.objectStore(sn);
    const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    out.stores.push({ name: sn, keyPath: s.keyPath, autoIncrement: s.autoIncrement, entries: keys.map((k, n) => [k, vals[n]]) });
  }
  d.close();
  return out;
}
const dropDb = (name) => new Promise((res, rej) => { // the pages using it must be closed (the app closes them first)
  const r = indexedDB.deleteDatabase(name), t = setTimeout(() => rej(new Error(`"${name}" is still in use`)), 5000);
  r.onsuccess = () => { clearTimeout(t); res(); }; r.onerror = () => { clearTimeout(t); rej(r.error); };
});
async function writeDb(db) { // replaces it: same version and stores as in the file, then its entries
  await dropDb(db.name);
  const d = await openDb(db.name, db.version, (x) => { for (const s of db.stores) x.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement }); });
  const names = db.stores.map((s) => s.name); if (!names.length) { d.close(); return; }
  const t = d.transaction(names, 'readwrite');
  for (const s of db.stores) {
    const st = t.objectStore(s.name);
    for (const [k, v] of s.entries) st.keyPath != null ? st.put(v) : st.put(v, k);
  }
  await done(t); d.close();
}

/* ---------- binary parts (photos, recordings) ---------- */
const TYPED = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray };
function pack(v, bins) {
  if (v instanceof Blob) { bins.push(v); return { $bin: bins.length - 1, t: 'Blob', mime: v.type, ...(v instanceof File ? { file: v.name } : {}) }; }
  if (v instanceof ArrayBuffer) { bins.push(new Blob([v])); return { $bin: bins.length - 1, t: 'ArrayBuffer' }; }
  if (ArrayBuffer.isView(v)) { bins.push(new Blob([v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)])); return { $bin: bins.length - 1, t: v.constructor.name }; }
  if (v instanceof Date) return { $date: v.getTime() };
  if (Array.isArray(v)) return v.map((x) => pack(x, bins));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = pack(v[k], bins); return o; }
  return v;
}
async function unpack(v, part) {
  if (Array.isArray(v)) return Promise.all(v.map((x) => unpack(x, part)));
  if (v && typeof v === 'object') {
    if (v.$bin != null) {
      const b = part(v.$bin);
      if (v.t === 'Blob') return v.file != null ? new File([b], v.file, { type: v.mime }) : new Blob([b], { type: v.mime });
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      return v.t === 'ArrayBuffer' ? ab : new (TYPED[v.t] || Uint8Array)(ab);
    }
    if (v.$date != null) return new Date(v.$date);
    const o = {}; for (const k in v) o[k] = await unpack(v[k], part); return o;
  }
  return v;
}

/* ---------- zip (stored, no compression) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xffffffff; for (let k = 0; k < u.length; k++) c = CRC[(c ^ u[k]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export async function zip(files) { // files: [[name, Uint8Array]] (also used by Dub's pattern export)
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const dt = new Date(), time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), date = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const [name, data] of files) {
    const nm = enc.encode(name), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    parts.push(h, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cen.push(c, nm);
    off += 30 + nm.length + data.length;
  }
  const size = cen.reduce((a, x) => a + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, e], { type: 'application/zip' });
}
function unzip(buf) { // -> Map name -> Uint8Array (stored entries only, as written above)
  const v = new DataView(buf), u = new Uint8Array(buf), dec = new TextDecoder();
  let e = -1; for (let k = buf.byteLength - 22; k >= Math.max(0, buf.byteLength - 65557); k--) if (v.getUint32(k, true) === 0x06054b50) { e = k; break; }
  if (e < 0) throw new Error('not a zip');
  const n = v.getUint16(e + 10, true), out = new Map(); let p = v.getUint32(e + 16, true);
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('broken zip');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
    if (method !== 0) throw new Error('compressed zip');
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    out.set(name, u.subarray(start, start + size));
    p += 46 + nl + xl + cl;
  }
  return out;
}

/* ---------- save / open ---------- */
export async function saveProject() {
  await new Promise((r) => setTimeout(r, 600)); // the pages save their settings a moment after a change
  const bins = [], ls = {};
  for (let k = 0; k < localStorage.length; k++) { const key = localStorage.key(k); if (key.startsWith(PREFIX)) ls[key] = localStorage.getItem(key); }
  const dbs = [];
  for (const n of DBS) { const d = await readDb(n).catch(() => null); if (d && d.stores.length) dbs.push(pack(d, bins)); }
  const head = { format: FORMAT, v: 1, saved: new Date().toISOString(), localStorage: ls, dbs };
  const files = [['project.json', new TextEncoder().encode(JSON.stringify(head))]];
  for (let k = 0; k < bins.length; k++) files.push([`bin/${k}`, new Uint8Array(await bins[k].arrayBuffer())]);
  const blob = await zip(files);
  let name = 'Session'; try { name = JSON.parse(ls[PREFIX + 'dub.session'] || '{}').name || name; } catch {}
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const file = `IMG-SOUND_${name.replace(/[\\/:*?"<>|\s]+/g, '-')}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { file, size: blob.size };
}
// reads and checks a project file (nothing is changed yet). head only: just project.json (to check it before asking)
export async function readProject(file, headOnly = false) {
  const files = unzip(await file.arrayBuffer()), j = files.get('project.json');
  if (!j) throw new Error('project.json がありません');
  const head = JSON.parse(new TextDecoder().decode(j));
  if (head.format !== FORMAT) throw new Error('IMG SOUND の Project ではありません');
  if (headOnly) return head;
  const part = (n) => { const b = files.get(`bin/${n}`); if (!b) throw new Error(`bin/${n} がありません`); return b; };
  head.dbs = await Promise.all(head.dbs.map((d) => unpack(d, part)));
  return head;
}
// replaces everything in this browser with the project (call with the mode pages closed)
export async function applyProject(head) {
  for (const d of head.dbs) await writeDb(d); // the databases first: if one fails, the settings are still the old ones
  for (const n of DBS) if (!head.dbs.some((d) => d.name === n)) await dropDb(n);
  for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(head.localStorage)) localStorage.setItem(k, v);
}

/* ---------- the Project button (on every mode page) ---------- */
export function projectButton(btn) {
  if (!btn) return;
  btn.classList.remove('is-dis'); btn.title = 'Project: 全部(各モードの音色・保存した Sound・テンポ・Dub のパターンと録った音・写真)を1つのファイルに保存 / 開く';
  const box = document.createElement('div');
  box.className = 'ui-abs ui-menubox ui-projbox'; box.hidden = true;
  box.innerHTML = `<button type="button" data-p="save">Save Project (.zip)</button><button type="button" data-p="open">Open Project…</button><div class="ui-menubox__st" data-p="msg"></div><input type="file" accept=".zip,application/zip" hidden>`;
  btn.after(box);
  const msg = box.querySelector('[data-p="msg"]'), input = box.querySelector('input');
  btn.addEventListener('click', () => { box.hidden = !box.hidden; msg.textContent = ''; });
  document.addEventListener('pointerdown', (e) => { if (!box.hidden && !e.target.closest('.ui-projbox') && !btn.contains(e.target)) box.hidden = true; });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p === 'save') {
      msg.textContent = '保存中…';
      try { const r = await saveProject(); msg.textContent = `保存しました: ${r.file}(${(r.size / 1048576).toFixed(1)} MB)`; } catch (err) { msg.textContent = '保存できませんでした: ' + err.message; }
    } else input.click();
  });
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.value = ''; if (!f) return;
    msg.textContent = '読み込み中…';
    const app = window.top !== window && window.top.__app;
    let head; try { head = await readProject(f, !!app?.replace); } catch (err) { msg.textContent = '開けませんでした: ' + err.message; return; } // in the app: only checked here (the app reads it in full)
    if (!confirm(`「${f.name}」を開きます。今の内容(各モードの音色・Dub のパターンと録った音・写真)は全部置き換わります。再生中の音は止まります。`)) { msg.textContent = ''; return; }
    if (app?.replace) { app.replace(f); return; } // the app reads it again on its side, closes every mode page, writes, and reloads
    try { await applyProject(head); location.reload(); } catch (err) { msg.textContent = '書き込めませんでした: ' + err.message; }
  });
}
