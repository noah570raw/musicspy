'use strict';
// Keep 5 Delete 5 mode: lobby, game and results. Ported from the standalone Keep 5 Delete 5 client;
// the server sends the whole room as this player sees it (k5:state), and we re-render from it.
(() => {
  const MS = window.MS;
  const { $, $$, esc } = MS;
  const tracksWord = (n) => MS.count(n, 'track');

  let state = null;
  let session = null; // { code, pid, token }
  let skeletonKey = '';
  let trackKey = '';
  let choosing = false;
  let timerInterval = null;

  const app = () => $('#app');
  const serverNow = () => MS.now();

  async function act(type, payload) {
    const r = await MS.emit('k5:action', { type, payload });
    if (!MS.okOf(r) && r.error) MS.toast(r.error);
    return r;
  }

  MS.socket.on('k5:state', (msg) => {
    if (!session || !msg || !msg.state || msg.state.code !== session.code) return;
    MS.setServerNow(msg.now);
    state = msg.state;
    render();
  });
  MS.socket.on('k5:kicked', () => {
    if (!session) return;
    if (C.leaving) return;
    MS.app.dropRoom('You are no longer in this room');
  });

  function backdropForState() {
    if (!state) return '';
    const g = state.game;
    if (state.phase === 'playing' && g && g.round >= 0) {
      const t = g.tracks[Math.min(g.round, g.tracks.length - 1)];
      return (t && t.cover) || (g.source && g.source.cover) || '';
    }
    if (viewName() === 'results' && g) return g.source.cover;
    return state.source ? state.source.cover : '';
  }

  function viewName() {
    if (state.phase === 'loading') return state.game ? 'results' : 'lobby';
    return state.phase;
  }

  function half() {
    if (state.game && state.phase !== 'lobby') return state.game.half;
    return state.settings.trackCount / 2;
  }

  // ---------- render ----------
  function render() {
    if (!state || !session) return;
    const view = viewName();
    const key = `${view}|${state.isHost ? 'h' : 'g'}`;
    if (key !== skeletonKey) {
      skeletonKey = key;
      trackKey = '';
      buildSkeleton(view);
    }
    updateTopbar();
    if (view === 'lobby') updateLobby();
    else if (view === 'playing') updateGame();
    else if (view === 'results') updateResults();
    MS.setBackdrop(backdropForState());
    MS.music.setContext(state.phase === 'lobby' ? 'lobby' : 'game'); // menu music stays on, quieter, until the game starts
    syncAudio();
    MS.chat.setSource({
      roomKey: `k5:${state.code}`,
      messages: state.chat || [],
      meId: state.meId,
      players: state.players,
      send: (text) => act('chat', { text }),
    });
  }

  function topbar(center = '', inGame = false) {
    return `
      <header class="bar">
        <span class="bar-brand"><span>Keep <span data-half></span> <span class="struck">Delete <span data-half></span></span></span><small>MusicSpy</small></span>
        <div class="bar-center">${center}</div>
        <div class="bar-actions">
          ${MS.volumeControl()}
          ${inGame ? '<button class="room-btn" data-act="copyLink" title="Copy the invite link"><span data-code></span></button>' : ''}
          ${MS.chat.buttonHtml()}
          ${inGame && state.isHost && state.phase === 'playing' ? '<button class="leave-btn" data-act="abort">End game</button>' : ''}
          <button class="leave-btn" data-act="leaveRoom">Leave</button>
        </div>
      </header>`;
  }

  function buildSkeleton(view) {
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
              </div>
              <ul id="playerList" class="people"></ul>
            </footer>
          </main>
        </div>`;
    } else if (view === 'playing') {
      app().innerHTML = `
        <div class="screen">
          ${topbar('<ul id="faces" class="faces"></ul>', true)}
          <main class="game">
            <section id="shelfKeep" class="shelf keep" aria-label="Kept tracks"></section>
            <section class="stage">
              <div id="trackCard" class="track"></div>
              <div class="progress"><div class="progress-line"><i id="timerFill"></i></div><span id="timerText" class="timer-text">&nbsp;</span></div>
              <div id="choiceBox" class="choice"></div>
              <div id="revealBox" class="reveal-box"></div>
            </section>
            <section id="shelfDel" class="shelf del" aria-label="Deleted tracks"></section>
          </main>
        </div>`;
    } else {
      app().innerHTML = `<div class="screen">${topbar('', true)}<main id="resultsMain" class="results"></main></div>`;
    }
    MS.ui.build($('.screen'));
  }

  function updateTopbar() {
    const h = half();
    $$('[data-half]').forEach((el) => { el.textContent = h; });
    $$('[data-code]').forEach((el) => { el.textContent = state.code; });
    document.title = `Keep ${h} Delete ${h} · ${state.code}`;
  }

  // ---------- music picker (picker.js) ----------
  function openPicker() {
    MS.picker.open({
      current: () => ({
        selected: state && state.source ? `${state.source.type}:${state.source.id}` : '',
        loadingId: state && state.sourceLoading ? state.sourceLoading.id : '',
      }),
      onPick: async (type, id) => MS.okOf(await act('setSource', { type, id })),
    });
  }

  // ---------- lobby ----------
  function updateLobby() {
    const online = state.players.filter((p) => p.connected).length;
    const host = state.isHost;
    const s = state.settings;
    const src = state.source;

    $('#playerList').innerHTML = state.players.map((p) => `
      <li class="${p.connected ? '' : 'away'}" title="${p.connected ? '' : 'offline'}">
        ${MS.avatar(p, 'sm')}<span>${esc(p.name)}${p.id === state.meId ? ' (you)' : ''}</span>${p.id === state.hostId ? '<small>host</small>' : ''}
        ${host && p.id !== state.meId ? `<button class="kick" data-act="kick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">${'✕'}</button>` : ''}
      </li>`).join('') + (state.players.length < 2 ? '<li class="lonely">Send a friend the link and they show up here</li>' : '');

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
        <p class="src-kind">Keep 5 Delete 5</p>
        <h1 class="src-title">Pick an album</h1>
        <p class="src-sub">${host ? 'Choose an album or a whole discography. Its cover sets the colours of the game.' : 'The host is picking the music. The cover shows up here.'}</p>`;
    }

    const dis = host ? '' : 'disabled';
    const counts = state.limits.allTrackCounts.map((n) => {
      const allowed = state.limits.trackCounts.includes(n);
      return `<button class="opt ${s.trackCount === n ? 'active' : ''}" data-act="count" data-v="${n}" ${!allowed || !host ? 'disabled' : ''} title="${allowed ? `keep ${n / 2}, delete ${n / 2}` : 'The music has fewer tracks'}">${n}</button>`;
    }).join('');
    const timers = state.limits.timers.map((t) => `<button class="opt ${s.timer === t ? 'active' : ''}" data-act="timer" data-v="${t}" ${dis} title="${t ? `${t} seconds per track` : 'The track loops until everyone decides'}">${t ? `${t}s` : '∞'}</button>`).join('');
    $('#settingsBox').innerHTML = `
      <div class="set-row"><span class="set-name">Tracks</span><div class="opts">${counts}</div></div>
      <div class="set-row"><span class="set-name">Friends' picks</span><div class="opts">
        <button class="opt wide ${s.revealMode === 'each' ? 'active' : ''}" data-act="reveal" data-v="each" ${dis} title="Argue as you go">after each track</button>
        <button class="opt wide ${s.revealMode === 'end' ? 'active' : ''}" data-act="reveal" data-v="end" ${dis} title="Suspense until the last track">in the results</button>
      </div></div>
      <div class="set-row"><span class="set-name">Time</span><div class="opts">${timers}</div></div>`;

    const sbox = $('#startBox');
    if (host) {
      const loading = state.phase === 'loading';
      const can = src && !state.sourceLoading && !loading;
      sbox.innerHTML = `
        <button class="btn primary big" data-act="start" ${can ? '' : 'disabled'}>${loading ? 'Loading tracks' : `Start: keep ${s.trackCount / 2}, delete ${s.trackCount / 2}`}</button>
        <p class="start-note">${!src ? 'Pick the music first' : online < 2 ? 'You can play alone, but it is better with a friend' : `${MS.count(online, 'player')} in the room`}</p>`;
    } else {
      sbox.innerHTML = `<p class="wait">${state.phase === 'loading' ? 'Loading tracks' : 'Waiting for the host to start'}</p>`;
    }
  }

  // ---------- game ----------
  function myCounts(g) {
    const mine = g.choices[state.meId] || [];
    const counts = { keep: 0, delete: 0 };
    for (const ch of mine) if (ch) counts[ch.c] += 1;
    return counts;
  }

  function shelfHtml(g, items, c, r) {
    const title = c === 'keep' ? 'Kept' : 'Deleted';
    const slots = Array.from({ length: g.half }, (_, i) => {
      const it = items[i];
      if (!it || !it.t) return '<li class="slot empty"><i></i></li>';
      return `<li class="slot ${it.i === r ? 'new' : ''}" title="${esc(`${it.t.title} by ${it.t.artist}`)}"><img src="${esc(it.t.cover)}" alt=""><span><b>${esc(it.t.title)}</b><small>${it.ch.how !== 'manual' ? 'auto' : esc(it.t.artist)}</small></span></li>`;
    }).join('');
    return `<p class="shelf-head"><b>${title}</b><span>${items.length} of ${g.half}</span></p><ol class="${g.half > 5 ? 'two' : ''}" style="--n:${g.half}">${slots}</ol>`;
  }

  function updateGame() {
    const g = state.game;
    if (!g || g.round < 0) return;
    const r = Math.min(g.round, g.total - 1);
    const t = g.tracks[r];
    const key = `${r}|${t && t.id}`;
    const listening = g.roundPhase === 'listening';
    if (key !== trackKey && t) {
      trackKey = key;
      const card = $('#trackCard');
      card.innerHTML = `
        <p class="track-pos">${r + 1} of ${g.total}</p>
        <img class="cover" src="${esc(t.cover)}" alt="">
        <h1 class="track-title">${esc(t.title)}${t.version ? ` <span>${esc(t.version)}</span>` : ''}</h1>
        <p class="track-artist">${esc(t.artist)}${t.album && g.source.type === 'artist' ? `, ${esc(t.album)}` : ''}</p>`;
      card.classList.remove('enter');
      void card.offsetWidth;
      card.classList.add('enter');
    }

    const mine = g.choices[state.meId];
    const cur = mine ? mine[r] : null;
    const counts = myCounts(g);
    const choiceBox = $('#choiceBox');
    if (!g.isParticipant) {
      choiceBox.innerHTML = '<p class="choice-note">You are watching this game. You can play from the next one.</p>';
    } else {
      const btn = (c, label, kbd) => {
        const left = g.half - counts[c];
        const full = left <= 0;
        const picked = cur && cur.c === c;
        const disabled = !listening || Boolean(cur) || full || choosing;
        return `<button class="pick ${c === 'keep' ? 'keep' : 'del'} ${picked ? 'picked' : ''}" data-act="choose" data-v="${c}" ${disabled ? 'disabled' : ''}>
          <span class="pick-label">${label}<kbd>${kbd}</kbd></span>
          ${full && !picked ? '<span class="pick-left">no slots left</span>' : ''}
        </button>`;
      };
      let note = '';
      if (cur && cur.how === 'forced') note = `${cur.c === 'keep' ? 'Delete' : 'Keep'} is full, so the track went to ${cur.c === 'keep' ? 'Keep' : 'Delete'}`;
      else if (cur && cur.how === 'auto') note = `Time ran out. The track went to ${cur.c === 'keep' ? 'Keep' : 'Delete'} at random`;
      else if (cur) note = cur.c === 'keep' ? 'Kept. No changing your mind' : 'Deleted. No changing your mind';
      else if (listening && serverNow() < g.startsAt) note = 'Get ready';
      choiceBox.innerHTML = `<div class="picks">${btn('keep', 'Keep', '←')}${btn('delete', 'Delete', '→')}</div><p class="choice-note">${esc(note) || '&nbsp;'}</p>`;
    }

    const rb = $('#revealBox');
    const roster = g.roster;
    if (g.roundPhase === 'reveal' && g.settings.revealMode === 'each' && roster.length > 1) {
      const picks = roster.map((p) => ({ p, ch: g.choices[p.id] && g.choices[p.id][r] }));
      const keeps = picks.filter((x) => x.ch && x.ch.c === 'keep').length;
      const dels = picks.filter((x) => x.ch && x.ch.c === 'delete').length;
      const headline = !dels ? 'Everyone kept it' : !keeps ? 'Everyone deleted it' : `Split: ${keeps} kept, ${dels} deleted`;
      rb.innerHTML = `<div class="reveal"><b>${esc(headline)}</b></div>`;
    } else if (g.roundPhase === 'reveal' && g.settings.revealMode === 'end' && roster.length > 1) {
      rb.innerHTML = '<div class="reveal quiet">Everyone decided. Picks open in the results</div>';
    } else rb.innerHTML = '';

    const online = new Map(state.players.map((p) => [p.id, p.connected]));
    const faces = $('#faces');
    faces.classList.toggle('many', roster.length > 4);
    faces.innerHTML = roster.map((p) => {
      const decided = g.decided.includes(p.id);
      const shown = g.choices[p.id] && g.choices[p.id][r];
      let status = 'thinking';
      let cls = 'thinking';
      if (g.roundPhase === 'reveal' && shown) {
        status = shown.c === 'keep' ? 'kept' : 'deleted';
        cls = shown.c === 'keep' ? 'k' : 'd';
      } else if (decided || g.roundPhase === 'reveal') {
        status = 'decided';
        cls = 'done';
      }
      const away = online.get(p.id) === false || !online.has(p.id);
      return `<li class="${cls} ${away ? 'away' : ''}" title="${esc(p.name)}: ${away ? 'offline' : status}">${MS.avatar(p, 'sm')}<span class="face-text"><b>${esc(p.name)}</b><small>${away ? 'offline' : status}</small></span></li>`;
    }).join('');

    const lists = { keep: [], delete: [] };
    (mine || []).forEach((ch, i) => { if (ch) lists[ch.c].push({ ch, t: g.tracks[i], i }); });
    $('#shelfKeep').innerHTML = g.isParticipant ? shelfHtml(g, lists.keep, 'keep', r) : '';
    $('#shelfDel').innerHTML = g.isParticipant ? shelfHtml(g, lists.delete, 'delete', r) : '';
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
    if (g.roundPhase === 'loading') label = 'Loading the track';
    else if (g.roundPhase === 'listening') {
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
    } else if (g.roundPhase === 'reveal' && g.phaseEndsAt) {
      const left = Math.max(0, g.phaseEndsAt - now);
      pct = 100 - (left / (g.settings.revealMode === 'each' ? 5500 : 1600)) * 100;
      fill.classList.add('after');
      label = g.round + 1 >= g.total ? 'Results are next' : `Next track in ${Math.ceil(left / 1000)}`;
    }
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (text.textContent !== label) text.textContent = label || ' ';
    const note = $('.choice-note');
    if (note && g.roundPhase === 'listening' && note.textContent === 'Get ready' && now >= g.startsAt) note.innerHTML = '&nbsp;';
  }

  function syncAudio() {
    const g = state && state.game;
    if (!state || state.phase !== 'playing' || !g) {
      if (!MS.audio.previewKey) MS.audio.sync(null);
      return;
    }
    if (g.roundPhase === 'loading' || g.round < 0 || g.round >= g.total) return;
    const t = g.tracks[g.round];
    if (!t || !t.preview) return;
    MS.audio.sync({ key: `k5:${g.round}`, src: t.preview, startsAt: g.startsAt, loop: !g.settings.timer });
  }

  async function choose(c) {
    const g = state && state.game;
    if (!g || state.phase !== 'playing' || g.roundPhase !== 'listening' || choosing) return;
    const mine = g.choices[state.meId];
    if (!mine || mine[g.round]) return;
    if (myCounts(g)[c] >= g.half) return;
    choosing = true;
    $$('.pick').forEach((b) => { b.disabled = true; });
    const btn = $(`.pick[data-v="${c}"]`);
    if (btn) btn.classList.add('picked');
    await act('choose', { choice: c });
    choosing = false;
    render();
  }

  // ---------- results ----------
  function computeResults(g) {
    const roster = g.roster;
    const n = g.tracks.length;
    const rows = g.tracks.map((t, i) => {
      const picks = roster.map((p) => g.choices[p.id] && g.choices[p.id][i]);
      const keeps = picks.filter((c) => c && c.c === 'keep').length;
      return { t, i, picks, keeps, dels: picks.filter((c) => c && c.c === 'delete').length };
    });
    const pairs = [];
    for (let a = 0; a < roster.length; a += 1) {
      for (let b = a + 1; b < roster.length; b += 1) {
        let same = 0;
        for (let i = 0; i < n; i += 1) {
          const ca = g.choices[roster[a].id][i];
          const cb = g.choices[roster[b].id][i];
          if (ca && cb && ca.c === cb.c) same += 1;
        }
        pairs.push({ a: roster[a], b: roster[b], same, pct: Math.round((same / n) * 100) });
      }
    }
    pairs.sort((x, y) => y.pct - x.pct);
    const unanimous = rows.filter((row) => row.keeps === roster.length || row.dels === roster.length).length;
    const split = rows.filter((row) => row.keeps && row.dels);
    return { rows, pairs, unanimous, split };
  }

  function resultsText(g, res) {
    const lines = [`Keep ${g.half} Delete ${g.half}: ${g.source.title}${g.source.type === 'album' && g.source.subtitle ? ` (${g.source.subtitle})` : ''}`];
    for (const p of g.roster) {
      const mine = g.choices[p.id];
      const k = g.tracks.filter((_, i) => mine[i] && mine[i].c === 'keep').map((t) => t.title);
      const d = g.tracks.filter((_, i) => mine[i] && mine[i].c === 'delete').map((t) => t.title);
      lines.push('', `${p.name}`, `Kept: ${k.join(', ')}`, `Deleted: ${d.join(', ')}`);
    }
    if (res.pairs.length) {
      lines.push('');
      for (const pr of res.pairs) lines.push(`${pr.a.name} and ${pr.b.name} matched ${pr.pct}%`);
    }
    lines.push('', `Play: ${location.origin}`);
    return lines.join('\n');
  }

  function updateResults() {
    const g = state.game;
    const main = $('#resultsMain');
    if (!g || !main) return;
    const res = computeResults(g);
    const roster = g.roster;
    const loading = state.phase === 'loading';

    let verdict = '';
    if (res.pairs.length === 1) {
      const pr = res.pairs[0];
      verdict = `<p class="verdict"><b>${pr.pct}%</b>match between ${esc(pr.a.name)} and ${esc(pr.b.name)}</p>`;
    } else if (res.pairs.length > 1) {
      const best = res.pairs[0];
      verdict = `<p class="verdict"><b>${res.unanimous} of ${g.total}</b>were unanimous. Closest taste: ${esc(best.a.name)} and ${esc(best.b.name)}, ${best.pct}%</p>`;
    } else {
      verdict = '<p class="verdict-solo">Play with a friend to compare taste</p>';
    }
    let split = '';
    if (roster.length > 1 && res.split.length) {
      const names = res.split.slice(0, 3).map((row) => esc(row.t.title)).join(', ');
      split = `<p class="split">Argued over ${names}${res.split.length > 3 ? ` and ${res.split.length - 3} more` : ''}</p>`;
    }

    const actions = state.isHost
      ? `<button class="btn primary" data-act="again" ${loading ? 'disabled' : ''}>${loading ? 'Loading' : 'Play again'}</button>
         <button class="btn" data-act="toLobby" ${loading ? 'disabled' : ''}>Change the music</button>`
      : `<p class="wait">${loading ? 'The host is starting a new game' : 'The host decides what is next'}</p>`;

    const thumbs = (p, c) => {
      const mine = g.choices[p.id] || [];
      return g.tracks.map((t, i) => ({ t, i, ch: mine[i] })).filter((x) => x.ch && x.ch.c === c)
        .map((x) => `<li><button class="thumb listen" data-act="preview" data-i="${x.i}" title="${esc(`${x.t.title} by ${x.t.artist}`)}" aria-label="Play ${esc(x.t.title)}"><img src="${esc(x.t.cover)}" alt="">${MS.playThumbSvg}</button><span>${esc(x.t.title)}</span></li>`).join('');
    };
    const boards = roster.map((p) => `
      <article class="board">
        <h2>${MS.avatar(p, 'sm')}${esc(p.name)}${p.id === state.meId ? ' <small>you</small>' : ''}</h2>
        <div class="row keep"><span class="row-label">Kept</span><ol style="--n:${g.half}">${thumbs(p, 'keep')}</ol></div>
        <div class="row del"><span class="row-label">Deleted</span><ol style="--n:${g.half}">${thumbs(p, 'delete')}</ol></div>
      </article>`).join('');

    main.innerHTML = `
      <section class="res-hero">
        <img class="res-cover ${g.source.type === 'artist' ? 'round' : ''}" src="${esc(g.source.cover)}" alt="">
        <div class="res-text">
          <p class="src-kind">Results</p>
          <h1 class="src-title">${esc(g.source.title)}</h1>
          <p class="src-sub">${g.source.type === 'artist' ? '' : `${esc(g.source.subtitle)}, `}${tracksWord(g.total)}</p>
          ${verdict}${split}
          <div class="res-actions">${actions}<button class="btn quiet" data-act="copyResults">Copy results</button></div>
        </div>
      </section>
      <section class="res-boards ${roster.length > 2 ? 'many' : ''}">${boards}<p class="res-hint">Tap a cover to listen</p></section>`;
    const pk = MS.audio.previewKey;
    if (pk.startsWith('k5preview:')) {
      const idx = g.tracks.findIndex((t) => `k5preview:${t.id}` === pk);
      $$(`.listen[data-i="${idx}"]`).forEach((b) => b.classList.add('on'));
    }
  }

  // ---------- controller ----------
  const C = {
    mode: 'k5',
    label: 'Keep 5 Delete 5',
    leaving: false,
    get code() { return session && session.code; },
    get isHost() { return Boolean(state && state.isHost); },
    get inLobby() { return Boolean(state && (state.phase === 'lobby' || state.phase === 'results')); },
    session: () => (session ? { mode: 'k5', ...session } : null),

    async create(name) {
      const r = await MS.emit('k5:create', { name });
      if (!MS.okOf(r)) return r;
      start(r);
      return r;
    },
    async join(code, name, saved) {
      const r = await MS.emit('k5:join', { code, name, ...(saved ? { pid: saved.pid, token: saved.token } : {}) });
      if (!MS.okOf(r)) return r;
      start(r);
      return r;
    },
    // After a reconnect the socket is new: re-join with our pid + token.
    async reconnect() {
      if (!session) return { error: 'No room' };
      const r = await MS.emit('k5:join', { ...session, name: MS.account.displayName() });
      if (!MS.okOf(r)) MS.app.dropRoom(r.network ? null : 'The room is closed. Create a new one');
      return r;
    },
    async leave() {
      C.leaving = true;
      await MS.emit('k5:leave', {});
      stop();
      C.leaving = false;
    },
    destroy: () => stop(),
    onAct(actName, el) {
      const v = el.dataset.v;
      switch (actName) {
        case 'openPicker': openPicker(); break;
        case 'count': act('setSettings', { trackCount: Number(v) }); break;
        case 'timer': act('setSettings', { timer: Number(v) }); break;
        case 'reveal': act('setSettings', { revealMode: v }); break;
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
        case 'choose': choose(v); break;
        case 'preview': {
          const t = state && state.game && state.game.tracks[Number(el.dataset.i)];
          if (t) MS.audio.preview(t.preview, `k5preview:${t.id}`, el);
          break;
        }
        case 'copyResults':
          if (state && state.game) MS.copyText(resultsText(state.game, computeResults(state.game)), 'Results copied');
          break;
        default: break;
      }
    },
    onKey(e) {
      if (!state || state.phase !== 'playing' || e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft' || e.key === '1') choose('keep');
      if (e.key === 'ArrowRight' || e.key === '2') choose('delete');
    },
  };

  function start(r) {
    session = { code: r.code, pid: r.pid, token: r.token };
    skeletonKey = '';
    trackKey = '';
    state = null;
    MS.app.roomStarted(C);
    app().innerHTML = '<div class="center-screen"><div class="spinner"></div><p>Connecting to the room</p></div>';
    clearInterval(timerInterval);
    timerInterval = setInterval(tickTimer, 100);
  }

  function stop() {
    clearInterval(timerInterval);
    timerInterval = null;
    session = null;
    state = null;
    skeletonKey = '';
    MS.picker.close(true);
  }

  MS.modes = MS.modes || {};
  MS.modes.k5 = C;
})();
