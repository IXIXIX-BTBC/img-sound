// One window for every mode (index.html). Each mode page runs in its own frame, made the first time it is opened and
// then kept, so switching modes stops nothing: Dub keeps playing (and recording) while you use AIR / Bolt / Quake.
// The pages switch with parent.__app.go(href) (js/app-link.js); the mode on screen is in the address (#AIR …).
// phones get their own screen (m/): a touch screen narrower than a tablet. ?pc in the address keeps this one
if (!new URLSearchParams(location.search).has('pc') && matchMedia('(pointer: coarse) and (max-width: 820px)').matches) location.replace('m/' + location.search);
const PAGES = { AIR: 'pixel/', Bolt: 'lead/', Quake: 'bass/', Dub: 'dub/' };
const KEY = 'photoSynth.app.mode';
const frames = {};

function show(mode) {
  if (!PAGES[mode]) mode = 'AIR';
  let f = frames[mode];
  if (!f) {
    f = frames[mode] = document.createElement('iframe');
    f.src = PAGES[mode] + location.search; // ?mute=1 (tests) is passed on
    f.allow = 'autoplay; midi'; f.title = mode;
    f.addEventListener('load', () => { if (f.classList.contains('on')) f.contentWindow.focus(); });
    document.body.append(f);
  }
  for (const [m, el] of Object.entries(frames)) el.classList.toggle('on', m === mode);
  waitReady(f);
  f.contentWindow?.focus(); // the keyboard plays the mode on screen
  document.title = 'IMG SOUND · ' + mode;
  if (location.hash.slice(1) !== mode) history.replaceState(null, '', '#' + mode);
  localStorage.setItem(KEY, mode);
}

// the loading cover stays until the mode on screen has built its screen (its body gets .ui-on), at most 15 s
const cover = document.querySelector('.js-loading');
function waitReady(f) {
  const ready = () => f.contentDocument?.body?.classList.contains('ui-on');
  if (ready()) { cover.classList.add('off'); return; }
  cover.classList.remove('off');
  const t0 = Date.now(), iv = setInterval(() => { if (!f.classList.contains('on')) return clearInterval(iv); if (ready() || Date.now() - t0 > 15000) { clearInterval(iv); cover.classList.add('off'); } }, 100);
}
window.__app = {
  // href as written in the pages ("../lead/"): the mode it points to; anything else is ignored
  go(href) { const m = Object.keys(PAGES).find((k) => href.replace(/^\.\.\//, '') === PAGES[k]); if (m) show(m); },
  get frames() { return frames; },
  // Open Project (js/project.js): close every mode page first (their pending saves would write over it), then write the
  // project into this browser and start again
  async replace(file) {
    const p = await import('./project.js?v=5');
    let head; try { head = await p.readProject(file); } catch (e) { alert('開けませんでした: ' + e.message); return; }
    for (const m of Object.keys(frames)) { frames[m].remove(); delete frames[m]; }
    document.body.insertAdjacentHTML('beforeend', '<p style="font:14px sans-serif;padding:24px">Opening project…</p>');
    try { await p.applyProject(head); } catch (e) { alert('書き込めませんでした: ' + e.message + '(今の内容のまま開き直します)'); }
    location.reload();
  },
};
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || localStorage.getItem(KEY) || 'AIR');
