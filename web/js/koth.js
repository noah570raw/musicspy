'use strict';
// King of the Hill mode: lobby, duels and results. The server sends the whole room as this player sees it
// (koth:state) and we re-render from it. Listening is local: each player switches between the two tracks
// of a duel on their own (the spot in each track is kept when you switch back).
(() => {
  const MS = window.MS;
  const { $, $$, esc } = MS;
  const tracksWord = (n) => MS.count(n, 'track');

  let state = null;
  let session = null; // { code, pid, token }
  let skeletonKey = '';
  let duelKey = '';
  let timerInterval = null;
  let picking = false;
  const listen = { key: '', side: null, pos: { a: 0, b: 0 }, auto: false, autoTimer: null, staleFor: '' };
  const ui = { bracketOf: null };

  const app = () => $('#app');
  const serverNow = () => MS.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const touch = () => matchMedia('(hover: none)').matches;
  const listenHint = () => (touch() ? 'Tap a cover to listen, then pick the better one.' : 'Listen to both and pick the better one. Space switches the track.');
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5l4.6 4.2L12 4.5l4.4 7.2L21 7.5 19.2 19H4.8z" fill="currentColor"/></svg>';
  MS.icon.crown = CROWN;

  async function act(type, payload) {
    const r = await MS.emit('koth:action', { type, payload });
    if (!MS.okOf(r) && r.error) MS.toast(r.error);
    return r;
  }

  MS.socket.on('koth:state', (msg) => {
    if (!session || !msg || !msg.state || msg.state.code !== session.code) return;
    MS.setServerNow(msg.now);
    state = msg.state;
    render();
  });
  MS.socket.on('koth:kicked', () => {
    if (!session || C.leaving) return;
    MS.app.dropRoom('You are no longer in this room');
  });

  // ---------- bracket helpers ----------
  function roundName(n) {
    if (n <= 2) return 'Final';
    if (n <= 4) return 'Semifinals';
    if (n <= 8) return 'Quarterfinals';
    if (n <= 16) return 'Round of 16';
    return 'Round of 32';
  }
  const SHORT = { Final: 'Final', Semifinals: 'SF', Quarterfinals: 'QF', 'Round of 16': 'R16', 'Round of 32': 'R32' };
  function plannedRounds(size) {
    const out = [];
    for (let n = size; n >= 2; n /= 2) out.push(roundName(n));
    return out;
  }
  const trackTitle = (t) => (t ? t.title : '');
  const quote = (t) => `“${trackTitle(t)}”`;
  const nameOf = (pid) => {
    const g = state && state.game;
    const p = (g && g.roster.find((x) => x.id === pid)) || (state && state.players.find((x) => x.id === pid));
    return p ? p.name : 'Someone';
  };
  const listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  // The duel this player is looking at right now (vote: the room's; solo: their own), or null.
  function currentDuel() {
    const g = state && state.game;
    if (!g || state.phase !== 'playing') return null;
    if (g.style === 'solo') {
      const mine = g.mine;
      if (!mine || mine.done) return null;
      const round = mine.rounds[mine.ri];
      const m = round.matches[mine.mi];
      return { g, round, ri: mine.ri, mi: mine.mi, m, ta: g.tracks[m.a], tb: g.tracks[m.b], key: `s:${mine.ri}:${mine.mi}:${m.a}:${m.b}`, ready: true };
    }
    const round = g.rounds[g.ri];
    if (!round) return null;
    const m = round.matches[g.mi];
    return { g, round, ri: g.ri, mi: g.mi, m, ta: g.tracks[m.a], tb: g.tracks[m.b], key: `v:${g.ri}:${g.mi}:${m.a}:${m.b}`, ready: g.phase !== 'loading' };
  }

  function viewName() {
    if (state.phase === 'loading') return state.game ? 'results' : 'lobby';
    return state.phase;
  }

  function backdropForState() {
    const g = state.game;
    const view = viewName();
    if (view === 'playing' && g) {
      const d = currentDuel();
      if (d) return ((listen.side === 'b' ? d.tb : d.ta) || {}).cover || g.source.cover;
      if (g.mine && g.mine.champion !== null) return g.tracks[g.mine.champion].cover;
      return g.source.cover;
    }
    if (view === 'results' && g) {
      const kings = champions(g);
      return kings.length ? g.tracks[kings[0]].cover : g.source.cover;
    }
    return state.source ? state.source.cover : '';
  }

  function champions(g) {
    if (g.style === 'solo') {
      const me = g.progress[state.meId];
      return me && me.champion !== null && me.champion !== undefined ? [me.champion] : [];
    }
    return g.champions || [];
  }

  // ---------- render ----------
  function render() {
    if (!state || !session) return;
    const view = viewName();
    const g = state.game;
    let sub = '';
    // solo style: once my bracket is done (or if I am only watching) I see the waiting screen
    if (view === 'playing' && g) sub = g.style === 'solo' && (!g.mine || g.mine.done) ? 'wait' : g.style;
    if (view === 'results' && g) sub = g.style;
    const key = `${view}|${sub}|${state.isHost ? 'h' : 'g'}`;
    if (key !== skeletonKey) {
      skeletonKey = key;
      duelKey = '';
      buildSkeleton(view, sub);
    }
    updateTopbar();
    if (view === 'lobby') updateLobby();
    else if (view === 'playing') {
      if (sub === 'wait') updateWait();
      else updateDuel();
    } else if (view === 'results') updateResults();
    syncListening();
    MS.setBackdrop(backdropForState());
    MS.music.setContext(state.phase === 'lobby' ? 'lobby' : 'game');
    MS.chat.setSource({
      roomKey: `koth:${state.code}`,
      messages: state.chat || [],
      meId: state.meId,
      players: state.players,
      send: (text) => act('chat', { text }),
    });
    if (MS.sheet.isOpen('kothBracket')) renderBracketSheet();
  }

  function topbar(center = '', inGame = false) {
    return `
      <header class="bar">
        <span class="bar-brand"><span class="koth-brand">${CROWN}King of the Hill</span><small>MusicSpy</small></span>
        <div class="bar-center">${center}</div>
        <div class="bar-actions">
          ${MS.volumeControl()}
          ${inGame ? '<button class="room-btn" data-act="copyLink" title="Copy the invite link"><span data-code></span></button>' : ''}
          ${inGame ? '<button class="leave-btn" data-act="bracket">Bracket</button>' : ''}
          ${MS.chat.buttonHtml()}
          ${inGame && state.isHost && state.phase === 'playing' ? '<button class="leave-btn" data-act="abort">End game</button>' : ''}
          <button class="leave-btn" data-act="leaveRoom">Leave</button>
        </div>
      </header>`;
  }

  function buildSkeleton(view, sub) {
    if (view === 'lobby') {
      app().innerHTML = `
        <div class="screen">
          ${topbar()}
          <main class="lobby">
            <div class="lob-main">
              <div id="lobCover" class="lob-cover"></div>
              <div class="lob-side">
                <div id="lobSource" class="lob-source"></div>
                <div id="settingsBox" class="settings"></div>
                <div id="startBox" class="start"></div>
              </div>
            </div>
            <footer class="lob-foot">
              <div class="room-info"><span>Room</span><b data-code></b>
                <button class="btn small" data-act="copyLink">${MS.icon.link}Copy invite link</button>
                <button class="btn small quiet" data-act="openFriends">Invite friends</button>
                ${state.isHost ? `<button class="btn small quiet" data-act="switchGame">${MS.icon.swap}Switch game</button>` : ''}
                <span id="openBox"></span>
              </div>
              <ul id="playerList" class="people"></ul>
            </footer>
          </main>
        </div>`;
    } else if (view === 'playing' && sub === 'wait') {
      app().innerHTML = `
        <div class="screen">
          ${topbar('<ul id="faces" class="faces"></ul>', true)}
          <main class="koth-wait"><div id="waitBox" class="wait-box stage"></div></main>
        </div>`;
    } else if (view === 'playing') {
      app().innerHTML = `
        <div class="screen">
          ${topbar('<ul id="faces" class="faces"></ul>', true)}
          <main class="koth-game">
            <div class="duel-head stage"><ol id="road" class="road"></ol><p id="duelPos" class="duel-pos">&nbsp;</p></div>
            <div class="duel">
              <article id="cardA" class="duel-card" data-side="a"></article>
              <div class="vs" aria-hidden="true">vs</div>
              <article id="cardB" class="duel-card" data-side="b"></article>
            </div>
            <div class="duel-foot">
              <div class="progress"><div class="progress-line"><i id="timerFill"></i></div><span id="timerText" class="timer-text">&nbsp;</span></div>
              <div id="duelNote" class="duel-note"></div>
            </div>
          </main>
        </div>`;
    } else {
      app().innerHTML = `<div class="screen">${topbar('', true)}<main id="resultsMain" class="results koth-results"></main></div>`;
    }
    MS.ui.build($('.screen'));
  }

  function updateTopbar() {
    $$('[data-code]').forEach((el) => { el.textContent = state.code; });
    document.title = `King of the Hill · ${state.code}`;
  }

  // ---------- music picker (picker.js) ----------
  function openPicker() {
    MS.picker.open({
      current: () => ({
        selected: state && state.source ? `${state.source.type}:${state.source.id}` : '',
        loadingId: state && state.sourceLoading ? state.sourceLoading.id : '',
      }),
      hints: {
        album: 'The bracket is dealt from random tracks of the album.',
        artist: 'Tracks come from every album, EP and single of the artist, without repeats.',
      },
      onPick: async (type, id) => MS.okOf(await act('setSource', { type, id })),
    });
  }

  // ---------- lobby ----------
  function updateLobby() {
    const online = state.players.filter((p) => p.connected).length;
    const host = state.isHost;
    const s = state.settings;
    const src = state.source;

    $('#playerList').innerHTML = state.players.map((p) => {
      const fx = MS.cos.lobbyAttrs(p);
      return `
      <li class="${p.connected ? '' : 'away'} ${fx.cls}" style="${fx.style}" title="${p.connected ? '' : 'offline'}">
        ${MS.cos.who(p, p.id === state.meId ? ' (you)' : '')}${p.id === state.hostId ? '<small>host</small>' : ''}
        ${host && p.id !== state.meId ? `<button class="kick" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`;
    }).join('') + (state.players.length < 2 ? '<li class="lonely">Send a friend the link and they show up here</li>' : '');

    const openBox = $('#openBox');
    if (openBox) {
      openBox.innerHTML = host
        ? `<button class="btn small quiet open-toggle ${state.isOpen ? 'on' : ''}" data-act="toggleOpen" aria-pressed="${state.isOpen ? 'true' : 'false'}" title="Open rooms show up on everyone's home screen"><i></i>${state.isOpen ? 'Open room' : 'Private room'}</button>`
        : (state.isOpen ? '<span class="tag">Open room</span>' : '');
    }
    const cover = $('#lobCover');
    const coverKey = state.sourceLoading ? 'loading' : src ? `${src.type}:${src.id}` : `empty:${host}`;
    if (cover.dataset.key !== coverKey) {
      cover.dataset.key = coverKey;
      if (state.sourceLoading) cover.innerHTML = '<div class="cover-ph"><div class="spinner"></div></div>';
      else if (src) cover.innerHTML = `<img class="${src.type === 'artist' ? 'round' : ''}" src="${esc(src.cover)}" alt="">`;
      else if (host) cover.innerHTML = '<button class="cover-ph" data-act="openPicker"><span>+</span>Pick the music</button>';
      else cover.innerHTML = '<div class="cover-ph"><span>?</span>The host is picking the music</div>';
    }

    const lobSource = $('#lobSource');
    if (state.sourceLoading) {
      lobSource.innerHTML = '<h1 class="src-title">Collecting tracks</h1><p class="src-sub">A discography takes a few seconds</p>';
    } else if (src) {
      lobSource.innerHTML = `
        <p class="src-kind">${src.type === 'artist' ? 'Whole discography' : 'Album'}</p>
        <h1 class="src-title">${esc(src.title)}</h1>
        <p class="src-sub">${src.type === 'artist' ? '' : `${esc(src.subtitle)}, `}${tracksWord(src.poolSize)} with previews</p>
        ${host ? '<button class="text-btn" data-act="openPicker">Change the music</button>' : ''}`;
    } else {
      lobSource.innerHTML = `
        <p class="src-kind">King of the Hill</p>
        <h1 class="src-title">Pick an album</h1>
        <p class="src-sub">${host ? 'Choose an album or a whole discography. Its tracks fight in pairs until one is left.' : 'The host is picking the music. The cover shows up here.'}</p>`;
    }

    const dis = host ? '' : 'disabled';
    const sizes = state.limits.allSizes.map((n) => {
      const allowed = state.limits.sizes.includes(n);
      return `<button class="opt ${s.size === n ? 'active' : ''}" data-act="size" data-v="${n}" ${!allowed || !host ? 'disabled' : ''} title="${allowed ? `${n} tracks, ${n - 1} duels` : 'The music has fewer tracks'}">${n}</button>`;
    }).join('');
    const timers = state.limits.timers.map((t) => `<button class="opt ${s.timer === t ? 'active' : ''}" data-act="timer" data-v="${t}" ${dis} title="${t ? `${t} seconds per duel` : 'Each duel waits until everyone votes'}">${t ? `${t}s` : '∞'}</button>`).join('');
    const vote = s.style === 'vote';
    $('#settingsBox').innerHTML = `
      <div class="set-row"><span class="set-name">Bracket</span><div class="opts">${sizes}</div></div>
      <div class="set-row"><span class="set-name">Style</span><div class="opts">
        <button class="opt wide ${vote ? 'active' : ''}" data-act="style" data-v="vote" ${dis}>vote together</button>
        <button class="opt wide ${!vote ? 'active' : ''}" data-act="style" data-v="solo" ${dis}>everyone solo</button>
      </div></div>
      <p class="set-hint">${vote ? 'One bracket for the room. The majority wins each duel. On a tie you agree to a draw or concede.' : 'Everyone runs their own bracket at their own pace. Your kings are compared at the end.'}</p>
      ${vote ? `<div class="set-row"><span class="set-name">Time per duel</span><div class="opts">${timers}</div></div>` : ''}`;

    const sbox = $('#startBox');
    if (host) {
      const loading = state.phase === 'loading';
      const can = src && !state.sourceLoading && !loading;
      sbox.innerHTML = `
        <button class="btn primary big" data-act="start" ${can ? '' : 'disabled'}>${loading ? 'Loading tracks' : `Start: ${s.size} tracks, ${s.size - 1} duels`}</button>
        <p class="start-note">${!src ? 'Pick the music first' : online < 2 ? 'You can play alone, but it is better with a friend' : `${MS.count(online, 'player')} in the room`}</p>`;
    } else {
      sbox.innerHTML = `<p class="wait">${state.phase === 'loading' ? 'Loading tracks' : 'Waiting for the host to start'}</p>`;
    }
  }

  // ---------- duel ----------
  function cardHtml(t, side, d) {
    const album = t.album && d.g.source.type === 'artist' ? `, ${esc(t.album)}` : '';
    return `
      <button class="duel-cover listen" data-act="listen" data-v="${side}" aria-label="Listen to ${esc(t.title)}">
        <img src="${esc(t.cover)}" alt="">
        <span class="duel-play">${MS.playThumbSvg}</span>
        <span class="duel-eq eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="duel-badge"></span>
      </button>
      <div class="duel-meta">
        <h2 class="duel-title">${esc(t.title)}${t.version ? ` <span>${esc(t.version)}</span>` : ''}</h2>
        <p class="duel-artist">${esc(t.artist)}${album}</p>
      </div>
      <button class="pick duel-pick" data-act="vote" data-v="${side}"><span class="pick-label"><span class="pick-text">Pick</span><kbd>${side === 'a' ? '←' : '→'}</kbd></span></button>
      <ul class="duel-voters"></ul>`;
  }

  function revealHeadline(d) {
    const { m, g } = d;
    const winner = m.winners && m.winners.length === 1 ? g.tracks[m.winners[0]] : null;
    const t = m.tally || { a: 0, b: 0 };
    const final = d.round.size === 2;
    if (m.how === 'draw') return final ? 'A draw in the final. Two kings share the hill' : 'Draw. Both tracks go through';
    if (m.how === 'concede') return `${esc(nameOf(m.concededBy))} conceded. ${esc(quote(winner))} goes through`;
    if (m.how === 'coin') return t.a || t.b ? `Still a tie. A coin flip sends ${esc(quote(winner))} through` : `No votes. A coin flip sends ${esc(quote(winner))} through`;
    const hi = Math.max(t.a, t.b);
    const lo = Math.min(t.a, t.b);
    return `${esc(quote(winner))} wins ${hi} to ${lo}`;
  }

  function updateDuel() {
    const d = currentDuel();
    const g = state.game;
    if (!d) return;
    const { m, round } = d;
    const solo = g.style === 'solo';
    if (d.key !== duelKey) {
      duelKey = d.key;
      $('#cardA').innerHTML = cardHtml(d.ta, 'a', d);
      $('#cardB').innerHTML = cardHtml(d.tb, 'b', d);
      ['#cardA', '#cardB'].forEach((sel) => {
        const c = $(sel);
        c.classList.remove('enter', 'win', 'lose', 'voted');
        void c.offsetWidth;
        c.classList.add('enter');
      });
    }

    // road: the rounds of the bracket, the current one lit
    const names = plannedRounds(g.size);
    const at = names.indexOf(round.name);
    $('#road').innerHTML = names.map((n, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${esc(SHORT[n] || n)}</li>`).join('') + `<li class="king-step ${state.phase === 'results' ? 'now' : ''}">${CROWN}</li>`;
    const bye = round.bye !== null && round.bye !== undefined ? ` · ${esc(trackTitle(g.tracks[round.bye]))} sits this round out` : '';
    $('#duelPos').innerHTML = `${solo ? 'Your bracket · ' : ''}<b>${esc(round.name)}</b> · duel ${d.mi + 1} of ${round.matches.length}${bye}`;

    const reveal = !solo && g.phase === 'reveal';
    const tie = !solo && g.phase === 'tie';
    const votes = m.votes || {};
    const myVote = votes[state.meId] || null;
    const canVote = g.isParticipant && (solo ? !picking : g.phase === 'voting');
    for (const side of ['a', 'b']) {
      const card = $(side === 'a' ? '#cardA' : '#cardB');
      const idx = m[side];
      const won = reveal && m.winners && m.winners.includes(idx);
      const lost = reveal && m.winners && !m.winners.includes(idx);
      if (!picking) {
        card.classList.toggle('win', Boolean(won));
        card.classList.toggle('lose', Boolean(lost));
      }
      card.classList.toggle('voted', !solo && myVote === side);
      const btn = card.querySelector('.duel-pick');
      btn.disabled = !canVote;
      btn.hidden = !g.isParticipant;
      btn.classList.toggle('picked', !solo && myVote === side);
      btn.querySelector('.pick-text').textContent = !solo && myVote === side ? 'Your pick' : 'Pick';
      const badge = card.querySelector('.duel-badge');
      badge.innerHTML = won ? `${CROWN}${m.winners.length > 1 ? 'Through' : 'Wins'}` : '';
      const voters = (reveal || tie) ? g.roster.filter((p) => votes[p.id] === side) : [];
      card.querySelector('.duel-voters').innerHTML = voters.map((p) => `<li title="${esc(p.name)}">${MS.avatar(p, 'sm')}</li>`).join('');
    }

    const note = $('#duelNote');
    if (!g.isParticipant) {
      note.innerHTML = '<p class="choice-note">You are watching this game. You can play from the next one.</p>';
    } else if (solo) {
      note.innerHTML = `<p class="choice-note">${listenHint()}</p>`;
    } else if (g.phase === 'loading') {
      note.innerHTML = '<p class="choice-note">Loading the duel</p>';
    } else if (g.phase === 'voting') {
      note.innerHTML = `<p class="choice-note">${myVote ? `You picked ${esc(quote(myVote === 'a' ? d.ta : d.tb))}. You can change it until everyone votes` : listenHint()}</p>`;
    } else if (tie) {
      note.innerHTML = tieHtml(d);
    } else if (reveal) {
      note.innerHTML = `<div class="reveal">${revealHeadline(d)}</div>`;
    }

    updateFaces();
  }

  function tieHtml(d) {
    const { g, m } = d;
    const t = { a: 0, b: 0 };
    for (const v of Object.values(m.votes || {})) t[v] += 1;
    const tieState = g.tie || { voters: [], answers: {} };
    const mine = tieState.voters.includes(state.meId);
    const answered = tieState.answers[state.meId];
    const myVote = (m.votes || {})[state.meId];
    const theirs = myVote ? (myVote === 'a' ? d.tb : d.ta) : null;
    const agreed = tieState.voters.filter((id) => tieState.answers[id] === 'draw').map(nameOf);
    const waiting = tieState.voters.filter((id) => !tieState.answers[id]).map(nameOf);
    let status = '';
    if (agreed.length) status += `${esc(listNames(agreed))} agreed to a draw. `;
    if (waiting.length) status += `Waiting for ${esc(listNames(waiting))}`;
    const actions = mine && !answered
      ? `<div class="tie-actions">
          <button class="btn" data-act="tie" data-v="draw">Agree to a draw</button>
          <button class="btn quiet" data-act="tie" data-v="concede">Concede to ${esc(quote(theirs))}</button>
        </div>`
      : '';
    const lead = mine
      ? (answered ? 'You agreed to a draw.' : 'Agree to a draw and both tracks go through, or concede and give the win to the other track. Silence counts as a draw.')
      : 'The players who voted decide: a draw, or one of them concedes.';
    return `<div class="tie-box"><b>Tie, ${t.a} to ${t.b}</b><p>${lead}</p>${actions}<p class="tie-status">${status}</p></div>`;
  }

  function updateFaces() {
    const faces = $('#faces');
    if (!faces) return;
    const g = state.game;
    const roster = g.roster;
    const online = new Map(state.players.map((p) => [p.id, p.connected]));
    faces.classList.toggle('many', roster.length > 4);
    let m = null;
    if (g.style !== 'solo' && g.rounds && g.rounds[g.ri]) m = g.rounds[g.ri].matches[g.mi];
    faces.innerHTML = roster.map((p) => {
      let status = 'listening';
      let cls = 'thinking';
      if (g.style === 'solo') {
        const pr = g.progress[p.id];
        if (pr && pr.done) { status = 'done'; cls = 'done'; } else if (pr) status = `${SHORT[pr.round] || pr.round} ${pr.match + 1}/${pr.matches}`;
      } else if (g.phase === 'voting') {
        if (g.decided.includes(p.id)) { status = 'voted'; cls = 'done'; }
      } else if (g.phase === 'tie' && g.tie) {
        if (!g.tie.voters.includes(p.id)) { status = 'no vote'; cls = ''; } else if (g.tie.answers[p.id]) { status = 'draw'; cls = 'done'; } else status = 'deciding';
      } else if (g.phase === 'reveal' && m) {
        const v = m.votes && m.votes[p.id];
        status = m.concededBy === p.id ? 'conceded' : v ? `picked ${v.toUpperCase()}` : 'no vote';
        cls = v ? 'done' : '';
      }
      const away = online.get(p.id) === false || !online.has(p.id);
      const live = state.players.find((x) => x.id === p.id) || p;
      return `<li class="${cls} ${away ? 'away' : ''}" title="${esc(p.name)}: ${away ? 'offline' : status}">${MS.avatar(live, 'sm')}<span class="face-text"><b>${MS.cos.nick(p.name, live)}</b><small>${away ? 'offline' : esc(status)}</small></span></li>`;
    }).join('');
  }

  // solo style: my bracket is done, the others are still picking
  function updateWait() {
    const g = state.game;
    const mine = g.mine;
    const king = mine && mine.champion !== null ? g.tracks[mine.champion] : null;
    const left = g.roster.filter((p) => g.progress[p.id] && !g.progress[p.id].done);
    $('#waitBox').innerHTML = `
      <p class="src-kind koth-kicker">${CROWN}${king ? 'Your king' : 'You are watching this game'}</p>
      ${king ? `<img class="wait-cover" src="${esc(king.cover)}" alt="">
      <h1 class="track-title">${esc(king.title)}</h1><p class="track-artist">${esc(king.artist)}</p>` : ''}
      <p class="wait">${left.length ? `Waiting for ${esc(listNames(left.map((p) => p.name)))}` : 'Counting the kings'}</p>
      <div class="res-actions">
        ${state.isHost && left.length ? '<button class="btn" data-act="finishNow">Show results now</button>' : ''}
        ${mine ? '<button class="btn quiet" data-act="bracket">Your bracket</button>' : ''}
      </div>`;
    updateFaces();
  }

  function tickTimer() {
    if (!state || state.phase !== 'playing' || !state.game) return;
    const g = state.game;
    const fill = $('#timerFill');
    const text = $('#timerText');
    if (!fill || !text) return;
    const now = serverNow();
    let pct = 0;
    let label = '';
    fill.classList.remove('urgent', 'after');
    if (g.style === 'solo') {
      const picks = g.mine ? g.mine.rounds.reduce((n, r) => n + r.matches.filter((m) => m.winners).length, 0) : 0;
      pct = (picks / (g.size - 1)) * 100;
      fill.classList.add('after');
      label = now < g.startsAt ? `Starts in ${Math.ceil((g.startsAt - now) / 1000)}` : `${picks} of ${g.size - 1} duels`;
    } else if (g.phase === 'loading') label = 'Loading the duel';
    else if (g.phase === 'voting') {
      if (now < g.startsAt) {
        label = `Starts in ${Math.ceil((g.startsAt - now) / 1000)}`;
        pct = 100;
      } else if (g.endsAt) {
        const left = Math.max(0, g.endsAt - now);
        pct = (left / (g.endsAt - g.startsAt)) * 100;
        label = `${Math.ceil(left / 1000)} s`;
        if (left < 5000) fill.classList.add('urgent');
      } else {
        pct = 100;
        label = 'No time limit';
      }
    } else if (g.phase === 'tie' && g.phaseEndsAt) {
      const left = Math.max(0, g.phaseEndsAt - now);
      pct = (left / state.limits.tieMs) * 100;
      fill.classList.add('urgent');
      label = `${Math.ceil(left / 1000)} s to settle the tie`;
    } else if (g.phase === 'reveal' && g.phaseEndsAt) {
      const left = Math.max(0, g.phaseEndsAt - now);
      pct = 100 - (left / state.limits.revealMs) * 100;
      fill.classList.add('after');
      const round = g.rounds[g.ri];
      const lastMatch = round && g.mi + 1 >= round.matches.length;
      label = lastMatch && round.size === 2 ? 'The king is next' : `Next duel in ${Math.ceil(left / 1000)}`;
    }
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (text.textContent !== label) text.textContent = label || ' ';
  }

  // ---------- listening (local, per player) ----------
  const audioKey = (side) => `koth:${listen.key}:${side}`;

  function syncListening() {
    const d = currentDuel();
    if (!d) {
      if (listen.key) stopListening();
      return;
    }
    if (d.key !== listen.key) {
      stopListening();
      listen.key = d.key;
      listen.pos = { a: 0, b: 0 };
      listen.auto = false;
    }
    if (!listen.auto && d.ready) {
      listen.auto = true;
      const key = d.key;
      const delay = Math.max(0, (state.game.startsAt || 0) - serverNow());
      clearTimeout(listen.autoTimer);
      listen.autoTimer = setTimeout(() => { if (listen.key === key && !listen.side) play('a'); }, delay);
    }
    markListening();
  }

  function stopListening() {
    clearTimeout(listen.autoTimer);
    if (MS.audio.previewKey.startsWith('koth:')) MS.audio.stop();
    listen.key = '';
    listen.side = null;
  }

  function play(side) {
    const d = currentDuel();
    if (!d) return;
    const t = side === 'a' ? d.ta : d.tb;
    if (!t || !t.preview) return;
    const el = MS.audio.el;
    const k = audioKey(side);
    if (listen.side && MS.audio.previewKey === audioKey(listen.side)) listen.pos[listen.side] = el.currentTime || 0;
    if (listen.side === side && MS.audio.previewKey === k && !el.paused) {
      MS.audio.stop();
      markListening();
      return;
    }
    MS.audio.preview(t.preview, k, $(`.duel-cover[data-v="${side}"]`));
    listen.side = side;
    const pos = listen.pos[side];
    if (pos > 0.5) {
      const seek = () => {
        if (MS.audio.previewKey !== k) return;
        try { if (!el.duration || pos < el.duration - 1) el.currentTime = pos; } catch { /* ignore */ }
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
    }
    markListening();
    MS.setBackdrop(backdropForState());
  }

  function markListening() {
    const playing = !MS.audio.el.paused && MS.audio.previewKey.startsWith('koth:');
    for (const side of ['a', 'b']) {
      const card = $(side === 'a' ? '#cardA' : '#cardB');
      if (card) card.classList.toggle('listening', playing && MS.audio.previewKey === audioKey(side));
    }
  }
  ['play', 'pause', 'ended'].forEach((ev) => MS.audio.el.addEventListener(ev, () => { if (session) markListening(); }));
  // signed preview links expire: ask the server for a fresh one, then the next tap plays it
  MS.audio.el.addEventListener('error', () => {
    if (!session || !state || !state.game) return;
    const pk = MS.audio.previewKey;
    let idx = -1;
    if (pk.startsWith('koth:')) {
      const d = currentDuel();
      if (d) idx = pk.endsWith(':a') ? d.m.a : d.m.b;
    } else if (pk.startsWith('kothpreview:')) {
      idx = state.game.tracks.findIndex((t) => `kothpreview:${t.id}` === pk);
    }
    if (idx < 0 || listen.staleFor === pk) return;
    listen.staleFor = pk;
    act('stalePreview', { track: idx });
    MS.toast('Refreshing the preview. Tap again in a second');
  });

  async function vote(side) {
    const g = state && state.game;
    if (!g || state.phase !== 'playing' || !g.isParticipant || picking) return;
    if (g.style === 'solo') {
      if (!g.mine || g.mine.done || serverNow() < g.startsAt) return;
      picking = true;
      $(side === 'a' ? '#cardA' : '#cardB').classList.add('win');
      $(side === 'a' ? '#cardB' : '#cardA').classList.add('lose');
      $$('.duel-pick').forEach((b) => { b.disabled = true; });
      if (MS.sfx) MS.sfx.play('pick');
      await sleep(420);
      await act('vote', { side });
      picking = false;
      render();
      return;
    }
    if (g.phase !== 'voting') return;
    const m = g.rounds[g.ri].matches[g.mi];
    if (m.votes && m.votes[state.meId] === side) return;
    picking = true;
    if (MS.sfx) MS.sfx.play('pick');
    await act('vote', { side });
    picking = false;
    render();
  }

  // ---------- bracket view ----------
  function bracketHtml(g, rounds, opts = {}) {
    const vote = g.style !== 'solo';
    const cur = opts.current || null;
    const row = (idx, m, extra = '') => {
      const t = g.tracks[idx];
      const done = Boolean(m.winners);
      const won = done && m.winners.includes(idx);
      const count = vote && m.tally ? m.tally[idx === m.a ? 'a' : 'b'] : null;
      return `<div class="bk-row ${won ? 'win' : ''} ${done && !won ? 'lose' : ''}">
        <img src="${esc(t.cover)}" alt=""><span>${esc(t.title)}</span>${extra || (count !== null ? `<em>${count}</em>` : '')}</div>`;
    };
    const how = { draw: 'draw', concede: 'conceded', coin: 'coin flip' };
    const cols = rounds.map((r, ri) => {
      const items = r.matches.map((m, mi) => `
        <div class="bk-match ${cur && cur.ri === ri && cur.mi === mi ? 'current' : ''}">
          ${row(m.a, m)}${row(m.b, m)}
          ${how[m.how] ? `<small class="bk-how">${how[m.how]}</small>` : ''}
        </div>`);
      if (r.bye !== null && r.bye !== undefined) items.push(`<div class="bk-match bye">${row(r.bye, { winners: [r.bye] }, '<em>bye</em>')}</div>`);
      return `<section class="bk-col"><h3>${esc(r.name)}</h3><div class="bk-list">${items.join('')}</div></section>`;
    });
    // rounds that have not been drawn yet
    const last = rounds[rounds.length - 1];
    let left = last ? last.matches.length + (last.bye !== null && last.bye !== undefined ? 1 : 0) : g.size;
    if (opts.finished) left = 1;
    while (left >= 2) {
      const n = Math.floor(left / 2) + (left % 2);
      const slots = Array.from({ length: Math.floor(left / 2) }, () => '<div class="bk-match tbd"><div class="bk-row"><i></i><span></span></div><div class="bk-row"><i></i><span></span></div></div>');
      cols.push(`<section class="bk-col"><h3>${esc(roundName(left))}</h3><div class="bk-list">${slots.join('')}</div></section>`);
      left = n;
    }
    const kings = opts.kings || [];
    cols.push(`<section class="bk-col king-col"><h3>${CROWN}King</h3><div class="bk-list">${kings.length
      ? kings.map((i) => `<div class="bk-king"><img src="${esc(g.tracks[i].cover)}" alt=""><b>${esc(g.tracks[i].title)}</b></div>`).join('')
      : '<div class="bk-king tbd"><i></i><b>?</b></div>'}</div></section>`);
    return `<div class="bracket" style="--cols:${cols.length}">${cols.join('')}</div>`;
  }

  function bracketFor(g, pid) {
    if (g.style !== 'solo') {
      return bracketHtml(g, g.rounds, { current: state.phase === 'playing' ? { ri: g.ri, mi: g.mi } : null, kings: g.champions || [], finished: state.phase !== 'playing' && g.champions });
    }
    if (g.brackets && g.brackets[pid]) {
      const b = g.brackets[pid];
      return bracketHtml(g, b.rounds, { kings: b.champion !== null ? [b.champion] : [], finished: b.champion !== null });
    }
    if (pid === state.meId && g.mine) {
      return bracketHtml(g, g.mine.rounds, { current: g.mine.done ? null : { ri: g.mine.ri, mi: g.mine.mi }, kings: g.mine.champion !== null ? [g.mine.champion] : [], finished: g.mine.done });
    }
    return bracketHtml(g, [{ name: roundName(g.size), size: g.size, bye: null, matches: g.seed.map((m) => ({ ...m, winners: null })) }]);
  }

  function renderBracketSheet() {
    const el = MS.sheet.get('kothBracket');
    const g = state && state.game;
    if (!el || !g) return;
    const box = el.querySelector('#bkBox');
    const scroll = box.querySelector('.bracket-wrap');
    const pos = scroll ? [scroll.scrollLeft, scroll.scrollTop] : null;
    const pid = g.style === 'solo' && !g.brackets ? state.meId : shownBracket(g);
    box.innerHTML = `${g.style === 'solo' && g.brackets ? playerTabs(g, pid) : ''}<div class="bracket-wrap">${bracketFor(g, pid)}</div>`;
    const wrap = box.querySelector('.bracket-wrap');
    if (pos) [wrap.scrollLeft, wrap.scrollTop] = pos;
  }

  function openBracket() {
    const g = state && state.game;
    if (!g) return;
    MS.sheet.open('kothBracket', {
      title: g.style === 'solo' && !g.brackets ? 'Your bracket' : 'Bracket',
      cls: 'tall koth-sheet',
      body: '<div id="bkBox" class="bk-box"></div>',
    });
    renderBracketSheet();
  }

  // solo results: whose bracket is shown (mine by default, the first player's if I only watched)
  function shownBracket(g) {
    if (!g.brackets) return state.meId;
    if (!g.brackets[ui.bracketOf]) ui.bracketOf = g.brackets[state.meId] ? state.meId : g.roster[0].id;
    return ui.bracketOf;
  }

  function playerTabs(g, pid) {
    return `<div class="tabs bk-tabs" role="tablist">${g.roster.map((p) => `<button class="${p.id === pid ? 'active' : ''}" data-act="bracketOf" data-v="${esc(p.id)}" role="tab" aria-selected="${p.id === pid}">${esc(p.name)}</button>`).join('')}</div>`;
  }

  // ---------- results ----------
  // Vote style: how often each player sided with the track that went through (draws do not count).
  function agreement(g) {
    const out = {};
    for (const p of g.roster) out[p.id] = { with: 0, of: 0 };
    for (const r of g.rounds) {
      for (const m of r.matches) {
        if (!m.winners || m.winners.length !== 1 || !m.votes) continue;
        for (const [pid, side] of Object.entries(m.votes)) {
          if (!out[pid]) continue;
          out[pid].of += 1;
          if (m.winners[0] === m[side]) out[pid].with += 1;
        }
      }
    }
    return out;
  }

  function kingButton(g, i, cls = 'king') {
    const t = g.tracks[i];
    return `<button class="${cls} thumb listen" data-act="preview" data-i="${i}" aria-label="Play ${esc(t.title)}"><img src="${esc(t.cover)}" alt="">${MS.playThumbSvg}</button>`;
  }

  let resultSfx = '';
  function updateResults() {
    const g = state.game;
    const main = $('#resultsMain');
    if (!g || !main) return;
    if (resultSfx !== `${g.startsAt}${g.style}`) {
      resultSfx = `${g.startsAt}${g.style}`;
      if (MS.sfx) MS.sfx.play('win');
    }
    const loading = state.phase === 'loading';
    const actions = state.isHost
      ? `<button class="btn primary" data-act="again" ${loading ? 'disabled' : ''}>${loading ? 'Loading' : 'Play again'}</button>
         <button class="btn" data-act="toLobby" ${loading ? 'disabled' : ''}>Change the music</button>`
      : `<p class="wait">${loading ? 'The host is starting a new game' : 'The host decides what is next'}</p>`;

    let hero = '';
    let pid = state.meId;
    if (g.style === 'solo') {
      const kings = g.roster.map((p) => ({ p, k: g.progress[p.id] ? g.progress[p.id].champion : null }));
      const cards = kings.map(({ p, k }) => `
        <article class="king-card">
          ${k !== null ? kingButton(g, k, 'king-thumb') : '<span class="king-thumb none">?</span>'}
          <div><small>${MS.avatar(p, 'sm')}${esc(p.name)}${p.id === state.meId ? ' (you)' : ''}</small>
          <b>${k !== null ? esc(g.tracks[k].title) : 'Did not finish'}</b></div>
        </article>`).join('');
      const crowned = kings.filter((x) => x.k !== null);
      const groups = new Map();
      for (const x of crowned) groups.set(x.k, [...(groups.get(x.k) || []), x.p.name]);
      let verdict = '';
      if (crowned.length > 1) {
        const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        if (top[1].length === crowned.length) verdict = `<p class="verdict"><b>Same king</b>Everyone crowned ${esc(quote(g.tracks[top[0]]))}</p>`;
        else if (top[1].length > 1) verdict = `<p class="verdict-solo">${esc(listNames(top[1]))} crowned the same king: ${esc(quote(g.tracks[top[0]]))}</p>`;
        else verdict = '<p class="verdict-solo">Every king is different</p>';
      } else if (g.roster.length === 1) verdict = '<p class="verdict-solo">Play with friends to compare your kings</p>';
      hero = `
        <p class="src-kind koth-kicker">${CROWN}Kings of the hill</p>
        <h1 class="src-title">${esc(g.source.title)}</h1>
        <p class="src-sub">${g.source.type === 'artist' ? '' : `${esc(g.source.subtitle)}, `}${tracksWord(g.size)}</p>
        <div class="king-cards">${cards}</div>
        ${verdict}`;
      pid = shownBracket(g);
    } else {
      const kings = g.champions || [];
      const titles = kings.map((i) => esc(g.tracks[i].title)).join(' <span>&</span> ');
      const ag = agreement(g);
      const rows = g.roster.map((p) => {
        const a = ag[p.id];
        return `<li>${MS.avatar(p, 'sm')}<span>${esc(p.name)}${p.id === state.meId ? ' (you)' : ''}</span><em>${a.of ? `sided with the winner in ${a.with} of ${a.of}` : 'no votes'}</em></li>`;
      }).join('');
      hero = `
        <p class="src-kind koth-kicker">${CROWN}${kings.length > 1 ? 'Two kings of the hill' : 'King of the hill'}</p>
        <div class="kings ${kings.length > 1 ? 'two' : ''}">${kings.map((i) => kingButton(g, i)).join('')}</div>
        <h1 class="src-title koth-king-title">${titles}</h1>
        <p class="src-sub">${kings.length ? esc(g.tracks[kings[0]].artist) : ''} · ${esc(g.source.title)}</p>
        ${kings.length > 1 ? '<p class="verdict-solo">A draw in the final. They share the hill</p>' : ''}
        ${g.roster.length > 1 ? `<ul class="agree-list">${rows}</ul>` : ''}`;
    }

    main.innerHTML = `
      <section class="res-hero">
        ${hero}
        <div class="res-actions">${actions}<button class="btn quiet" data-act="copyResults">Copy results</button></div>
      </section>
      <section class="res-boards koth-board">
        ${g.style === 'solo' ? playerTabs(g, pid) : ''}
        <div class="bracket-wrap">${bracketFor(g, pid)}</div>
        <p class="res-hint">Tap a king to listen</p>
      </section>`;
    const wrap = main.querySelector('.bracket-wrap');
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    const pk = MS.audio.previewKey;
    if (pk.startsWith('kothpreview:')) {
      const idx = g.tracks.findIndex((t) => `kothpreview:${t.id}` === pk);
      $$(`.listen[data-i="${idx}"]`).forEach((b) => b.classList.add('on'));
    }
  }

  function resultsText(g) {
    const src = `${g.source.title}${g.source.type === 'album' && g.source.subtitle ? ` (${g.source.subtitle})` : ''}`;
    const lines = [`King of the Hill: ${src}`];
    const title = (i) => g.tracks[i].title;
    if (g.style === 'solo') {
      for (const p of g.roster) {
        const k = g.progress[p.id] ? g.progress[p.id].champion : null;
        lines.push(`${p.name}: ${k !== null ? title(k) : 'did not finish'}`);
      }
    } else {
      const kings = g.champions || [];
      lines.push(`${kings.length > 1 ? 'Kings' : 'King'}: ${kings.map(title).join(' & ')}`, '');
      for (const r of [...g.rounds].reverse()) {
        const ms = r.matches.map((m) => {
          if (m.how === 'draw') return `${title(m.a)} and ${title(m.b)} drew`;
          const w = m.winners[0];
          const l = w === m.a ? m.b : m.a;
          const t = m.tally || { a: 0, b: 0 };
          const score = m.how === 'votes' ? ` ${Math.max(t.a, t.b)}-${Math.min(t.a, t.b)}` : m.how === 'concede' ? ' (conceded)' : ' (coin flip)';
          return `${title(w)} beat ${title(l)}${score}`;
        });
        lines.push(`${r.name}: ${ms.join('; ')}`);
      }
    }
    lines.push('', `Play: ${location.origin}`);
    return lines.join('\n');
  }

  // ---------- controller ----------
  const C = {
    mode: 'koth',
    label: 'King of the Hill',
    leaving: false,
    get code() { return session && session.code; },
    get isHost() { return Boolean(state && state.isHost); },
    get inLobby() { return Boolean(state && (state.phase === 'lobby' || state.phase === 'results')); },
    session: () => (session ? { mode: 'koth', ...session } : null),

    async create(name) {
      const r = await MS.emit('koth:create', { name });
      if (!MS.okOf(r)) return r;
      start(r);
      return r;
    },
    async join(code, name, saved) {
      const r = await MS.emit('koth:join', { code, name, ...(saved ? { pid: saved.pid, token: saved.token } : {}) });
      if (!MS.okOf(r)) return r;
      start(r);
      return r;
    },
    async reconnect() {
      if (!session) return { error: 'No room' };
      const r = await MS.emit('koth:join', { ...session, name: MS.account.displayName() });
      if (!MS.okOf(r)) MS.app.dropRoom(r.network ? null : 'The room is closed. Create a new one');
      return r;
    },
    async leave() {
      C.leaving = true;
      await MS.emit('koth:leave', {});
      stop();
      C.leaving = false;
    },
    destroy: () => stop(),
    onAct(actName, el) {
      const v = el.dataset.v;
      switch (actName) {
        case 'openPicker': openPicker(); break;
        case 'toggleOpen': act('setOpen', { open: !(state && state.isOpen) }); break;
        case 'size': act('setSettings', { size: Number(v) }); break;
        case 'style': act('setSettings', { style: v }); break;
        case 'timer': act('setSettings', { timer: Number(v) }); break;
        case 'kick':
          if (confirm('Remove this player from the room?')) act('kick', { playerId: el.dataset.id });
          break;
        case 'start':
        case 'again':
          MS.audio.unlock();
          el.disabled = true;
          act(actName);
          break;
        case 'toLobby':
          MS.audio.stop();
          act('toLobby');
          break;
        case 'abort':
          if (confirm('End the game for everyone and go back to the lobby?')) act('toLobby');
          break;
        case 'finishNow':
          if (confirm('Show the results now? Brackets that are not finished stay without a king.')) act('finishNow');
          break;
        case 'listen': play(v); break;
        case 'vote': vote(v); break;
        case 'tie':
          el.disabled = true;
          act('tie', { answer: v });
          break;
        case 'bracket': openBracket(); break;
        case 'bracketOf':
          ui.bracketOf = v;
          if (MS.sheet.isOpen('kothBracket')) renderBracketSheet();
          if (state && state.phase === 'results') updateResults();
          break;
        case 'preview': {
          const t = state && state.game && state.game.tracks[Number(el.dataset.i)];
          if (t) MS.audio.preview(t.preview, `kothpreview:${t.id}`, el);
          break;
        }
        case 'copyResults':
          if (state && state.game) MS.copyText(resultsText(state.game), 'Results copied');
          break;
        default: break;
      }
    },
    onKey(e) {
      if (!state || state.phase !== 'playing' || e.target.closest('input, textarea') || document.querySelector('.sheet.open')) return;
      if (e.key === 'ArrowLeft' || e.key === '1') vote('a');
      else if (e.key === 'ArrowRight' || e.key === '2') vote('b');
      else if (e.key === ' ' && currentDuel()) {
        e.preventDefault();
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
        play(listen.side === 'a' ? 'b' : 'a');
      }
    },
  };

  // the bracket sheet lives outside #app, so its player tabs need their own click handler
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#bkBox [data-act="bracketOf"]');
    if (b && session) C.onAct('bracketOf', b);
  });

  function start(r) {
    session = { code: r.code, pid: r.pid, token: r.token };
    skeletonKey = '';
    duelKey = '';
    state = null;
    ui.bracketOf = null;
    MS.app.roomStarted(C);
    app().innerHTML = '<div class="center-screen"><div class="spinner"></div><p>Connecting to the room</p></div>';
    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 100);
  }

  function stop() {
    clearInterval(timerInterval);
    timerInterval = null;
    stopListening();
    session = null;
    state = null;
    skeletonKey = '';
    MS.picker.close(true);
    MS.sheet.close('kothBracket', true);
  }

  MS.modes = MS.modes || {};
  MS.modes.koth = C;
})();
