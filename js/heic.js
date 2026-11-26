// HEIC / HEIF photos (iPhone): Chrome cannot show them, so they are turned into JPEG when they come in.
// The decoder (vendor/heic-to, libheif in WebAssembly, 3 MB) is loaded only when a HEIC photo arrives, and runs here in
// the browser; nothing is sent anywhere. Other images pass through as they are.
const HEIC_EXT = /\.(heic|heif)$/i;
let lib = null;
const load = () => (lib ||= import('../vendor/heic-to/heic-to.min.js').catch((e) => { lib = null; throw e; })); // a failed load is tried again next time

async function heicLike(f) {
  if (/image\/hei[cf]/i.test(f.type) || HEIC_EXT.test(f.name)) return true;
  if (f.type) return false; // some other known type
  try { const b = new Uint8Array(await f.slice(4, 12).arrayBuffer()), t = String.fromCharCode(...b); return t.startsWith('ftyp') && /^(hei[cxms]|hev[cxms])$/.test(t.slice(4)); } catch { return false; } // no type: its first bytes ("ftyp" + brand)
}
// files (from a file input or a drop) -> the same list, HEIC ones as JPEG files (same name, .jpg)
export async function readableImages(files) {
  const out = [];
  for (const f of files) {
    if (!f) continue;
    if (!(await heicLike(f))) { out.push(f); continue; }
    try {
      const jpg = await (await load()).heicTo({ blob: f, type: 'image/jpeg', quality: 0.92 });
      out.push(new File([jpg], f.name.replace(HEIC_EXT, '') + '.jpg', { type: 'image/jpeg', lastModified: f.lastModified }));
    } catch (e) { console.warn('HEIC could not be read:', f.name, e); alert(`「${f.name}」を読み込めませんでした(HEIC の変換に失敗)。`); }
  }
  return out;
}
