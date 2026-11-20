'use strict';
// Player profiles: your own page in the home hub ("Profile" tab) and a sheet for anyone else
// (tap a player in a lobby, the leaderboard or global chat). Banner, frame, name colour, title, level,
// stats for all three modes, achievements, recent games and what they wear.
(() => {
  const MS = window.MS;
  const { esc } = MS;
  const A = MS.account;
  let root = null;

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  function ago(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }
  const tile = (v, label) => `<div class="stat"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;

  function statsHtml(s) {
    const k5Avg = s.k5AgreeGames ? `${Math.round(s.k5AgreeSum / s.k5AgreeGames)}%` : '–';
    return `
      <p class="section-label">Spy</p>
      <div class="stats">
        ${tile(fmt(s.games), 'Games')}${tile(pct(s.wins || 0, s.games || 0), 'Win rate')}${tile(fmt(s.spyWins), 'Wins as spy')}
        ${tile(fmt(s.civilianWins), 'Wins as civilian')}${tile(fmt(s.bestWinStreak), 'Best streak')}${tile(fmt(s.correctAccusations), 'Spies caught')}
      </div>
      <p class="section-label">Keep 5 Delete 5</p>
      <div class="stats">${tile(fmt(s.k5Games), 'Games')}${tile(fmt(s.k5Tracks), 'Tracks judged')}${tile(k5Avg, 'Average match')}</div>
      <p class="section-label">King of the Hill</p>
      <div class="stats">${tile(fmt(s.kothGames), 'Games')}${tile(fmt(s.kothDuels), 'Duels judged')}</div>`;
  }

  function achievementsHtml(u) {
    const list = MS.cos.achievements || [];
    if (!list.length) return '';
    const got = (u.economy && u.economy.achievements) || {};
    const s = u.stats || {};
    return `
      <p class="section-label">Achievements</p>
      <ul class="ach-list">${list.map((a) => {
        const st = got[a.id] || {};
        const progress = Math.min(a.target, Number(st.progress !== undefined ? st.progress : s[a.stat] || 0));
        const done = st.completed || progress >= a.target;
        const reward = [a.vinyls ? `${fmt(a.vinyls)} Vinyls` : '', a.unlock && MS.cos.item(a.unlock) ? MS.cos.item(a.unlock).name : ''].filter(Boolean).join(' + ');
        return `<li class="${done ? 'done' : ''}"><div><b>${esc(a.label)}</b><small>${esc(reward)}</small></div>
          <span class="ach-bar"><i style="width:${Math.round((progress / a.target) * 100)}%"></i></span><em>${done ? 'Done' : `${fmt(progress)} / ${fmt(a.target)}`}</em></li>`;
      }).join('')}</ul>`;
  }

  function gameRow(g) {
    if (g.mode === 'k5') {
      return `<li>${g.cover ? `<img src="${esc(g.cover)}" alt="">` : '<i></i>'}<div><b>Keep 5 Delete 5 · ${esc(g.title)}</b><small>${g.tracks} tracks · ${g.playerCount} ${g.playerCount === 1 ? 'player' : 'players'} · ${ago(g.endedAt)}</small></div></li>`;
    }
    if (g.mode === 'koth') {
      return `<li>${g.cover ? `<img src="${esc(g.cover)}" alt="">` : '<i></i>'}<div><b>King of the Hill · ${esc(g.title)}</b><small>${g.king ? `King: ${esc(g.king)} · ` : ''}${ago(g.endedAt)}</small></div></li>`;
    }
    return `<li><i class="spy-dot ${g.won ? 'won' : ''}"></i><div><b>Spy · ${g.won ? 'won' : 'lost'} as ${g.role === 'spy' ? 'the spy' : 'a civilian'}</b><small>${esc(g.theme || '')}${g.theme ? ' · ' : ''}${g.playerCount} players · ${ago(g.endedAt)}</small></div></li>`;
  }

  function headHtml(u, own) {
    const p = { ...u, name: u.displayName || u.username, cosmetics: (u.economy && u.economy.equipped) || {} };
    const banner = MS.cos.banner(p);
    const lob = MS.cos.lobbyAttrs(p);
    const pr = (u.economy && u.economy.xpProgress) || { level: (u.economy && u.economy.level) || 1, progress: 0 };
    return `
      <div class="prof-head">
        <div class="prof-banner" style="${banner ? `background:${banner}` : ''}"></div>
        <div class="prof-main">
          ${MS.avatar(p, 'xl')}
          <div class="prof-name">
            <h1>${MS.cos.nick(p.name, p)}</h1>
            <small>@${esc(u.username || '')}</small>
            ${MS.cos.title(p)}
          </div>
          <button class="level-ring ${MS.cos.isDev(u) ? 'inf' : ''}" style="--p:${MS.cos.isDev(u) ? 100 : (pr.progress || 0)}" ${own ? 'data-act="openLevel"' : ''} aria-label="Level ${MS.cos.levelText(u, pr.level)}"><b>${MS.cos.levelText(u, pr.level)}</b></button>
        </div>
        ${lob.cls ? `<div class="prof-card-row"><span class="lfx-card ${lob.cls}" style="${lob.style}">${MS.avatar(p, 'sm')}<b>${MS.cos.nick(p.name, p)}</b><small>lobby card</small></span></div>` : ''}
      </div>`;
  }

  function bodyHtml(u, own) {
    const games = u.recentGames || [];
    return `
      ${headHtml(u, own)}
      ${own ? `<div class="row-actions prof-actions">
        <button class="btn" data-act="openAccount">Edit profile</button>
        <button class="btn" data-act="nav" data-v="shop">My items</button>
        <button class="btn quiet" data-act="wallet">${MS.econ.coin()}${fmt(MS.econ.vinyls())} Vinyls</button>
        ${u.permissions && u.permissions.dev ? '<button class="btn quiet" data-act="devConsole">Dev console</button>' : ''}
      </div>` : ''}
      <div class="prof-grid">
        <section>${statsHtml(u.stats || {})}</section>
        <section>
          ${achievementsHtml(u)}
          <p class="section-label">Recent games</p>
          ${games.length ? `<ul class="games-list">${games.map(gameRow).join('')}</ul>` : '<p class="empty-note">No games yet.</p>'}
          <p class="empty-note">Playing since ${esc(new Date(u.createdAt || Date.now()).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</p>
        </section>
      </div>`;
  }

  function render() {
    if (!root) return;
    if (!A.user) {
      root.innerHTML = `
        <div class="page-head"><div><h1 class="page-title">Profile</h1></div></div>
        <div class="guest-card">
          <p>Sign in to keep your stats, earn Vinyls and levels in Spy, collect items and add friends.</p>
          <button class="btn primary big" data-act="openAccount">Sign in</button>
        </div>`;
      return;
    }
    root.innerHTML = `<div class="profile-page">${bodyHtml(A.user, true)}</div>`;
  }

  MS.pages = MS.pages || {};
  MS.pages.profile = {
    title: 'Profile',
    mount(el) { root = el; render(); },
    unmount() { root = null; },
  };
  A.onChange(() => render());
  MS.cos.onLoad(() => render());

  // someone else's profile, in a sheet
  MS.profile = {
    async open(accountId) {
      if (!accountId) return;
      if (A.user && accountId === A.user.id && !MS.app.inRoom()) { MS.app.nav('profile'); return; }
      const el = MS.sheet.open('profileView', { title: 'Player', cls: 'tall', body: '<div class="center-screen"><div class="spinner"></div></div>' });
      const r = await MS.emit('profile:view', { accountId });
      if (!MS.sheet.isOpen('profileView')) return;
      const box = el.querySelector('.sheet-content');
      if (!MS.okOf(r) || !r.user) { box.innerHTML = `<p class="empty-note">${esc((r && r.error) || 'Profile not found')}</p>`; return; }
      const own = A.user && r.user.id === A.user.id;
      const isFriend = A.user && (A.social.friends || []).some((f) => f.id === r.user.id);
      box.innerHTML = `<div class="profile-page in-sheet">${bodyHtml(r.user, false)}
        ${A.user && !own && !isFriend ? `<div class="row-actions"><button class="btn" data-pv="add" data-tag="${esc(r.user.username)}">Add friend</button></div>` : ''}</div>`;
      box.onclick = async (e) => {
        const b = e.target.closest('[data-pv="add"]');
        if (!b) return;
        b.disabled = true;
        const res = await MS.emit('friend:request', { nickname: b.dataset.tag });
        MS.toast(MS.okOf(res) ? 'Request sent' : (res.error || 'Could not send the request'));
      };
    },
  };
})();
