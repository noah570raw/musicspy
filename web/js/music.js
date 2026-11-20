'use strict';
// Menu music: noah570's tracks play on the home screen (on by default), keep playing 70% quieter in a room
// lobby, stop when a game starts and come back after it. They also dip while a track preview plays. Browsers block sound until the first click or key, so it starts on that.
(() => {
  const MS = window.MS;
  const { esc } = MS;
  const ON_KEY = 'ms_music_on';
  const VOL_KEY = 'ms_music_volume';
  const TRACKS = [
    { title: 'foreign', file: 'noah570 - foreign.mp3' },
    { title: 'glorious', file: 'noah570 - glorious.mp3' },
    { title: 'triumph', file: 'noah570 - triumph.mp3' },
  ].map((t) => ({ ...t, artist: 'noah570', src: `/audio/${encodeURIComponent(t.file)}` }));

  const audio = new Audio();
  audio.preload = 'none';
  const storedOn = MS.store.get(ON_KEY);
  let enabled = storedOn !== false;
  let volume = typeof MS.store.get(VOL_KEY) === 'number' ? MS.store.get(VOL_KEY) : 0.4;
  let context = 'menu'; // 'menu' | 'lobby' | 'game'
  const MENU_LEVEL = 0.7; // the menu music sits 30% under the volume slider
  const LOBBY_LEVEL = 0.3; // and 70% lower again in a room lobby
  const DUCK_LEVEL = 0.12;
  let ducked = false;
  let unlocked = false;
  let order = shuffle(TRACKS.map((_, i) => i));
  let pos = 0;
  let fadeTimer = null;
  const listeners = new Set();

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const track = () => TRACKS[order[pos % order.length]];
  const playing = () => !audio.paused && !audio.ended;
  const notify = () => {
    document.documentElement.classList.toggle('music-playing', playing());
    listeners.forEach((fn) => fn());
  };

  function fadeTo(target, ms, done) {
    clearInterval(fadeTimer);
    const start = audio.volume;
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    fadeTimer = setInterval(() => {
      i += 1;
      audio.volume = Math.max(0, Math.min(1, start + ((target - start) * i) / steps));
      if (i >= steps) {
        clearInterval(fadeTimer);
        if (done) done();
      }
    }, 40);
  }

  // volume for the current context
  function level() {
    if (context === 'game') return 0;
    return volume * MENU_LEVEL * (context === 'lobby' ? LOBBY_LEVEL : 1) * (ducked ? DUCK_LEVEL : 1);
  }

  function load() {
    const t = track();
    if (!audio.src.endsWith(t.src)) audio.src = t.src;
  }

  function play() {
    if (!enabled || context === 'game' || !unlocked) return;
    load();
    audio.volume = 0;
    audio.play().then(() => { fadeTo(level(), 1200); notify(); }).catch(() => notify());
  }

  function pause(ms = 600) {
    if (!playing()) return notify();
    fadeTo(0, ms, () => { audio.pause(); notify(); });
  }

  audio.addEventListener('ended', () => {
    pos += 1;
    if (pos >= order.length) { order = shuffle(order); pos = 0; }
    audio.src = track().src;
    play();
  });
  audio.addEventListener('play', notify);
  audio.addEventListener('pause', notify);

  // first gesture unlocks sound
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    play();
  };
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { once: true, capture: true }));

  MS.music = {
    get enabled() { return enabled; },
    get playing() { return playing(); },
    get track() { return track(); },
    get volume() { return volume; },
    get context() { return context; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setContext(next) {
      if (next === context) return;
      context = next;
      if (context === 'game') pause(900);
      else if (playing()) fadeTo(level(), 700);
      else play();
    },
    toggle() {
      enabled = !(enabled && playing());
      MS.store.set(ON_KEY, enabled);
      unlocked = true;
      if (enabled) play(); else pause(300);
      notify();
    },
    next(step = 1) {
      pos = (pos + step + order.length) % order.length;
      audio.src = track().src;
      unlocked = true;
      enabled = true;
      MS.store.set(ON_KEY, true);
      if (context !== 'game') play();
      notify();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v)));
      MS.store.set(VOL_KEY, volume);
      clearInterval(fadeTimer);
      if (playing()) audio.volume = level();
    },
    // a game preview is playing (track picker, results): dip the music under it
    duck(on) {
      if (ducked === Boolean(on)) return;
      ducked = Boolean(on);
      if (playing()) fadeTo(level(), 300);
    },
    // nav button: equaliser bars + the track name
    buttonHtml() {
      return `<button class="music-btn" data-act="music" aria-label="Menu music: ${esc(track().title)} by noah570"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="music-name">${esc(track().title)}</span></button>`;
    },
    openPanel() {
      const body = () => `
        <div class="sheet-body music-panel">
          <div class="now-playing">
            <span class="eq big" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <div><b>${esc(track().title)}</b><small>noah570 · menu music</small></div>
          </div>
          <div class="row-actions">
            <button class="btn" data-mus="prev" aria-label="Previous track">Previous</button>
            <button class="btn primary" data-mus="toggle">${playing() ? 'Pause' : 'Play'}</button>
            <button class="btn" data-mus="next" aria-label="Next track">Next</button>
          </div>
          <label class="field"><span>Music volume</span><input type="range" min="0" max="1" step="0.05" value="${volume}" data-mus="vol" aria-label="Music volume"></label>
          <label class="switch-row"><span>Interface sounds</span><input type="checkbox" data-mus="sfx" ${MS.sfx && MS.sfx.on ? 'checked' : ''}><i aria-hidden="true"></i></label>
          <p class="empty-note">Music plays in the menu, 70% quieter in a room lobby, and stops when a game starts.</p>
        </div>`;
      const el = MS.sheet.open('music', { title: 'Music', cls: 'narrow', body: body() });
      const rerender = () => { const c = el.querySelector('.sheet-content'); if (c && MS.sheet.isOpen('music')) c.innerHTML = body(); };
      const off = MS.music.onChange(rerender);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mus]');
        if (!b) return;
        if (b.dataset.mus === 'toggle') MS.music.toggle();
        if (b.dataset.mus === 'next') MS.music.next(1);
        if (b.dataset.mus === 'prev') MS.music.next(-1);
      });
      el.addEventListener('input', (e) => { if (e.target.dataset.mus === 'vol') MS.music.setVolume(e.target.value); });
      el.addEventListener('change', (e) => {
        if (e.target.dataset.mus !== 'sfx' || !MS.sfx) return;
        MS.sfx.set(e.target.checked);
        MS.sfx.play('tap');
      });
      const obs = new MutationObserver(() => { if (!document.body.contains(el)) { off(); obs.disconnect(); } });
      obs.observe(document.getElementById('sheets'), { childList: true });
    },
  };

  MS.music.onChange(() => {
    document.querySelectorAll('.music-name').forEach((n) => { n.textContent = track().title; });
  });
})();
