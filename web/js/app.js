'use strict';
// App shell: home screen, joining by code, restoring the room after a reload or a reconnect,
// "Switch game" between the two modes, and the click handling shared by every screen.
(() => {
  const MS = window.MS;
  const { $, esc } = MS;
  const ROOM_KEY = 'ms_room';
  const MODE_KEY = 'ms_mode';

  let current = null; // active mode controller (MS.modes.k5 | MS.modes.spy)
  let booted = false;
  let homeMessage = '';
  let busy = false;

  const MODES = {
    spy: { title: 'Spy', blurb: 'Everyone gets a theme except the spy. Play tracks that fit it and find who is faking.', meta: '3 to 8 players' },
    k5: { title: 'Keep 5 Delete 5', blurb: 'Listen to an album together. Keep half, delete half, no changing your mind.', meta: '1 to 8 players' },
  };
  let selectedMode = MS.store.get(MODE_KEY) === 'k5' ? 'k5' : 'spy';

  const urlRoom = () => MS.normCode(new URLSearchParams(location.search).get('room'));
  const inviteLink = (code) => `${location.origin}/?room=${code}`;

  // ---------- home ----------
  let featured = [];
  let fanTimer = null;
  let fanFront = 0;

  function loadFeatured() {
    fetch('/api/featured').then((r) => r.json()).then((r) => {
      if (!r || !r.ok || !r.items.length) return;
      featured = r.items;
      fanFront = Math.floor(Math.random() * featured.length);
      if (!current && selectedMode === 'k5') {
        const fan = $('#fanSlot');
        if (fan) fan.innerHTML = MS.ui.coverFan(rotated());
        backdropForHome();
      }
    }).catch(() => {});
  }
  const rotated = () => featured.slice(fanFront).concat(featured.slice(0, fanFront));

  function backdropForHome() {
    if (selectedMode === 'k5' && featured.length) MS.setBackdrop(rotated()[0].cover);
    else MS.setBackdrop('');
  }

  // Every few seconds the home backdrop moves on. K5: the front cover of the fan goes to the back and the
  // backdrop takes the new cover's colours. Spy: a hard cut to the next surveillance-camera palette (fx.js).
  function startFan() {
    clearInterval(fanTimer);
    fanTimer = setInterval(() => {
      if (current || document.hidden || !document.querySelector('.home-screen') || document.querySelector('.home-screen.leaving')) return;
      if (selectedMode === 'spy') {
        if (window.MSFX) window.MSFX.cut();
        return;
      }
      if (!featured.length) return;
      const fan = $('.cover-fan');
      if (!fan) return;
      fan.classList.add('shuffle');
      setTimeout(() => {
        fanFront = (fanFront + 1) % featured.length;
        const slot = $('#fanSlot');
        if (slot) slot.innerHTML = MS.ui.coverFan(rotated());
        backdropForHome();
      }, 420);
    }, 5200);
  }

  const vinylIcon = '<span class="vinyl-coin" aria-hidden="true"></span>';

  function topNav() {
    const A = MS.account;
    const reqs = A.incomingCount();
    const me = A.user ? { ...A.user, name: A.user.displayName } : { name: A.guestName || '?' };
    return `
      <header class="topnav" data-build style="--b:0">
        <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i class="odd"></i></span><b>MusicSpy</b></div>
        <nav class="nav-tabs" aria-label="Main">
          <button class="nav-tab active" data-act="nav" data-v="play" aria-current="page">Play</button>
          <button class="nav-tab" data-act="nav" data-v="shop">Shop<span class="soon-dot" aria-label="coming soon"></span></button>
          <button class="nav-tab" data-act="nav" data-v="leaderboard">Leaderboard<span class="soon-dot" aria-label="coming soon"></span></button>
          <button class="nav-tab" data-act="nav" data-v="profile">Profile</button>
        </nav>
        <div class="nav-right">
          <button class="pill" data-act="stub" data-v="vinyls" aria-label="Vinyls, coming soon">${vinylIcon}<b>${A.user && A.user.economy ? Number(A.user.economy.vinyls || 0).toLocaleString('en-US') : '0'}</b></button>
          ${MS.music.buttonHtml()}
          <button class="icon-btn" data-act="stub" data-v="chat" aria-label="Global chat, coming soon">${MS.icon.chat}</button>
          <button class="icon-btn" data-act="openFriends" aria-label="Friends">${MS.icon.friends}${reqs ? `<span class="badge">${reqs}</span>` : ''}</button>
          <button class="avatar-btn" data-act="openAccount" aria-label="${A.user ? 'Account' : 'Sign in'}">${MS.avatar(me, 'sm')}</button>
        </div>
      </header>`;
  }

  function bottomNav() {
    const item = (v, label, icon, soon) => `<button class="bnav-item ${v === 'play' ? 'active' : ''}" data-act="nav" data-v="${v}">${icon}<span>${label}</span>${soon ? '<i class="soon-dot"></i>' : ''}</button>`;
    return `<nav class="bottom-nav" aria-label="Main">
      ${item('play', 'Play', MS.icon.play)}
      ${item('shop', 'Shop', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>', true)}
      ${item('leaderboard', 'Leaders', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>', true)}
      ${item('profile', 'Profile', MS.icon.user)}
    </nav>`;
  }

  function heroSpy() {
    return `
      <p class="kicker" data-build style="--b:2"><span>3 to 8 players</span></p>
      <h1 class="hero-title" data-build style="--b:3">Spy</h1>
      <p class="hero-lead" data-build style="--b:4">Everyone gets the same music theme except the spy. Play tracks that fit it, listen closely, and vote out the one who is faking.</p>
      <div class="hero-visual" data-build style="--b:5">${MS.ui.lineup(5)}</div>
      <ol class="steps" data-build style="--b:6">
        <li><b class="step-num">01</b><span>Get the theme</span></li>
        <li><b class="step-num">02</b><span>Play a track</span></li>
        <li><b class="step-num">03</b><span>Vote out the spy</span></li>
      </ol>`;
  }

  function heroK5() {
    return `
      <p class="kicker" data-build style="--b:2"><span>1 to 8 players</span></p>
      <h1 class="hero-title k5-title" data-build style="--b:3">Keep 5 <span class="strike-draw">Delete 5</span></h1>
      <p class="hero-lead" data-build style="--b:4">Listen to an album with friends. Keep half the tracks, delete the rest, and see whose taste matches yours.</p>
      <div class="hero-visual fan-visual" data-build style="--b:5"><div id="fanSlot">${MS.ui.coverFan(rotated())}</div>
        <div class="fan-picks"><span class="chip keep">Keep</span><span class="chip del">Delete</span></div></div>
      <ol class="steps" data-build style="--b:6">
        <li><b class="step-num">01</b><span>Pick an album</span></li>
        <li><b class="step-num">02</b><span>Keep or delete</span></li>
        <li><b class="step-num">03</b><span>Compare taste</span></li>
      </ol>`;
  }

  function playerCard() {
    const A = MS.account;
    const u = A.user;
    const level = u && u.economy && u.economy.level ? u.economy.level : 1;
    const xpPct = u && u.economy && u.economy.levelProgress ? Math.round((u.economy.levelProgress.progress || 0) * 100) : 0;
    return `
      <article class="player-card" data-build style="--b:3">
        <div class="pc-banner" aria-hidden="true"><i></i><i></i></div>
        <div class="pc-main">
          <div class="pc-avatar">${MS.avatar(u ? { ...u, name: u.displayName } : { name: A.guestName || '?' }, 'lg')}<button class="level-ring" data-act="stub" data-v="level" aria-label="Level ${level}, coming soon"><b>${level}</b></button></div>
          <div class="pc-name">
            <b>${esc(u ? (u.displayName || u.username) : (A.guestName || 'Guest'))}</b>
            <small>${u ? `@${esc(u.username)}` : 'Playing as a guest'}</small>
          </div>
          <button class="btn small" data-act="openAccount">${u ? 'Profile' : 'Sign in'}</button>
        </div>
        <button class="pc-xp" data-act="stub" data-v="level"><span>Level ${level}</span><span class="xp-bar"><i style="width:${xpPct}%"></i></span><span class="tag">Soon</span></button>
        ${u ? '' : `<label class="field pc-field"><span>Nickname</span><input id="nameInput" maxlength="18" autocomplete="nickname" placeholder="What should we call you" value="${esc(A.guestName)}"></label>`}
      </article>`;
  }

  function joinCard(invite) {
    if (invite) {
      return `
        <article class="side-card join-card invited" data-build style="--b:4">
          <p class="side-label">Invite</p>
          <p class="invite-note">You are invited to room <b>${esc(invite)}</b></p>
          <button class="btn primary" data-act="joinInvite">Join room ${esc(invite)}</button>
        </article>`;
    }
    return `
      <article class="side-card join-card" data-build style="--b:4">
        <p class="side-label">Join a friend</p>
        <form id="joinForm" class="code-row" data-form="join"><input id="codeInput" maxlength="6" placeholder="Room code" autocomplete="off" spellcheck="false" aria-label="Room code"><button class="btn">Join</button></form>
      </article>`;
  }

  function stubCards() {
    return `
      <button class="side-card stub-card" data-act="stub" data-v="daily" data-build style="--b:5">
        <span class="side-label">Daily reward <span class="tag">Soon</span></span>
        <span class="days">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<i class="${d === 1 ? 'today' : ''}">${d}</i>`).join('')}</span>
      </button>
      <button class="side-card stub-card" data-act="stub" data-v="rooms" data-build style="--b:6">
        <span class="side-label">Open rooms <span class="tag">Soon</span></span>
        <span class="stub-line">Join a public game without a code</span>
      </button>`;
  }

  let buildTimer = null;
  function renderHome(build = true, switching = false) {
    if (current) return;
    MS.chat.setSource(null);
    MS.music.setContext('menu');
    document.title = selectedMode === 'k5' ? 'Keep 5 Delete 5 · MusicSpy' : 'Spy · MusicSpy';
    const invite = urlRoom();
    const mode = selectedMode;
    $('#app').innerHTML = `
      <div class="screen home-screen ${build ? 'building' : ''} ${switching ? 'switching' : ''}">
        ${topNav()}
        <main class="hub" data-mode="${mode}">
          <section class="hub-hero">
            <div class="mode-switch" role="tablist" aria-label="Game" data-build style="--b:1">
              <button role="tab" data-act="pickMode" data-v="spy" aria-selected="${mode === 'spy'}">Spy</button>
              <button role="tab" data-act="pickMode" data-v="k5" aria-selected="${mode === 'k5'}">Keep 5 Delete 5</button>
              <span class="mode-thumb" aria-hidden="true"></span>
            </div>
            ${mode === 'spy' ? heroSpy() : heroK5()}
            <div class="hero-cta" data-build style="--b:7">
              <button class="btn primary big cta" data-act="create">Create ${mode === 'spy' ? 'Spy' : 'Keep 5 Delete 5'} room</button>
              <button class="btn quiet" data-act="howTo">How to play</button>
            </div>
          </section>
          <aside class="hub-side">
            ${playerCard()}
            ${joinCard(invite)}
            ${stubCards()}
          </aside>
        </main>
        ${bottomNav()}
      </div>`;
    const codeInput = $('#codeInput');
    if (codeInput) codeInput.addEventListener('input', () => { codeInput.value = MS.normCode(codeInput.value); });
    bindNameInput();
    clearTimeout(buildTimer);
    if (build) buildTimer = setTimeout(() => { const s = $('.home-screen'); if (s) s.classList.remove('building', 'switching'); }, 1800);
    backdropForHome();
    startFan();
    if (homeMessage) {
      MS.toast(homeMessage);
      homeMessage = '';
    }
  }

  function bindNameInput() {
    const nameInput = $('#nameInput');
    if (!nameInput) return;
    nameInput.addEventListener('change', () => { MS.account.guestName = nameInput.value; });
    nameInput.addEventListener('input', () => {
      const n = $('.pc-name b');
      if (n) n.textContent = nameInput.value.trim() || 'Guest';
    });
  }

  function pickMode(mode) {
    if (mode === selectedMode) return;
    const name = $('#nameInput');
    if (name) MS.account.guestName = name.value;
    selectedMode = mode;
    MS.store.set(MODE_KEY, mode);
    // the switch thumb slides right away; the rest of the screen takes itself apart and builds the new mode
    const hub = $('.hub');
    if (hub) hub.dataset.mode = mode;
    document.querySelectorAll('.mode-switch [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === mode)));
    MS.theme.go(mode, () => renderHome(true, true));
  }

  function nav(where) {
    if (where === 'play') {
      if (current) return;
      return renderHome();
    }
    if (where === 'profile') return MS.account.openAccount();
    MS.ui.stub(where);
  }

  function readName() {
    if (MS.account.signedIn) return MS.account.displayName();
    const input = $('#nameInput');
    const v = (input ? input.value : MS.account.guestName).trim();
    if (!v) {
      MS.toast('Enter a nickname first');
      if (input) input.focus();
      return null;
    }
    MS.account.guestName = v;
    return v;
  }

  function showConnecting(text = 'Connecting to the room') {
    $('#app').innerHTML = `<div class="center-screen"><div class="spinner"></div><p>${esc(text)}</p></div>`;
  }

  // ---------- room lifecycle ----------
  function saveRoom() {
    const s = current && current.session();
    if (s) MS.store.set(ROOM_KEY, s);
  }

  const appApi = (MS.app = {
    roomStarted(controller) {
      if (current && current !== controller) current.destroy();
      current = controller;
      clearInterval(fanTimer);
      saveRoom();
      history.replaceState(null, '', `/?room=${controller.code}`);
      MS.theme.apply(controller.mode);
      MS.music.setContext('lobby');
    },
    dropRoom(message) {
      if (current) current.destroy();
      current = null;
      MS.store.del(ROOM_KEY);
      MS.audio.stop();
      MS.chat.setSource(null);
      MS.sheet.closeTop();
      history.replaceState(null, '', '/');
      homeMessage = message || '';
      MS.theme.apply(selectedMode);
      renderHome();
    },
    async joinByCode(rawCode) {
      const code = MS.normCode(rawCode);
      if (code.length < 5) return MS.toast('Room codes have 5 characters');
      if (current && current.code === code) return;
      const name = readName() || MS.account.displayName() || MS.account.guestName;
      if (!name) {
        if (!$('#nameInput')) { homeMessage = 'Enter a nickname first'; appApi.dropRoom('Enter a nickname first'); }
        return;
      }
      if (busy) return;
      busy = true;
      const found = await MS.emit('room:lookup', { code });
      if (!MS.okOf(found)) {
        busy = false;
        return MS.toast(found.error || 'Room not found');
      }
      if (current) await current.leave();
      MS.audio.unlock();
      showConnecting();
      const r = await MS.modes[found.mode].join(code, name);
      busy = false;
      if (!MS.okOf(r)) appApi.dropRoom(r.error || 'Could not join the room');
    },
    async create(mode) {
      const name = readName();
      if (!name || busy) return;
      busy = true;
      MS.audio.unlock();
      showConnecting('Creating the room');
      const r = await MS.modes[mode].create(name);
      busy = false;
      if (!MS.okOf(r)) appApi.dropRoom(r.error || 'Could not create the room');
    },
    async leave() {
      if (!current) return;
      const playing = !current.inLobby;
      if (playing && !confirm('Leave the game? Your seat is kept for a minute in case you come back.')) return;
      const c = current;
      await c.leave();
      if (current === c) appApi.dropRoom();
    },
    // Host only: open a room of the other mode and bring everyone over.
    async switchGame() {
      if (!current || !current.isHost) return;
      const from = { mode: current.mode, code: current.code };
      const target = from.mode === 'spy' ? 'k5' : 'spy';
      if (!confirm(`Switch this room to ${MODES[target].title}? Everyone moves with you.`)) return;
      const name = MS.account.displayName() || MS.account.guestName || 'Host';
      const old = current;
      const r = await MS.modes[target].create(name);
      if (!MS.okOf(r)) return MS.toast(r.error || 'Could not switch the game');
      await MS.emit('room:announceMove', { fromMode: from.mode, fromCode: from.code, toMode: target, toCode: r.code || current.code });
      // leave the old room quietly (the new controller is already current)
      if (old !== current) {
        if (from.mode === 'spy') await MS.emit('leaveLobby', { code: from.code });
        else await MS.emit('k5:leave', {});
      }
    },
  });

  MS.socket.on('room:moved', async ({ mode, code } = {}) => {
    if (!current || !mode || !code) return;
    const name = MS.account.displayName() || MS.account.guestName || 'Player';
    const old = current;
    MS.toast(`The host switched to ${MODES[mode] ? MODES[mode].title : 'another game'}`);
    await old.leave();
    showConnecting();
    const r = await MS.modes[mode].join(code, name);
    if (!MS.okOf(r)) appApi.dropRoom(r.error || 'Could not follow the host');
  });

  // ---------- boot + reconnect ----------
  async function onConnect() {
    await MS.account.restore();
    if (current) {
      await current.reconnect();
      return;
    }
    if (booted) return;
    booted = true;
    const saved = MS.store.get(ROOM_KEY);
    const invite = urlRoom();
    if (saved && saved.code && MS.modes[saved.mode] && (!invite || invite === saved.code)) {
      showConnecting();
      const name = MS.account.displayName() || MS.account.guestName || 'Guest';
      const r = await MS.modes[saved.mode].join(saved.code, name, saved);
      if (MS.okOf(r)) return;
      MS.store.del(ROOM_KEY);
    }
    renderHome();
  }
  MS.socket.on('connect', onConnect);
  // Account changes (sign-in, friend requests, ...) only refresh the account parts of the home screen.
  MS.account.onChange(() => {
    if (current) return;
    const card = $('.player-card');
    const navEl = $('.topnav');
    if (!card || !navEl) return renderHome(false);
    const typed = $('#nameInput') ? $('#nameInput').value : null;
    card.outerHTML = playerCard();
    navEl.outerHTML = topNav();
    if (typed !== null && $('#nameInput')) $('#nameInput').value = typed;
    bindNameInput();
  });

  // ---------- shared input handling ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !el.closest('#app')) return;
    const act = el.dataset.act;
    switch (act) {
      case 'pickMode': pickMode(el.dataset.v === 'k5' ? 'k5' : 'spy'); return;
      case 'nav': nav(el.dataset.v); return;
      case 'stub': MS.ui.stub(el.dataset.v); return;
      case 'howTo': MS.ui.howTo(current ? current.mode : selectedMode); return;
      case 'music': MS.music.openPanel(); return;
      case 'create': appApi.create(selectedMode); return;
      case 'joinInvite': appApi.joinByCode(urlRoom()); return;
      case 'openAccount': MS.account.openAccount(); return;
      case 'openFriends': MS.account.openFriends({ inviteCode: current ? current.code : null }); return;
      case 'toggleChat': MS.chat.toggle(); return;
      case 'copyLink': if (current) MS.copyText(inviteLink(current.code), 'Invite link copied. Send it to your friends'); return;
      case 'leaveRoom': appApi.leave(); return;
      case 'switchGame': appApi.switchGame(); return;
      default:
        if (current) current.onAct(act, el, e);
    }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.closest('#app')) return;
    if (form.dataset.form === 'join') {
      e.preventDefault();
      appApi.joinByCode($('#codeInput').value);
      return;
    }
    if (current && current.onSubmit && current.onSubmit(form)) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (current && current.onKey) current.onKey(e);
  });

  // First paint before the socket connects.
  loadFeatured();
  if (MS.store.get(ROOM_KEY)) showConnecting();
  else renderHome();
})();
