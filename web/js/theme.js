'use strict';
// Themes: the whole site re-skins itself for the chosen game.
//   <html data-theme="spy" | "k5" | "koth" | "home">  drives the CSS tokens (tokens.css) and the backdrop palette (fx.js).
// MS.theme.go(name, update) swaps the theme in place, without a page-refresh effect: the parts of the
// current screen take themselves apart (.leaving, CSS), then the theme changes and update() renders the
// new screen, whose [data-build] parts assemble one by one (.building, CSS). With reduced motion the swap is instant.
(() => {
  const MS = window.MS;
  const root = document.documentElement;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEAVE_MS = 420; // longest exit: 7 parts x 30ms stagger + 200ms (theme.css, .leaving)
  let pending = null;

  function apply(name) {
    root.dataset.theme = name;
    if (window.MSFX) window.MSFX.setTheme(name);
  }

  MS.theme = {
    get current() { return root.dataset.theme || 'home'; },
    apply,
    go(name, update = () => {}) {
      const screen = document.querySelector('#app > .screen');
      clearTimeout(pending);
      if (reduced() || !screen) {
        apply(name);
        update();
        return Promise.resolve();
      }
      screen.classList.remove('building');
      screen.classList.add('leaving');
      return new Promise((resolve) => {
        pending = setTimeout(() => {
          pending = null;
          apply(name);
          update();
          resolve();
        }, LEAVE_MS);
      });
    },
  };

  const saved = MS.store.get('ms_mode');
  apply(['spy', 'k5', 'koth'].includes(saved) ? saved : 'spy');
})();
