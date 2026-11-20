'use strict';
// Spy mode: lobby, role card, turns with Deezer track search, vote and results.
// The server's game logic is unchanged; it sends spy:state (one snapshot per player) next to the old events.
(() => {
  const MS = window.MS;
  const { $, $$, esc } = MS;
  const TOKEN_KEY = 'musicspy_reconnect_token';
  const REACTIONS = ['🔥', '❤️', '😂', '😮', '🕵️', '🤔'];
  const PRESETS = {
    classic: { gameMode: 'classic', rounds: 3, listenTime: 30, anonymousVoting: false, votingTime: 60, runoffOnTie: true },
    blitz: { gameMode: 'blitz', rounds: 1, listenTime: 15, anonymousVoting: true, votingTime: 30, runoffOnTie: false },
  };

  let state = null;
  let session = null; // { code }
  let screenKey = '';
  let prevPhase = null;
  const rolesShown = new Set();
  const search = { q: '', results: null, searching: false, seq: 0, timer: null, sending: false };

  const app = () => $('#app');

  function reconnectToken() {
    let t = '';
    try { t = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* private mode */ }
    if (!/^[a-f0-9-]{24,80}$/i.test(t)) {
      t = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
      try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
    }
    return t;
  }

  async function call(event, payload = {}) {
    const r = await MS.emit(event, { code: session && session.code, ...payload });
    if (r && r.error) MS.toast(r.error);
    return r;
  }

  const me = () => (state ? state.players.find((p) => p.id === state.meId) : null);
  const playerById = (id) => (state ? state.players.find((p) => p.id === id) : null);
  const nameOf = (id, fallback = 'Player') => (playerById(id) || {}).name || fallback;

  // ---------- server events ----------
  let pending = null; // a snapshot that arrived before the join ack (reconnectGame answers that way)
  MS.socket.on('spy:state', (s) => {
    if (!s) return;
    if (!session) { pending = s; return; }
    if (s.code !== session.code) {
      // the room got a new code (back to the lobby after a game): follow it if this is our seat
      if (!state || s.meId !== state.meId) return;
      session.code = s.code;
      MS.app.codeChanged(C);
    }
    MS.setServerNow(s.serverNow);
    prevPhase = state ? state.phase : null;
    state = s;
    render();
  });
  MS.socket.on('timer', ({ timeLeft, stage } = {}) => {
    if (!state || state.phase !== 'playing') return;
    state.timeLeft = timeLeft;
    if (stage) state.turnStage = stage;
    tickTurnTimer();
  });
  MS.socket.on('voteTimer', ({ timeLeft } = {}) => {
    if (!state || !state.vote) return;
    state.vote.timeLeft = timeLeft;
    tickVoteTimer();
  });
  MS.socket.on('spyGuessTimer', ({ timeLeft } = {}) => {
    if (!state || !state.guess) return;
    state.guess.timeLeft = timeLeft;
    const el = $('#guessTimer');
    if (el) el.textContent = `${Math.max(0, timeLeft)} s`;
  });
  MS.socket.on('kicked', ({ reason } = {}) => { if (session) MS.app.dropRoom(reason || 'You were removed from the room'); });
  MS.socket.on('gameCancelled', ({ reason } = {}) => { if (session) MS.toast(reason || 'The game was cancelled'); });
  MS.socket.on('hostAction', ({ message } = {}) => { if (session && message) MS.toast(message); });
  MS.socket.on('trackSkipped', ({ message } = {}) => { if (session && message) MS.toast(message); });

  // ---------- render ----------
  function render() {
    if (!state || !session) return;
    const view = state.phase === 'ended' ? 'results' : state.phase;
    const key = `${view}|${state.isHost ? 'h' : 'g'}|${state.role || ''}`;
    if (key !== screenKey) {
      screenKey = key;
      buildSkeleton(view);
    }
    if (view === 'lobby') updateLobby();
    else if (view === 'playing') updateTurn();
    else if (view === 'voting') updateVote();
    else if (view === 'spyGuess') updateGuess();
    else if (view === 'results') updateResults();
    maybeShowRole();
    MS.setBackdrop(backdrop());
    MS.music.setContext(state.phase === 'lobby' ? 'lobby' : 'game'); // menu music stays on, quieter, until the game starts
    syncAudio();
    MS.chat.setSource({
      roomKey: `spy:${state.code}`,
      messages: state.chat || [],
      meId: state.meId,
      players: state.players,
      send: (text) => MS.emit('chat:send', { code: session.code, text }),
    });
    document.title = `Spy · ${state.code}`;
  }

  function backdrop() {
    if (!state) return '';
    if (state.phase === 'playing') {
      if (state.track && state.track.cover) return state.track.cover;
      const last = [...state.trackHistory].reverse().find((t) => t.cover);
      return last ? last.cover : '';
    }
    if (state.phase === 'ended' && state.result) {
      const b = state.result.breakdown || {};
      const pick = (b.mostReactedTrack && b.mostReactedTrack.cover) ? b.mostReactedTrack : [...(state.result.trackHistory || [])].reverse().find((t) => t.cover);
      return pick ? pick.cover : '';
    }
    return '';
  }

  function syncAudio() {
    const t = state && state.track;
    const live = state && state.phase === 'playing' && t && t.preview && ['listening', 'paused'].includes(state.turnStage);
    if (!live) {
      if (!MS.audio.previewKey) MS.audio.sync(null);
      return;
    }
    MS.audio.sync({ key: `spy:${t.id}`, src: t.preview, startsAt: t.startsAt, loop: true, paused: state.turnStage === 'paused' });
  }

  function topbar(center = '') {
    return `
      <header class="bar">
        <span class="bar-brand"><span>Spy</span><small>MusicSpy</small></span>
        <div class="bar-center">${center}</div>
        <div class="bar-actions">
          ${MS.volumeControl()}
          <button class="room-btn" data-act="copyLink" title="Copy the invite link">${esc(state.code)}</button>
          ${MS.chat.buttonHtml()}
          <button class="leave-btn" data-act="leaveRoom">Leave</button>
        </div>
      </header>`;
  }

  function themeChip() {
    if (state.role === 'spy') return '<div class="theme-chip"><span>Theme</span><b>You are the spy</b></div>';
    if (state.theme) return `<div class="theme-chip"><span>Theme</span><b>${esc(state.theme)}</b></div>`;
    return '';
  }

  function buildSkeleton(view) {
    if (view === 'lobby') {
      app().innerHTML = `
        <div class="screen">
          ${topbar()}
          <main class="lobby">
            <div class="lob-main">
              <div id="lobLineup" class="lob-cover"></div>
              <div class="lob-side">
                <div id="lobSource" class="lob-source"></div>
                <div id="settingsBox" class="settings"></div>
                <div id="startBox" class="start"></div>
              </div>
            </div>
            <footer class="lob-foot">
              <div class="room-info"><span>Room</span><b>${esc(state.code)}</b>
                <button class="btn small" data-act="copyLink">${MS.icon.link}Copy invite link</button>
                <button class="btn small quiet" data-act="openFriends">Invite friends</button>
                ${state.isHost ? `<button class="btn small quiet" data-act="switchGame">${MS.icon.swap}Switch game</button>` : ''}
              </div>
              <ul id="playerList" class="people"></ul>
            </footer>
          </main>
        </div>`;
    } else if (view === 'playing') {
      app().innerHTML = `
        <div class="screen">
          ${topbar(`<div id="themeBox">${themeChip()}</div>`)}
          <main class="spy-game">
            <section id="turns" class="turns" aria-label="Turn order"></section>
            <section class="stage">
              <div id="trackCard" class="track"></div>
              <div id="timerBox" class="progress"><div class="progress-line"><i id="timerFill"></i></div><span id="timerText" class="timer-text">&nbsp;</span></div>
              <div id="spyActions" class="spy-actions"></div>
            </section>
            <section id="played" class="played" aria-label="Played tracks"></section>
          </main>
        </div>`;
    } else if (view === 'voting') {
      app().innerHTML = `
        <div class="screen">
          ${topbar(`<div id="themeBox">${themeChip()}</div>`)}
          <main class="vote">
            <div class="vote-head"><div id="voteTitle"></div><div class="progress vote-timer"><div class="progress-line"><i id="voteFill"></i></div><span id="voteText" class="timer-text">&nbsp;</span></div></div>
            <section id="suspects" class="suspects"></section>
            <footer id="voteFoot" class="vote-foot"></footer>
          </main>
        </div>`;
    } else if (view === 'spyGuess') {
      app().innerHTML = `<div class="screen">${topbar(`<div id="themeBox">${themeChip()}</div>`)}<main id="guessMain" class="center-screen"></main></div>`;
    } else {
      app().innerHTML = `<div class="screen">${topbar()}<main id="resultsMain" class="results"></main></div>`;
    }
    MS.ui.build($('.screen'));
  }

  // ---------- lobby ----------
  function opt(act, v, label, active, disabled, wide = false, title = '') {
    return `<button class="opt ${wide ? 'wide' : ''} ${active ? 'active' : ''}" data-act="${act}" data-v="${esc(v)}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  }

  function updateLobby() {
    const host = state.isHost;
    const s = state.settings;
    const n = state.players.length;
    const readyCount = state.players.filter((p) => p.ready).length;
    const mine = me();
    const dis = !host;

    $('#playerList').innerHTML = state.players.map((p) => `
      <li class="${p.away ? 'away' : ''}">
        ${MS.avatar(p, 'sm')}<span>${esc(p.name)}${p.id === state.meId ? ' (you)' : ''}</span>
        ${p.id === state.hostId ? '<small>host</small>' : ''}${p.ready ? '<small class="ready">ready</small>' : ''}
        ${host && p.id !== state.meId ? `<button class="kick" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`).join('') + (n < state.minPlayers ? `<li class="lonely">Spy needs ${state.minPlayers} players. Send the link to ${state.minPlayers - n} more</li>` : '');

    const lineup = $('#lobLineup');
    const lineupKey = state.players.map((p) => `${p.id}:${p.name}`).join('|');
    if (lineup && lineup.dataset.key !== lineupKey) {
      lineup.dataset.key = lineupKey;
      lineup.innerHTML = MS.ui.lineup(Math.max(n, 3), n >= 3 ? state.players : [...state.players, ...Array.from({ length: 3 - n }, () => ({ name: '' }))]);
    }

    $('#lobSource').innerHTML = `
      <p class="src-kind">case file ${esc(state.code)} · ${MS.count(n, 'player')} of ${state.maxPlayers}</p>
      <h1 class="src-title">${esc(state.name || 'Music room')}</h1>
      <p class="src-sub">${host ? 'Set the rules, then start when everyone is ready.' : 'The host sets the rules. Press Ready when you are set.'}</p>`;

    const spyCountLabel = s.spyMode === 'auto' ? 'auto' : String(s.spyCount);
    $('#settingsBox').innerHTML = `
      <div class="set-row"><span class="set-name">Preset</span><div class="opts">${opt('preset', 'classic', 'Classic', s.gameMode === 'classic', dis, true)}${opt('preset', 'blitz', 'Blitz', s.gameMode === 'blitz', dis, true)}</div></div>
      <div class="set-row"><span class="set-name">Rounds</span><div class="opts">${[1, 2, 3, 4, 5].map((v) => opt('set', `rounds:${v}`, v, s.rounds === v, dis)).join('')}</div></div>
      <div class="set-row"><span class="set-name">Per track</span><div class="opts">${[15, 30].map((v) => opt('set', `listenTime:${v}`, `${v}s`, s.listenTime === v, dis)).join('')}</div></div>
      <div class="set-row"><span class="set-name">Spies</span><div class="opts">${opt('spies', 'auto', 'Auto', spyCountLabel === 'auto', dis, true, '1 spy, 2 from 6 players, 3 from 9')}${[1, 2, 3].map((v) => opt('spies', v, v, spyCountLabel === String(v), dis)).join('')}</div></div>
      <div class="set-row"><span class="set-name">Vote time</span><div class="opts">${[30, 60, 90].map((v) => opt('set', `votingTime:${v}`, `${v}s`, s.votingTime === v, dis)).join('')}${opt('set', 'votingTime:0', '∞', s.votingTime === 0, dis, false, 'No time limit')}</div></div>
      <div class="set-row"><span class="set-name">Votes</span><div class="opts">${opt('set', 'anonymousVoting:false', 'Open', !s.anonymousVoting, dis, true)}${opt('set', 'anonymousVoting:true', 'Anonymous', s.anonymousVoting, dis, true)}</div></div>
      <div class="set-row"><span class="set-name">Max players</span><div class="opts">${[3, 4, 5, 6, 7, 8].map((v) => opt('set', `maxPlayers:${v}`, v, s.maxPlayers === v, dis || v < n)).join('')}</div></div>`;

    const enough = n >= state.minPlayers;
    const allReady = readyCount === n;
    const readyBtn = `<button class="btn ${mine && mine.ready ? '' : 'primary'} big" data-act="ready">${mine && mine.ready ? 'Not ready' : 'I am ready'}</button>`;
    if (host) {
      $('#startBox').innerHTML = `
        <div class="start-row">
          <button class="btn primary big" data-act="start" ${enough && allReady ? '' : 'disabled'}>Start game</button>
          ${mine && !mine.ready ? '<button class="btn big" data-act="ready">I am ready</button>' : ''}
          ${enough && !allReady ? '<button class="btn quiet" data-act="forceStart">Start anyway</button>' : ''}
        </div>
        <p class="start-note">${!enough ? `${state.minPlayers} players minimum` : `${readyCount} of ${n} ready`}</p>`;
    } else {
      $('#startBox').innerHTML = `<div class="start-row">${readyBtn}</div><p class="start-note">${!enough ? `${state.minPlayers} players minimum` : `${readyCount} of ${n} ready. The host starts the game`}</p>`;
    }
  }

  // ---------- role card ----------
  function maybeShowRole() {
    if (!state || state.phase !== 'playing' || !state.role) return;
    const key = `${state.code}:${state.order.join(',')}`;
    if (rolesShown.has(key)) return;
    const fresh = prevPhase === 'lobby' || (state.round === 1 && state.trackHistory.length === 0);
    rolesShown.add(key);
    if (!fresh) return;
    const spy = state.role === 'spy';
    const others = spy ? state.spyIds.filter((id) => id !== state.meId).map((id) => nameOf(id)) : [];
    const el = document.createElement('div');
    el.className = 'role-overlay';
    el.innerHTML = `
      <div class="role-card" role="dialog" aria-modal="true" aria-label="Your role">
        <div class="file-head"><span>case file ${esc(state.code)}</span><span>classified</span></div>
        <p>${spy ? 'Your role' : 'Your theme'}</p>
        <h1>${spy ? 'You are the spy' : `<span class="redact">${esc(state.theme)}</span>`}</h1>
        ${spy ? '<span class="stamp">no theme for you</span>' : ''}
        <p>${spy
          ? `You do not know the theme. Listen to the others and pick tracks that blend in.${others.length ? ` Other spies: ${esc(others.join(', '))}.` : ''}`
          : `Pick tracks that fit it. ${state.spyCount > 1 ? `${state.spyCount} players do not` : 'One player does not'} know the theme.`}</p>
        <button class="btn primary big" data-role-ok>Got it</button>
      </div>`;
    const close = () => el.remove();
    el.querySelector('[data-role-ok]').addEventListener('click', close);
    document.body.appendChild(el);
    setTimeout(close, 12000);
  }

  // ---------- turn ----------
  function slotHtml(t, i) {
    return `<li class="slot" title="${esc(t.title ? `${t.title} by ${t.artist}` : 'Link')}">${t.cover ? `<img src="${esc(t.cover)}" alt="">` : '<i class="empty"></i>'}<span><b>${esc(t.title || 'Track from a link')}</b><small>${esc(t.playerName)}</small></span></li>`;
  }

  function updateTurn() {
    const themeBox = $('#themeBox');
    if (themeBox) themeBox.innerHTML = themeChip();
    const cur = state.currentPlayerId;
    const curName = nameOf(cur, 'Someone');
    const mineTurn = cur === state.meId;
    const t = state.track;
    const stage = state.turnStage;

    // turn order (left)
    const idx = state.order.indexOf(cur);
    $('#turns').innerHTML = `<h3>Round ${state.round} of ${state.totalRounds}<small>turn ${state.turnNumber} of ${state.turnsInRound}</small></h3>` + state.order.map((id, i) => {
      const p = playerById(id) || { id, name: 'Player' };
      const cls = id === cur ? 'now' : i < idx ? 'done' : '';
      const label = id === cur ? (t ? 'playing' : 'picking') : i < idx ? 'played' : 'next';
      return `<div class="turn ${cls} ${p.away ? 'away' : ''}">${MS.avatar(p, 'sm')}<b>${esc(p.name)}${id === state.meId ? ' (you)' : ''}</b><small>${label}</small></div>`;
    }).join('');

    // track card (centre)
    const card = $('#trackCard');
    const cardKey = t ? `t:${t.id}` : `w:${cur}:${mineTurn}`;
    if (card.dataset.key !== cardKey) {
      card.dataset.key = cardKey;
      if (t) {
        card.innerHTML = `
          ${t.cover ? `<img class="cover" src="${esc(t.cover)}" alt="">` : '<div class="cover-wait"><span>This track came from a link and cannot play here</span></div>'}
          <h1 class="track-title">${esc(t.title || 'Track from a link')}</h1>
          <p class="track-artist">${esc(t.artist || '')}</p>
          <p class="picked-by">Picked by ${esc(t.playerName)}</p>`;
        card.classList.remove('enter');
        void card.offsetWidth;
        card.classList.add('enter');
      } else {
        const p = playerById(cur) || { name: curName };
        card.innerHTML = `
          <div class="cover-wait">${MS.avatar(p)}<span class="${mineTurn ? '' : 'wait'}">${mineTurn ? 'Your turn' : `${esc(curName)} is picking a track`}</span></div>
          <h1 class="track-title">${mineTurn ? 'Pick a track' : 'Get ready to listen'}</h1>
          <p class="track-artist">${mineTurn ? (state.role === 'spy' ? 'Something that blends in with the others' : 'Something that fits the theme') : `Round ${state.round}, turn ${state.turnNumber}`}</p>`;
      }
    }
    $('#timerBox').classList.toggle('hidden', !t);
    tickTurnTimer();

    // actions
    const actions = [];
    if (!t && mineTurn && !state.submittedThisTurn) {
      actions.push(`<button class="btn primary big" data-act="openTrackPicker">${MS.icon.search}Pick a track</button>`);
    }
    if (t) {
      const own = t.playerId === state.meId;
      actions.push(`<div class="reactions" role="group" aria-label="Reactions">${REACTIONS.map((r) => `<button class="react ${state.myReaction === r ? 'on' : ''}" data-act="react" data-v="${r}" ${own ? 'disabled' : ''} aria-label="React ${r}">${r}<small>${state.reactions[r] || ''}</small></button>`).join('')}</div>`);
      const sv = state.skipVote || {};
      if (!own && sv.trackId) {
        const voted = (sv.voterIds || []).includes(state.meId);
        actions.push(`<button class="btn small ${voted ? '' : 'quiet'}" data-act="skip" ${voted ? 'disabled' : ''}>Skip track${sv.requiredVotes ? ` · ${sv.voteCount} of ${sv.requiredVotes}` : ''}</button>`);
      } else if (own) {
        actions.push('<p class="choice-note">Your track is playing</p>');
      }
    }
    if (state.isHost) {
      const listening = ['listening', 'paused'].includes(stage);
      actions.push(`
        <div class="host-tools" aria-label="Host controls">
          ${listening ? `<button class="btn small quiet" data-act="pause">${stage === 'paused' ? 'Resume' : 'Pause'}</button>
          <button class="btn small quiet" data-act="time" data-v="1">+15 s</button>
          <button class="btn small quiet" data-act="time" data-v="-1">−15 s</button>` : ''}
          <button class="btn small quiet" data-act="skipTurn">Skip turn</button>
          <button class="btn small quiet" data-act="startVote">Vote now</button>
        </div>`);
    }
    $('#spyActions').innerHTML = actions.join('');

    // played tracks (right)
    const played = [...state.trackHistory].filter((x) => !t || x.id !== t.id).reverse();
    $('#played').innerHTML = `<h3>Played<small>${played.length}</small></h3><ol>${played.length ? played.map(slotHtml).join('') : '<li class="empty-note">Tracks show up here after each turn</li>'}</ol>`;

    if (!mineTurn || t) MS.sheet.close('trackPicker');
  }

  function tickTurnTimer() {
    const fill = $('#timerFill');
    const text = $('#timerText');
    if (!fill || !text || !state || !state.track) return;
    const t = state.track;
    const listen = state.listenTime || 30;
    const left = Number.isFinite(state.timeLeft) ? state.timeLeft : listen;
    const before = t.startsAt && MS.now() < t.startsAt;
    fill.classList.toggle('urgent', left <= 5 && state.turnStage === 'listening');
    fill.style.width = `${Math.max(0, Math.min(100, (left / listen) * 100))}%`;
    text.textContent = state.turnStage === 'paused' ? 'Paused by the host' : before ? 'Starting' : `${Math.max(0, left)} s`;
  }

  // ---------- track picker (Deezer search) ----------
  function openTrackPicker() {
    const el = MS.sheet.open('trackPicker', {
      title: state.role === 'spy' ? 'Pick a track that blends in' : `Pick a track: ${state.theme || ''}`,
      cls: 'tall',
      body: `
        <div class="sheet-search">
          <form id="trackSearchForm" class="search"><input id="trackSearchInput" type="search" placeholder="Artist or track title" autocomplete="off" spellcheck="false" aria-label="Search tracks"><button class="btn">Search</button></form>
          <div id="trackResults" class="results-grid"></div>
        </div>`,
    });
    const input = $('#trackSearchInput');
    input.value = search.q;
    $('#trackSearchForm').addEventListener('submit', (e) => { e.preventDefault(); runTrackSearch(input.value); });
    input.addEventListener('input', () => {
      clearTimeout(search.timer);
      search.timer = setTimeout(() => runTrackSearch(input.value), 380);
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pick-track]');
      if (!b || search.sending) return;
      search.sending = true;
      b.classList.add('loading');
      MS.audio.unlock();
      const r = await MS.emit('playTrack', { code: session.code, trackId: b.dataset.pickTrack });
      search.sending = false;
      b.classList.remove('loading');
      if (MS.okOf(r)) {
        MS.sheet.close('trackPicker');
        search.q = '';
        search.results = null;
      } else MS.toast(r.error || 'Could not send the track');
    });
    renderTrackResults();
    setTimeout(() => input.focus(), 60);
  }

  async function runTrackSearch(q) {
    q = String(q || '').trim();
    search.q = q;
    const seq = ++search.seq;
    if (!q) { search.results = null; search.searching = false; renderTrackResults(); return; }
    search.searching = true;
    renderTrackResults();
    let r;
    try {
      const res = await fetch(`/api/search?type=track&q=${encodeURIComponent(q)}`);
      r = await res.json();
    } catch {
      r = { ok: false, error: 'Search is not answering. Try again' };
    }
    if (seq !== search.seq) return;
    search.searching = false;
    if (!r.ok) { search.results = []; MS.toast(r.error); } else search.results = r.items;
    renderTrackResults();
  }

  function renderTrackResults() {
    const box = $('#trackResults');
    if (!box) return;
    if (search.searching) {
      box.innerHTML = Array.from({ length: 6 }, () => '<div class="result ghost"><i></i><span><b></b><small></small></span></div>').join('');
    } else if (search.results === null) {
      box.innerHTML = '<p class="hint">Everyone hears a 30-second preview at the same time. Tap a track to play it.</p>';
    } else if (!search.results.length) {
      box.innerHTML = '<p class="hint">Nothing found. Try another spelling.</p>';
    } else {
      box.innerHTML = search.results.map((it) => `
        <button class="result" data-pick-track="${esc(it.id)}">
          <img src="${esc(it.cover)}" alt="" loading="lazy">
          <span><b>${esc(it.title)}</b><small>${esc(it.subtitle)}</small>${it.meta ? `<small class="meta">${esc(it.meta)}</small>` : ''}</span>
        </button>`).join('');
    }
  }

  // ---------- vote ----------
  function tracksOf(playerId, history) {
    return (history || []).filter((t) => t.playerId === playerId);
  }
  function thumbsHtml(list) {
    return list.map((t) => (t.preview
      ? `<li><button class="thumb listen" data-act="preview" data-src="${esc(t.preview)}" data-key="spyp:${esc(t.id)}" title="${esc(`${t.title} by ${t.artist}`)}" aria-label="Play ${esc(t.title)}"><img src="${esc(t.cover)}" alt="">${MS.playThumbSvg}</button></li>`
      : `<li><span class="thumb" title="${esc(t.title || 'Track from a link')}">${t.cover ? `<img src="${esc(t.cover)}" alt="">` : ''}</span></li>`)).join('');
  }

  function updateVote() {
    const themeBox = $('#themeBox');
    if (themeBox) themeBox.innerHTML = themeChip();
    const v = state.vote;
    if (!v) return;
    const runoff = v.round > 1;
    $('#voteTitle').innerHTML = `
      <h1>${runoff ? 'Runoff vote' : 'Vote for the spy'}</h1>
      <p>${runoff ? `Tie between ${esc(v.candidates.map((id) => nameOf(id)).join(' and '))}. Vote again.` : 'Listen back to the tracks and pick who did not know the theme.'}</p>`;
    $('#suspects').innerHTML = state.players.map((p) => {
      const candidate = v.candidates.includes(p.id);
      const self = p.id === state.meId;
      const count = v.totals[p.id] || 0;
      return `
        <article class="suspect ${v.myVote === p.id ? 'mine' : ''} ${candidate ? '' : 'out'}">
          <div class="suspect-head">${MS.avatar(p)}<b>${esc(p.name)}${self ? ' (you)' : ''}</b>${!v.anonymous ? `<span class="count">${count}</span>` : ''}</div>
          <ol>${thumbsHtml(tracksOf(p.id, state.trackHistory))}</ol>
          ${candidate && !self ? `<button class="btn ${v.myVote === p.id ? 'primary' : ''}" data-act="vote" data-id="${esc(p.id)}">${v.myVote === p.id ? 'Your vote' : 'Vote'}</button>` : `<button class="btn" disabled>${self ? 'You' : 'Not in this vote'}</button>`}
        </article>`;
    }).join('');
    $('#voteFoot').innerHTML = `<span>${v.votedIds.length} of ${state.players.length} voted${v.anonymous ? ' · anonymous' : ''}</span><span class="res-hint">Tap a cover to listen</span>`;
    tickVoteTimer();
    markPlaying();
  }

  function tickVoteTimer() {
    const v = state && state.vote;
    const fill = $('#voteFill');
    const text = $('#voteText');
    if (!v || !fill || !text) return;
    if (!v.votingTime) {
      fill.style.width = '100%';
      text.textContent = 'No time limit';
      return;
    }
    const left = Number.isFinite(v.timeLeft) ? v.timeLeft : v.votingTime;
    fill.style.width = `${Math.max(0, Math.min(100, (left / v.votingTime) * 100))}%`;
    fill.classList.toggle('urgent', left <= 5);
    text.textContent = `${Math.max(0, left)} s left`;
  }

  // ---------- spy guess (only if the server's guess phase is turned on) ----------
  function updateGuess() {
    const g = state.guess;
    const main = $('#guessMain');
    if (!g || !main) return;
    if (g.isMe && g.mode === 'spy' && !g.sent) {
      main.innerHTML = `<h1 class="src-title">Guess the theme</h1><p>You were caught. Name the theme to steal the win.</p>
        <div class="opts">${g.options.map((o) => `<button class="btn big" data-act="guess" data-id="${esc(o.id)}">${esc(o.text)}</button>`).join('')}</div>
        <p id="guessTimer" class="timer-text">${g.timeLeft || ''} s</p>`;
    } else {
      main.innerHTML = `<h1 class="src-title">${esc(g.accusedNames.join(', ') || 'The accused')}</h1><p class="wait">Guessing the theme</p><p id="guessTimer" class="timer-text">${g.timeLeft || ''} s</p>`;
    }
  }

  // ---------- results ----------
  function updateResults() {
    const r = state.result;
    const main = $('#resultsMain');
    if (!r || !main) return;
    const b = r.breakdown || {};
    const players = r.players || state.players;
    const pname = (id) => (players.find((p) => p.id === id) || {}).name || 'Player';
    const iAmSpy = (r.spies || []).includes(state.meId);
    const iWon = iAmSpy ? !r.civiliansWin : r.civiliansWin;
    const spyNames = (r.spyNames || []).join(', ') || r.spyName || 'the spy';
    const suspected = b.suspectedNames || (r.suspected || []).map(pname);
    let story;
    if (r.caughtSpy) story = `The vote caught <b>${esc(spyNames)}</b>.`;
    else if (suspected.length) story = `The vote went to <b>${esc(suspected.join(', '))}</b>, but the spy was <b>${esc(spyNames)}</b>.`;
    else story = `Nobody was voted out. The spy was <b>${esc(spyNames)}</b>.`;
    if (r.spyGuess && !r.spyGuess.skipped && r.spyGuess.text) story += ` The spy guessed “${esc(r.spyGuess.text)}”${r.spyGuess.correct ? ' and was right' : ''}.`;

    const votes = (b.voteDetails || []).map((d) => `<span>${esc(d.voterName)} → <b>${esc(d.targetName)}</b></span>`).join('');
    const boards = players.map((p) => {
      const list = tracksOf(p.id, r.trackHistory);
      const spy = (r.spies || []).includes(p.id);
      return `
        <article class="board">
          <h2>${MS.avatar(p, 'sm')}${esc(p.name)}${spy ? ' <span class="tag solid">spy</span>' : ''}${p.id === state.meId ? ' <small>you</small>' : ''}</h2>
          <div class="row"><span class="row-label">Tracks</span><ol style="--n:${Math.max(1, list.length)}">${list.length ? list.map((t) => `<li>${thumbsHtml([t]).replace(/^<li>|<\/li>$/g, '')}<span>${esc(t.title || 'Link')}</span></li>`).join('') : '<li><span>No tracks</span></li>'}</ol></div>
        </article>`;
    }).join('');

    const comments = (state.finalComments || []).map((c) => `<p><b>${esc(c.playerName)}:</b> ${esc(c.text)}</p>`).join('');
    const mineComment = (state.finalComments || []).find((c) => c.playerId === state.meId);

    main.innerHTML = `
      <section class="res-hero spy-verdict">
        <div>
          <p class="src-kind">Results · ${iWon ? 'you won' : 'you lost'}</p>
          <div class="verdict-row"><h1>${r.civiliansWin ? 'Civilians win' : (r.spies || []).length > 1 ? 'The spies win' : 'The spy wins'}</h1><span class="stamp ${r.civiliansWin ? 'ok' : ''}">case closed</span></div>
          <p>${story}</p>
          <dl class="facts">
            <div><span>Theme</span><b>${esc(r.theme || '')}</b></div>
            <div><span>${(r.spies || []).length > 1 ? 'Spies' : 'Spy'}</span><b>${esc(spyNames)}</b></div>
            ${votes ? `<div><span>Votes</span><div class="votes-line">${votes}</div></div>` : ''}
          </dl>
        </div>
        <form class="comment-form" data-form="comment"><input maxlength="90" placeholder="${mineComment ? 'Change your line about the game' : 'One line about the game'}" aria-label="Comment"><button class="btn">Post</button></form>
        ${comments ? `<div class="comments">${comments}</div>` : ''}
        <div class="res-actions">
          ${state.isHost ? '<button class="btn primary" data-act="restart">Back to the lobby</button>' : '<p class="wait">The host starts the next round</p>'}
          <button class="btn quiet" data-act="leaveRoom">Leave room</button>
        </div>
      </section>
      <section class="res-boards ${players.length > 3 ? 'many' : ''}">${boards}<p class="res-hint">Tap a cover to listen</p></section>`;
    markPlaying();
  }

  function markPlaying() {
    const pk = MS.audio.previewKey;
    if (pk) $$(`.listen[data-key="${CSS.escape(pk)}"]`).forEach((x) => x.classList.add('on'));
  }

  // ---------- controller ----------
  const C = {
    mode: 'spy',
    label: 'Spy',
    get code() { return session && session.code; },
    get isHost() { return Boolean(state && state.isHost); },
    get inLobby() { return Boolean(state && state.phase === 'lobby'); },
    session: () => (session ? { mode: 'spy', code: session.code } : null),

    async create(name) {
      const r = await MS.emit('createLobby', { name, reconnectToken: reconnectToken(), settings: PRESETS.classic });
      if (!r || !r.code) return { error: (r && r.error) || 'Could not create the room' };
      start(r.code);
      return { ok: true, code: r.code };
    },
    async join(code, name) {
      let r = await MS.emit('joinLobby', { code, name, reconnectToken: reconnectToken() });
      if (!MS.okOf(r)) {
        // a game in progress: maybe this is us coming back
        const back = await MS.emit('reconnectGame', { code, reconnectToken: reconnectToken() });
        if (!MS.okOf(back)) return r;
        r = back;
      }
      start(r.code || code);
      return { ok: true };
    },
    async reconnect() {
      if (!session) return { error: 'No room' };
      const code = session.code;
      let r = await MS.emit('reconnectGame', { code, reconnectToken: reconnectToken() });
      if (!MS.okOf(r)) r = await MS.emit('joinLobby', { code, name: MS.account.displayName() || 'Guest', reconnectToken: reconnectToken() });
      if (!MS.okOf(r)) MS.app.dropRoom(r.network ? null : (r.error || 'The room is closed'));
      return r;
    },
    async leave() {
      if (!session) return;
      const code = session.code;
      const playing = state && ['playing', 'voting', 'spyGuess'].includes(state.phase);
      if (playing) {
        // The server keeps a seat for a minute during a game; dropping the socket frees it.
        stop();
        MS.socket.disconnect();
        setTimeout(() => MS.socket.connect(), 50);
        return;
      }
      await MS.emit('leaveLobby', { code });
      stop();
    },
    destroy: () => stop(),
    onAct(act, el) {
      const v = el.dataset.v;
      switch (act) {
        case 'preset':
          call('updateSettings', { settings: PRESETS[v] });
          break;
        case 'set': {
          const [k, raw] = v.split(':');
          const value = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
          call('updateSettings', { settings: { [k]: value } });
          break;
        }
        case 'spies':
          call('updateSettings', { settings: v === 'auto' ? { spyMode: 'auto' } : { spyMode: 'manual', spyCount: Number(v) } });
          break;
        case 'ready': {
          const mine = me();
          call('setReady', { ready: !(mine && mine.ready) });
          break;
        }
        case 'start':
          MS.audio.unlock();
          call('startGame');
          break;
        case 'forceStart':
          MS.audio.unlock();
          call('forceStartGame');
          break;
        case 'kick':
          if (confirm('Remove this player from the room?')) call('hostKickPlayer', { playerId: el.dataset.id });
          break;
        case 'openTrackPicker': openTrackPicker(); break;
        case 'react': call('trackReaction', { reaction: v }); break;
        case 'skip': call('skipTrackVote'); break;
        case 'pause': call('hostTogglePause'); break;
        case 'time': call('hostAdjustTimer', { delta: Number(v) }); break;
        case 'skipTurn':
          if (confirm(`Skip ${nameOf(state.currentPlayerId, 'this player')}'s turn?`)) call('hostSkipTurn');
          break;
        case 'startVote':
          if (confirm('Stop the turns and start the vote now?')) call('hostStartVoting');
          break;
        case 'vote': call('vote', { target: el.dataset.id }); break;
        case 'guess': call('submitSpyGuess', { optionId: el.dataset.id }); break;
        case 'preview': MS.audio.preview(el.dataset.src, el.dataset.key, el); break;
        case 'restart': MS.audio.stop(); call('restartLobby'); break;
        default: break;
      }
    },
    onSubmit(form) {
      if (form.dataset.form !== 'comment') return false;
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return true;
      call('finalComment:send', { text }).then((r) => { if (MS.okOf(r)) input.value = ''; });
      return true;
    },
    onKey() {},
  };

  function start(code) {
    session = { code: MS.normCode(code) };
    state = null;
    screenKey = '';
    prevPhase = null;
    MS.app.roomStarted(C);
    app().innerHTML = '<div class="center-screen"><div class="spinner"></div><p>Connecting to the room</p></div>';
    if (pending && pending.code === session.code) {
      state = pending;
      MS.setServerNow(state.serverNow);
      render();
    }
    pending = null;
  }

  function stop() {
    pending = null;
    session = null;
    state = null;
    screenKey = '';
    MS.sheet.close('trackPicker', true);
    $$('.role-overlay').forEach((el) => el.remove());
  }

  MS.modes = MS.modes || {};
  MS.modes.spy = C;
})();
