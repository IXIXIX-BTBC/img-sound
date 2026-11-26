// Used by every mode page (shell.js, dub.js).
// Inside the one-window app (index.html): the mode icons, the logo and "Open in …" switch modes there instead of
// leaving this page (leaving would stop it). Opened on its own without settings (no ?…): go to the app instead.
const MODE_LINKS = 'a[href="../pixel/"], a[href="../lead/"], a[href="../bass/"], a[href="../dub/"], a.ui-logo';
export function appLinks(page) {
  const app = window.parent !== window && window.parent.__app;
  if (app) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest(MODE_LINKS); if (!a) return;
      e.preventDefault(); app.go(a.getAttribute('href'));
    }, true);
  } else if (window.top === window && !location.search) location.replace('../#' + page);
}
