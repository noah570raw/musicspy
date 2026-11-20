'use strict';
// Leaderboard page (home hub): categories for all three modes, the top 25, and your own place even outside the top.
(() => {
  const MS = window.MS;
  const { esc } = MS;
  const A = MS.account;
  const ui = { cat: 'games', data: null, loading: false, seq: 0 };
  let root = null;

  async function load() {
    const seq = ++ui.seq;
    ui.loading = true;
    render();
    const r = await MS.emit('leaderboard:get', { category: ui.cat, limit: 25 });
    if (seq !== ui.seq) return;
    ui.loading = false;
    ui.data = MS.okOf(r) ? r : null;
    render();
  }

  function row(e, mine) {
    const p = { ...e, name: e.displayName, id: e.accountId };
    return `
      <li class="lb-row ${mine ? 'me' : ''} ${e.rank <= 3 ? `top top${e.rank}` : ''}" data-act="viewProfile" data-id="${esc(e.accountId)}" tabindex="0">
        <span class="lb-rank">${e.rank}</span>
        ${MS.avatar(p, 'sm')}
        <span class="lb-name"><b>${MS.cos.nick(e.displayName, p)}</b><small>@${esc(e.username || '')}${e.level ? ` · level ${MS.cos.levelText(p, e.level)}` : ''}</small></span>
        <span class="lb-value"><b>${esc(e.value)}</b>${e.meta ? `<small>${esc(e.meta)}</small>` : ''}</span>
      </li>`;
  }

  function render() {
    if (!root) return;
    const d = ui.data;
    const cats = (d && d.categories) || [{ id: 'games', label: 'Spy games' }];
    const entries = (d && d.entries) || [];
    const me = d && d.me;
    const meShown = me && entries.some((x) => x.accountId === me.accountId);
    let list;
    if (ui.loading && !d) list = Array.from({ length: 6 }, () => '<li class="lb-row ghost"><span></span><i></i><span></span></li>').join('');
    else if (!entries.length) list = '<li class="empty-note">Nobody here yet. Play a game and take first place.</li>';
    else list = entries.map((e) => row(e, A.user && e.accountId === A.user.id)).join('');
    root.innerHTML = `
      <div class="page-head">
        <div><p class="kicker"><span>Signed-in players</span></p><h1 class="page-title">Leaderboard</h1></div>
      </div>
      <div class="chips lb-cats">${cats.map((c) => `<button class="chip-btn ${ui.cat === c.id ? 'active' : ''}" data-lb="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>
      <ol class="lb-list ${ui.loading ? 'loading' : ''}">${list}</ol>
      ${me && !meShown ? `<p class="section-label">Your place</p><ol class="lb-list">${row(me, true)}</ol>` : ''}
      ${!A.user ? '<p class="empty-note">Sign in to get on the board.</p>' : ''}`;
  }

  function onClick(e) {
    const b = e.target.closest('[data-lb]');
    if (!b) return;
    ui.cat = b.dataset.lb;
    load();
  }

  MS.pages = MS.pages || {};
  MS.pages.leaderboard = {
    title: 'Leaderboard',
    mount(el) {
      root = el;
      root.addEventListener('click', onClick);
      render();
      load();
    },
    unmount() { if (root) root.removeEventListener('click', onClick); root = null; },
  };
})();
