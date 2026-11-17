'use strict';
// MusicSpy client core: helpers, socket with acks, synced audio, sheets, avatars, icons.
// Everything hangs off window.MS so the mode files (k5.js, spy.js) share one toolkit.
(() => {
  const MS = (window.MS = window.MS || {});

  // ---------- helpers ----------
  MS.$ = (s, el = document) => el.querySelector(s);
  MS.$$ = (s, el = document) => [...el.querySelectorAll(s)];
  MS.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MS.store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  MS.count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  MS.normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

  // ---------- toast ----------
  let toastTimer = null;
  MS.toast = (text, action) => {
    const el = MS.$('#toast');
    if (!text) return;
    el.classList.toggle('action', Boolean(action));
    el.innerHTML = `<span>${MS.esc(text)}</span>${action ? `<button type="button">${MS.esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 2800);
  };

  MS.copyText = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    if (okMessage) MS.toast(okMessage);
  };

  // ---------- icons (line, 20px, currentColor) ----------
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  MS.icon = {
    volume: svg('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none"/><path d="M16 8.5a5 5 0 0 1 0 7"/>'),
    chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    friends: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14c1.6.7 2.6 2.4 3 5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.8 3.8-6 7-6s6 2.2 7 6"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    swap: svg('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
    search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
    pause: svg('<path d="M9 6v12M15 6v12"/>'),
    play: svg('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'),
    google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" opacity=".9"/><path fill="#fff" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" opacity=".7"/><path fill="#fff" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" opacity=".5"/><path fill="#fff" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" opacity=".8"/></svg>',
    discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.3 15.3 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.8a16.7 16.7 0 0 0 5.1 2.6l1.1-1.8c-.6-.2-1.2-.5-1.7-.9l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.8a16.6 16.6 0 0 0 5.1-2.6c.4-4.4-.7-8.2-3-11.5zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>',
  };
  MS.playThumbSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5v14l11-7z"/><path class="i-pause" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  // ---------- avatars ----------
  const PLAYER_COLORS = ['#e9a98f', '#8fcfbf', '#f0c674', '#9dbfe6', '#e69aa8', '#b5d68f', '#d8b48a', '#8cc4d6'];
  MS.colorFor = (key) => {
    let h = 0;
    for (const ch of String(key || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PLAYER_COLORS[h % PLAYER_COLORS.length];
  };
  MS.avatar = (p = {}, size = '') => {
    const name = p.name || p.displayName || p.username || '?';
    const color = p.color || MS.colorFor(p.accountId || p.id || name);
    const inner = p.avatar
      ? `<img src="${MS.esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : MS.esc(name.trim().charAt(0).toUpperCase() || '?');
    return `<span class="avatar ${size}" style="--c:${MS.esc(color)}">${inner}</span>`;
  };

  // ---------- socket ----------
  const socket = (MS.socket = window.io({ reconnectionDelayMax: 4000 }));
  MS.emit = (event, payload = {}, timeoutMs = 12000) => new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: 'The server is not answering', ok: false, network: true });
    }, timeoutMs);
    socket.emit(event, payload, (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res || {});
    });
  });
  // Normalises the two ack styles: Spy handlers answer { success | error }, K5D5 answers { ok | error }.
  MS.okOf = (res) => Boolean(res && (res.ok || res.success) && !res.error);

  let offlineTimer = null;
  socket.on('connect', () => {
    clearTimeout(offlineTimer);
    document.body.classList.remove('offline');
  });
  socket.on('disconnect', () => {
    clearTimeout(offlineTimer);
    offlineTimer = setTimeout(() => document.body.classList.add('offline'), 1500);
  });

  // ---------- server clock ----------
  MS.clock = { offset: 0 };
  MS.setServerNow = (serverNow) => {
    if (Number.isFinite(serverNow)) MS.clock.offset = serverNow - Date.now();
  };
  MS.now = () => Date.now() + MS.clock.offset;

  // ---------- audio ----------
  const VOL_KEY = 'ms_volume';
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const audio = new Audio();
  audio.preload = 'auto';
  const savedVol = MS.store.get(VOL_KEY);
  audio.volume = typeof savedVol === 'number' ? savedVol : 0.8;
  let syncKey = '';
  let previewKey = '';
  let playTimer = null;

  function soundButton(show) {
    let btn = MS.$('#soundBtn');
    if (!btn && show) {
      btn = document.createElement('button');
      btn.id = 'soundBtn';
      btn.className = 'sound-btn';
      btn.type = 'button';
      btn.textContent = 'Your browser blocked the sound. Tap to turn it on';
      btn.onclick = () => {
        const k = syncKey;
        syncKey = '';
        btn.remove();
        if (lastSync) MS.audio.sync(lastSync);
        else if (k) audio.play().catch(() => {});
      };
      document.body.appendChild(btn);
    }
    if (btn && !show) btn.remove();
  }

  let lastSync = null;
  MS.audio = {
    el: audio,
    unlock() {
      if (syncKey || previewKey) return;
      try {
        audio.src = SILENT;
        const p = audio.play();
        if (p) p.catch(() => {});
      } catch { /* ignore */ }
    },
    stop() {
      clearTimeout(playTimer);
      syncKey = '';
      previewKey = '';
      lastSync = null;
      audio.pause();
      MS.$$('.listen.on').forEach((b) => b.classList.remove('on'));
      soundButton(false);
    },
    // Shared playback: everyone hears the same preview from the same moment (startsAt, server time).
    sync(opts) {
      if (!opts || !opts.src) {
        if (syncKey) MS.audio.stop();
        return;
      }
      const k = `${opts.key}|${opts.startsAt}|${opts.paused ? 'p' : ''}`;
      if (k === syncKey) return;
      if (previewKey) {
        previewKey = '';
        MS.$$('.listen.on').forEach((b) => b.classList.remove('on'));
      }
      syncKey = k;
      lastSync = opts;
      clearTimeout(playTimer);
      const abs = new URL(opts.src, location.href).href;
      if (audio.src !== abs) audio.src = opts.src;
      audio.loop = Boolean(opts.loop);
      if (opts.paused) {
        audio.pause();
        return;
      }
      const go = () => {
        if (syncKey !== k) return;
        const offset = (MS.now() - (opts.startsAt || MS.now())) / 1000;
        const seek = () => {
          if (offset > 0.4 && Number.isFinite(audio.duration) && audio.duration > 0) {
            const pos = audio.loop ? offset % audio.duration : Math.min(offset, audio.duration - 0.3);
            audio.currentTime = Math.max(0, pos);
          }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
        audio.play().then(() => soundButton(false)).catch(() => soundButton(true));
      };
      const delay = (opts.startsAt || 0) - MS.now();
      if (delay > 0) playTimer = setTimeout(go, delay);
      else go();
    },
    // Results screens: tap a cover to hear its preview; tap again to stop.
    preview(src, key, btn) {
      if (!src) return;
      if (previewKey === key && !audio.paused) {
        MS.audio.stop();
        return;
      }
      MS.audio.stop();
      previewKey = key;
      audio.loop = false;
      audio.src = src;
      if (btn) btn.classList.add('on');
      audio.play().catch(() => MS.toast('Could not play the preview'));
    },
    get previewKey() { return previewKey; },
    setVolume(v) {
      audio.volume = Math.max(0, Math.min(1, Number(v)));
      MS.store.set(VOL_KEY, audio.volume);
    },
  };
  // the menu music dips while game audio (a preview or a shared track) plays
  const duckMusic = () => { if (MS.music) MS.music.duck(!audio.paused && !audio.ended && audio.src !== SILENT); };
  ['play', 'pause', 'ended', 'emptied'].forEach((ev) => audio.addEventListener(ev, duckMusic));
  audio.addEventListener('ended', () => {
    if (previewKey) {
      previewKey = '';
      MS.$$('.listen.on').forEach((b) => b.classList.remove('on'));
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'vol') MS.audio.setVolume(e.target.value);
  });
  MS.volumeControl = () => `<label class="vol" title="Volume">${MS.icon.volume}<input id="vol" type="range" min="0" max="1" step="0.05" value="${audio.volume}" aria-label="Volume"></label>`;

  // ---------- sheets (dialogs) ----------
  const sheets = new Map();
  MS.sheet = {
    open(id, { title = '', body = '', cls = '', label = '', onClose = null } = {}) {
      MS.sheet.close(id, true);
      const wrap = document.createElement('div');
      wrap.className = 'sheet';
      wrap.dataset.sheet = id;
      wrap.innerHTML = `
        <div class="sheet-scrim" data-close></div>
        <section class="sheet-panel ${cls}" role="dialog" aria-modal="true" aria-label="${MS.esc(label || title)}">
          <div class="sheet-head"><h2>${MS.esc(title)}</h2><button class="icon-btn plain" data-close aria-label="Close">${MS.icon.close}</button></div>
          <div class="sheet-content">${body}</div>
        </section>`;
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) MS.sheet.close(id);
      });
      MS.$('#sheets').appendChild(wrap);
      sheets.set(id, { el: wrap, onClose });
      requestAnimationFrame(() => wrap.classList.add('open'));
      return wrap;
    },
    close(id, instant = false) {
      const s = sheets.get(id);
      if (!s) return;
      sheets.delete(id);
      s.el.classList.remove('open');
      if (instant) s.el.remove();
      else setTimeout(() => s.el.remove(), 180);
      if (s.onClose) s.onClose();
    },
    get(id) { return sheets.has(id) ? sheets.get(id).el : null; },
    isOpen(id) { return sheets.has(id); },
    closeTop() {
      const ids = [...sheets.keys()];
      if (!ids.length) return false;
      MS.sheet.close(ids[ids.length - 1]);
      return true;
    },
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') MS.sheet.closeTop();
  });

  // ---------- backdrop ----------
  MS.setBackdrop = (url) => {
    if (window.MSFX) window.MSFX.setCover(url || '');
  };
})();
