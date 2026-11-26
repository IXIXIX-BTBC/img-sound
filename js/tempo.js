// Shared tempo: one BPM for every page (bass phrases and wobble, lead LFO, tape-echo sync).
// Kept in localStorage, so it survives reloads and other open tabs follow along (the 'storage' event).
const KEY = 'photoSynth.bpm', MIN = 60, MAX = 200;
const subs = new Set();
const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(+v) || 120));
let bpm = clamp(localStorage.getItem(KEY) ?? 120);
export const getBpm = () => bpm;
export function setBpm(v) {
  const n = clamp(v); if (n === bpm) return;
  bpm = n; localStorage.setItem(KEY, String(n)); subs.forEach((f) => f(n));
}
export function onBpm(f) { subs.add(f); return () => subs.delete(f); }
addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { bpm = clamp(e.newValue); subs.forEach((f) => f(bpm)); } });
// a range input + its value label driven by the shared tempo
export function bindBpm(input, label) {
  input.min = MIN; input.max = MAX; input.step = 1;
  const show = (v) => { input.value = v; if (label) label.textContent = v; };
  show(bpm); onBpm(show);
  input.addEventListener('input', () => setBpm(input.value));
}
