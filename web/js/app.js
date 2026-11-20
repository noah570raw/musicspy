'use strict';
// App shell: home screen, joining by code, restoring the room after a reload or a reconnect,
// "Switch game" between the modes, and the click handling shared by every screen.
(() => {
  const MS = window.MS;
  const { $, esc } = MS;
  const ROOM_KEY = 'ms_room';
  const MODE_KEY = 'ms_mode';

  let current = null; // active mode controller (MS.modes.spy | MS.modes.k5 | MS.modes.koth)
  let booted = false;
  let homeMessage = '';
  let busy = false;
  // home hub page: play | shop | leaderboard | profile (the page modules live in shop.js, leaderboard.js, profile.js)
  const VIEWS = ['play', 'shop', 'leaderboard', 'profile'];
  let hubView = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'play';
  let mountedPage = null;

  const MODES = {
    spy: { title: 'Spy', blurb: 'Everyone gets a theme except the spy. Play tracks that fit it and find who is faking.', meta: '3 to 8 players' },
    k5: { title: 'Keep 5 Delete 5', blurb: 'Listen to an album together. Keep half, delete half, no changing your mind.', meta: '1 to 8 players' },
    koth: { title: 'King of the Hill', blurb: 'Tracks from one album fight in pairs until a single king is left.', meta: '1 to 8 players' },
  };
  const modeOf = (v) => (MODES[v] ? v : 'spy');
  const usesCovers = (mode) => mode === 'k5' || mode === 'koth';
  let selectedMode = modeOf(MS.store.get(MODE_KEY));

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
      if (!current && usesCovers(selectedMode)) {
        const fan = $('#fanSlot');
        if (fan) fan.innerHTML = MS.ui.coverFan(rotated());
        const hill = $('#hillSlot');
        if (hill) hill.innerHTML = MS.ui.hill(rotated());
        backdropForHome();
      }
    }).catch(() => {});
  }
  const rotated = () => featured.slice(fanFront).concat(featured.slice(0, fanFront));

  function backdropForHome() {
    if (usesCovers(selectedMode) && featured.length) MS.setBackdrop(rotated()[0].cover);
    else MS.setBackdrop('');
  }

  // Every few seconds the home backdrop moves on. K5: the front cover of the fan goes to the back and the
  // backdrop takes the new cover's colours. King of the Hill: the mini bracket is dealt again from the next
  // covers. Spy: a hard cut to the next surveillance-camera palette (fx.js).
  function startFan() {
    clearInterval(fanTimer);
    fanTimer = setInterval(() => {
      if (current || document.hidden || !document.querySelector('.home-screen') || document.querySelector('.home-screen.leaving')) return;
      if (selectedMode === 'spy') {
        if (window.MSFX) window.MSFX.cut();
        return;
      }
      if (!featured.length) return;
      if (selectedMode === 'koth') {
        const hill = $('.hill');
        if (!hill) return;
        hill.classList.add('shuffle');
        setTimeout(() => {
          fanFront = (fanFront + 1) % featured.length;
          const slot = $('#hillSlot');
          if (slot) slot.innerHTML = MS.ui.hill(rotated());
          backdropForHome();
        }, 420);
        return;
      }
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
          ${['play', 'shop', 'leaderboard', 'profile'].map((v) => `<button class="nav-tab ${hubView === v ? 'active' : ''}" data-act="nav" data-v="${v}" ${hubView === v ? 'aria-current="page"' : ''}>${v.charAt(0).toUpperCase()}${v.slice(1)}</button>`).join('')}
        </nav>
        <div class="nav-right">
          <button class="pill" data-act="wallet" aria-label="Vinyls">${vinylIcon}<b data-vinyls>${A.user && A.user.economy ? Number(A.user.economy.vinyls || 0).toLocaleString('en-US') : '0'}</b></button>
          ${MS.music.buttonHtml()}
          <button class="icon-btn" data-act="globalChat" aria-label="Global chat">${MS.icon.chat}</button>
          <button class="icon-btn" data-act="openFriends" aria-label="Friends">${MS.icon.friends}${reqs ? `<span class="badge">${reqs}</span>` : ''}</button>
          <button class="avatar-btn" data-act="${A.user ? 'nav' : 'openAccount'}" data-v="profile" aria-label="${A.user ? 'Your profile' : 'Sign in'}">${MS.avatar(me, 'sm')}</button>
        </div>
      </header>`;
  }

  function bottomNav() {
    const item = (v, label, icon) => `<button class="bnav-item ${v === hubView ? 'active' : ''}" data-act="nav" data-v="${v}">${icon}<span>${label}</span></button>`;
    return `<nav class="bottom-nav" aria-label="Main">
      ${item('play', 'Play', MS.icon.play)}
      ${item('shop', 'Shop', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>')}
      ${item('leaderboard', 'Leaders', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>')}
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

  function heroKoth() {
    return `
      <p class="kicker" data-build style="--b:2"><span>1 to 8 players</span></p>
      <h1 class="hero-title koth-title" data-build style="--b:3">King of the Hill</h1>
      <p class="hero-lead" data-build style="--b:4">Tracks from one album fight in pairs. Pick the better one every time until a single track is left on top.</p>
      <div class="hero-visual hill-visual" data-build style="--b:5"><div id="hillSlot">${MS.ui.hill(rotated())}</div></div>
      <ol class="steps" data-build style="--b:6">
        <li><b class="step-num">01</b><span>Pick an album</span></li>
        <li><b class="step-num">02</b><span>One of two</span></li>
        <li><b class="step-num">03</b><span>Crown the king</span></li>
      </ol>`;
  }

  function playerCard() {
    const A = MS.account;
    const u = A.user;
    const pr = MS.econ.progress();
    const level = u ? pr.level : 1;
    const xpPct = u ? pr.progress : 0;
    const booster = MS.econ.booster();
    const me = u ? { ...u, name: u.displayName || u.username } : { name: A.guestName || '?' };
    const banner = u ? MS.cos.banner(me) : '';
    return `
      <article class="player-card" data-build style="--b:3">
        <div class="pc-banner ${banner ? 'worn' : ''}" aria-hidden="true" style="${banner ? `background:${banner}` : ''}"><i></i><i></i></div>
        <div class="pc-main">
          <div class="pc-avatar">${MS.avatar(me, 'lg')}<button class="level-ring" style="--p:${xpPct}" data-act="openLevel" aria-label="Level ${level}"><b>${level}</b></button></div>
          <div class="pc-name">
            <b>${u ? MS.cos.nick(me.name, me) : esc(A.guestName || 'Guest')}</b>
            <small>${u ? `@${esc(u.username)}` : 'Playing as a guest'}</small>
          </div>
          <button class="btn small" data-act="${u ? 'nav' : 'openAccount'}" data-v="profile">${u ? 'Profile' : 'Sign in'}</button>
        </div>
        <button class="pc-xp" data-act="openLevel"><span>Level ${level}</span><span class="xp-bar"><i style="width:${xpPct}%"></i></span>${booster && booster.active ? `<span class="tag solid">XP x${booster.displayMultiplier}</span>` : u ? `<span class="pc-xp-left">${MS.econ.fmt(pr.left)} XP to ${level + 1}</span>` : '<span class="pc-xp-left">Sign in to level up</span>'}</button>
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

  function sideCards() {
    return `
      <button class="side-card daily-card" id="dailyCard" data-act="daily" data-build style="--b:5">${MS.econ.dailyCardHtml()}</button>
      <div class="side-card rooms-card" id="roomsCard" data-build style="--b:6">${MS.social.roomsHtml()}</div>`;
  }

  function refreshDaily() {
    MS.econ.refreshDaily().then(() => {
      const card = $('#dailyCard');
      if (card) card.innerHTML = MS.econ.dailyCardHtml();
    });
  }

  // Shop / Leaderboard / Profile: one page under the top navigation.
  function renderPage() {
    const page = MS.pages[hubView];
    document.title = `${page.title} · MusicSpy`;
    $('#app').innerHTML = `
      <div class="screen home-screen page-screen">
        ${topNav()}
        <main class="hub-page" id="hubPage" data-page="${hubView}"></main>
        ${bottomNav()}
      </div>`;
    mountedPage = page;
    page.mount($('#hubPage'), pageOpts);
    pageOpts = {};
  }
  let pageOpts = {};
  function unmountPage() {
    if (mountedPage && mountedPage.unmount) mountedPage.unmount();
    mountedPage = null;
  }

  let buildTimer = null;
  function renderHome(build = true, switching = false) {
    if (current) return;
    MS.chat.setSource(null);
    MS.music.setContext('menu');
    unmountPage();
    if (hubView !== 'play') {
      MS.social.stopRooms();
      clearInterval(fanTimer);
      backdropForHome();
      renderPage();
      return;
    }
    document.title = `${MODES[selectedMode].title} · MusicSpy`;
    const invite = urlRoom();
    const mode = selectedMode;
    $('#app').innerHTML = `
      <div class="screen home-screen ${build ? 'building' : ''} ${switching ? 'switching' : ''}">
        ${topNav()}
        <main class="hub" data-mode="${mode}">
          <section class="hub-hero">
            <div class="mode-switch" role="tablist" aria-label="Game" data-build style="--b:1">
              <button role="tab" data-act="pickMode" data-v="spy" aria-selected="${mode === 'spy'}">Spy</button>
              <button role="tab" data-act="pickMode" data-v="k5" aria-selected="${mode === 'k5'}"><span class="long">Keep 5 Delete 5</span><span class="short">Keep 5</span></button>
              <button role="tab" data-act="pickMode" data-v="koth" aria-selected="${mode === 'koth'}"><span class="long">King of the Hill</span><span class="short">King</span></button>
              <span class="mode-thumb" aria-hidden="true"></span>
            </div>
            ${mode === 'spy' ? heroSpy() : mode === 'k5' ? heroK5() : heroKoth()}
            <div class="hero-cta" data-build style="--b:7">
              <button class="btn primary big cta" data-act="create">Create ${MODES[mode].title} room</button>
              <button class="btn quiet" data-act="howTo">How to play</button>
            </div>
          </section>
          <aside class="hub-side">
            ${playerCard()}
            ${joinCard(invite)}
            ${sideCards()}
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
    refreshDaily();
    MS.social.startRooms();
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

  function nav(where, opts = {}) {
    if (current || !VIEWS.includes(where)) return;
    const name = $('#nameInput');
    if (name) MS.account.guestName = name.value;
    const same = where === hubView;
    hubView = where;
    pageOpts = opts;
    history.replaceState(null, '', where === 'play' ? `/${location.search}` : `/${location.search}#${where}`);
    if (MS.sfx && !same) MS.sfx.play('tap');
    renderHome(where === 'play' && !same);
    window.scrollTo(0, 0);
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
    nav,
    inRoom: () => Boolean(current),
    roomStarted(controller) {
      if (current && current !== controller) current.destroy();
      current = controller;
      clearInterval(fanTimer);
      unmountPage();
      MS.social.stopRooms();
      if (MS.gchat.isOpen) MS.gchat.toggle(false);
      saveRoom();
      history.replaceState(null, '', `/?room=${controller.code}`);
      MS.theme.apply(controller.mode);
      MS.music.setContext('lobby');
    },
    // the server moved the room to a new code (Spy: back to the lobby after a game)
    codeChanged(controller) {
      if (controller !== current) return;
      saveRoom();
      history.replaceState(null, '', `/?room=${controller.code}`);
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
    // Host only: pick one of the other games.
    switchGame() {
      if (!current || !current.isHost) return;
      const others = Object.keys(MODES).filter((m) => m !== current.mode);
      const el = MS.sheet.open('switchGame', {
        title: 'Switch game',
        cls: 'narrow',
        body: `<div class="sheet-body"><p class="src-sub" style="margin:0">Everyone in the room moves with you.</p>
          <div class="switch-list">${others.map((m) => `<button class="switch-opt" data-switch="${m}"><b>${esc(MODES[m].title)}</b><small>${esc(MODES[m].blurb)}</small></button>`).join('')}</div></div>`,
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-switch]');
        if (!b) return;
        MS.sheet.close('switchGame');
        appApi.moveTo(b.dataset.switch);
      });
    },
    // Host only: open a room of the target mode and bring everyone over.
    async moveTo(target) {
      if (!current || !current.isHost || !MODES[target] || target === current.mode) return;
      const from = { mode: current.mode, code: current.code };
      const name = MS.account.displayName() || MS.account.guestName || 'Host';
      const old = current;
      const r = await MS.modes[target].create(name);
      if (!MS.okOf(r)) return MS.toast(r.error || 'Could not switch the game');
      await MS.emit('room:announceMove', { fromMode: from.mode, fromCode: from.code, toMode: target, toCode: r.code || current.code });
      // leave the old room quietly (the new controller is already current)
      if (old !== current) {
        if (from.mode === 'spy') await MS.emit('leaveLobby', { code: from.code });
        else await MS.emit(`${from.mode}:leave`, {});
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
    if (hubView !== 'play') {
      const navEl = $('.topnav');
      if (navEl) navEl.outerHTML = topNav();
      return;
    }
    const card = $('.player-card');
    const navEl = $('.topnav');
    if (!card || !navEl) return renderHome(false);
    const typed = $('#nameInput') ? $('#nameInput').value : null;
    card.outerHTML = playerCard();
    navEl.outerHTML = topNav();
    if (!MS.econ.daily !== !MS.account.user) refreshDaily();
    if (typed !== null && $('#nameInput')) $('#nameInput').value = typed;
    bindNameInput();
  });

  // ---------- shared input handling ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !el.closest('#app')) return;
    const act = el.dataset.act;
    switch (act) {
      case 'pickMode': pickMode(modeOf(el.dataset.v)); return;
      case 'nav': nav(el.dataset.v); return;
      case 'stub': MS.ui.stub(el.dataset.v); return;
      case 'wallet': MS.econ.openWallet(); return;
      case 'openLevel': MS.econ.openLevel(); return;
      case 'daily': MS.econ.claimDaily(); return;
      case 'globalChat': MS.gchat.toggle(); return;
      case 'joinOpen': appApi.joinByCode(el.dataset.code); return;
      case 'viewProfile': MS.profile.open(el.dataset.id); return;
      case 'devConsole': MS.dev.open(); return;
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
    // the dev console opens with the backslash key (same physical key in the Russian layout), anywhere outside text fields
    if ((e.code === 'Backslash' || e.key === '\\') && !e.target.closest('input, textarea') && !MS.sheet.isOpen('dev') && MS.account.user && MS.account.user.permissions && MS.account.user.permissions.dev) {
      e.preventDefault();
      MS.dev.open();
    }
  });

  // First paint before the socket connects.
  loadFeatured();
  if (MS.store.get(ROOM_KEY)) showConnecting();
  else renderHome();
})();
