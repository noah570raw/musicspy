'use strict';
// Shop page (home hub, "Shop" tab): items by category, your collection, a live preview of you wearing the item
// you are looking at, two-step buying (Buy -> Confirm) and equipping. Guests can browse; buying asks to sign in.
(() => {
  const MS = window.MS;
  const { $, esc } = MS;
  const A = MS.account;
  const PAGE = 6; // items per page
  const ui = { tab: 'shop', cat: 'nicknameColor', page: 0, trying: null, confirm: null, confirmTimer: null };
  let root = null;

  const isDev = () => Boolean(A.user && A.user.permissions && A.user.permissions.dev);
  const owned = () => new Set((A.user && A.user.economy && A.user.economy.ownedCosmetics) || []);
  const equipped = () => (A.user && A.user.economy && A.user.economy.equipped) || {};
  const slotOf = (cat) => (MS.cos.categories.find((c) => c.id === cat) || {}).equipSlot || cat;
  const CAT_LABEL = { nicknameColor: 'Nickname colours', avatarFrame: 'Avatar frames', profileBanner: 'Profile banners', chatEffect: 'Chat effects', lobbyEffect: 'Lobby effects', playerTitle: 'Titles' };
  const CAT_HINT = {
    nicknameColor: 'Paints your name in rooms, chats, the leaderboard and your profile.',
    avatarFrame: 'A ring around your avatar everywhere it shows.',
    profileBanner: 'The banner of your profile and your player card.',
    chatEffect: 'The look of your messages in room chat and global chat.',
    lobbyEffect: 'Your card in the lobby player list and on your profile.',
    playerTitle: 'A line under your name on your profile. Titles come from achievements.',
  };

  function items() {
    // cheapest and most common first: by rarity, then by price (DEV items last)
    const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4, developer: 5 };
    const all = [...MS.cos.items.values()]
      .filter((it) => it.category === ui.cat)
      .sort((a, b) => ((RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9)) || ((a.price || 0) - (b.price || 0)) || a.name.localeCompare(b.name));
    const mine = owned();
    if (ui.tab === 'mine') return all.filter((it) => mine.has(it.id));
    return all.filter((it) => !it.hidden && !it.achievementOnly && (!it.devOnly || isDev()));
  }

  function previewSelf() {
    const base = A.user ? { ...A.user, name: A.user.displayName || A.user.username } : { name: A.guestName || 'You' };
    const eq = { ...equipped() };
    if (ui.trying) {
      const it = MS.cos.item(ui.trying);
      if (it) eq[slotOf(it.category)] = it.id;
    }
    const p = { ...base, cosmetics: eq, economy: undefined };
    const lob = MS.cos.lobbyAttrs(p);
    const chat = MS.cos.chatAttrs(p);
    const banner = MS.cos.banner(p);
    return `
      <div class="try-card">
        <div class="try-banner" style="${banner ? `background:${banner}` : ''}"></div>
        <div class="try-main">${MS.avatar(p, 'lg')}<div><b>${MS.cos.nick(p.name, p)}</b>${MS.cos.title(p) || `<small>${A.user ? `@${esc(A.user.username)}` : 'Guest'}</small>`}</div></div>
        <div class="try-rows">
          <span class="lfx-card ${lob.cls}" style="${lob.style}">${MS.avatar(p, 'sm')}<b>${MS.cos.nick(p.name, p)}</b><small>in a lobby</small></span>
          <span class="msg ${chat.cls}" style="${chat.style}">${MS.avatar(p, 'sm')}<p><b>${MS.cos.nick(p.name, p)}</b>that track was a giveaway</p></span>
        </div>
        ${ui.trying ? `<p class="try-note">Trying on ${esc((MS.cos.item(ui.trying) || {}).name || '')}. <button class="text-btn" data-shop="untry">Stop</button></p>` : '<p class="try-note">Tap an item to try it on</p>'}
      </div>`;
  }

  function card(it) {
    const mine = owned().has(it.id);
    const worn = equipped()[slotOf(it.category)] === it.id;
    const r = MS.cos.rarity(it.rarity);
    let action;
    if (worn) action = `<button class="btn small" data-shop="unequip" data-slot="${esc(slotOf(it.category))}">Equipped</button>`;
    else if (mine) action = `<button class="btn small primary" data-shop="equip" data-id="${esc(it.id)}">Equip</button>`;
    else if (it.achievementOnly) action = '<span class="tag">Achievement</span>';
    else if (ui.confirm === it.id) action = `<button class="btn small primary" data-shop="buy" data-id="${esc(it.id)}">Confirm ${MS.econ.fmt(it.price)}</button>`;
    else {
      const short = A.user && !isDev() && MS.econ.vinyls() < it.price;
      action = `<button class="btn small ${short ? 'short' : ''}" data-shop="ask" data-id="${esc(it.id)}">${MS.econ.coin()}${MS.econ.fmt(it.price)}</button>`;
    }
    return `
      <article class="shop-item ${ui.trying === it.id ? 'trying' : ''} ${worn ? 'worn' : ''}" data-shop="try" data-id="${esc(it.id)}">
        ${MS.cos.preview(it.id, it.category)}
        <div class="shop-meta"><b>${esc(it.name.replace(/^DEV /, ''))}</b><small style="--r:${r.color}" class="rarity">${esc(r.label)}</small></div>
        <div class="shop-act">${action}</div>
      </article>`;
  }

  function render() {
    if (!root) return;
    if (!MS.cos.loaded) {
      root.innerHTML = '<div class="center-screen"><div class="spinner"></div><p>Opening the shop</p></div>';
      return;
    }
    const cats = ['nicknameColor', 'avatarFrame', 'profileBanner', 'chatEffect', 'lobbyEffect'].concat(ui.tab === 'mine' ? ['playerTitle'] : []);
    if (!cats.includes(ui.cat)) ui.cat = cats[0];
    const all = items();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    ui.page = Math.min(ui.page, pages - 1);
    const list = all.slice(ui.page * PAGE, ui.page * PAGE + PAGE);
    const mineCount = owned().size;
    root.innerHTML = `
      <div class="page-head">
        <div><p class="kicker"><span>Spend Vinyls you win in Spy</span></p><h1 class="page-title">Shop</h1></div>
        <div class="page-head-right">
          <div class="tabs" role="tablist">
            <button class="${ui.tab === 'shop' ? 'active' : ''}" data-shop="tab" data-v="shop" role="tab" aria-selected="${ui.tab === 'shop'}">Shop</button>
            <button class="${ui.tab === 'mine' ? 'active' : ''}" data-shop="tab" data-v="mine" role="tab" aria-selected="${ui.tab === 'mine'}">My items${A.user ? ` · ${mineCount}` : ''}</button>
          </div>
          <button class="pill" data-act="wallet">${MS.econ.coin()}<b data-vinyls>${A.user ? MS.econ.fmt(MS.econ.vinyls()) : '0'}</b></button>
        </div>
      </div>
      <div class="shop-layout">
        <aside class="shop-side">${previewSelf()}</aside>
        <section class="shop-main">
          <div class="chips" role="tablist">${cats.map((c) => `<button class="chip-btn ${ui.cat === c ? 'active' : ''}" data-shop="cat" data-v="${c}">${CAT_LABEL[c]}</button>`).join('')}</div>
          <p class="cat-hint">${esc(CAT_HINT[ui.cat] || '')}</p>
          <div class="shop-grid">${list.length ? list.map(card).join('') : `<p class="empty-note">${ui.tab === 'mine' ? (A.user ? 'Nothing here yet. Buy something in the shop.' : 'Sign in to see your items.') : 'Nothing here.'}</p>`}</div>
          ${pages > 1 ? `<nav class="pager" aria-label="Pages">
            <button class="icon-btn" data-shop="page" data-v="${ui.page - 1}" ${ui.page === 0 ? 'disabled' : ''} aria-label="Previous page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
            <span class="pager-dots">${Array.from({ length: pages }, (_, i) => `<button class="${i === ui.page ? 'on' : ''}" data-shop="page" data-v="${i}" aria-label="Page ${i + 1}" ${i === ui.page ? 'aria-current="page"' : ''}></button>`).join('')}</span>
            <span class="pager-num">${ui.page + 1} / ${pages}</span>
            <button class="icon-btn" data-shop="page" data-v="${ui.page + 1}" ${ui.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
          </nav>` : ''}
        </section>
      </div>`;
  }

  async function onClick(e) {
    const b = e.target.closest('[data-shop]');
    if (!b) return;
    const act = b.dataset.shop;
    const id = b.dataset.id;
    if (act === 'tab') { ui.tab = b.dataset.v; ui.trying = null; ui.page = 0; return render(); }
    if (act === 'cat') { ui.cat = b.dataset.v; ui.page = 0; return render(); }
    if (act === 'page') {
      ui.page = Math.max(0, Number(b.dataset.v) || 0);
      if (MS.sfx) MS.sfx.play('tap');
      return render();
    }
    if (act === 'untry') { ui.trying = null; return render(); }
    if (act === 'try') {
      ui.trying = ui.trying === id ? null : id;
      if (MS.sfx) MS.sfx.play('tap');
      return render();
    }
    e.stopPropagation();
    if (!A.user) { MS.toast('Sign in to get items'); A.openAccount(); return; }
    if (act === 'ask') {
      const it = MS.cos.item(id);
      if (!isDev() && MS.econ.vinyls() < it.price) { MS.toast(`You need ${MS.econ.fmt(it.price - MS.econ.vinyls())} more Vinyls. Win some Spy games`); return; }
      ui.confirm = id;
      ui.trying = id;
      clearTimeout(ui.confirmTimer);
      ui.confirmTimer = setTimeout(() => { ui.confirm = null; render(); }, 4000);
      return render();
    }
    b.disabled = true;
    let r;
    if (act === 'buy') r = await MS.emit('shop:purchase', { itemId: id });
    if (act === 'equip') r = await MS.emit('shop:equip', { itemId: id });
    if (act === 'unequip') r = await MS.emit('shop:unequip', { slot: b.dataset.slot });
    if (!MS.okOf(r)) { b.disabled = false; MS.toast((r && r.error) || 'Something went wrong'); return; }
    if (r.profile && r.profile.user) A.user = r.profile.user;
    if (act === 'buy') {
      ui.confirm = null;
      if (MS.sfx) MS.sfx.play('buy');
      MS.toast(`${(MS.cos.item(id) || {}).name || 'Item'} is yours. Equip it when you like`);
    } else if (MS.sfx) MS.sfx.play('tap');
    if (act === 'equip') ui.trying = null;
    render();
  }

  MS.pages = MS.pages || {};
  MS.pages.shop = {
    title: 'Shop',
    mount(el, opts = {}) {
      root = el;
      if (opts.tab) ui.tab = opts.tab;
      if (opts.cat) { ui.cat = opts.cat; ui.page = 0; }
      root.addEventListener('click', onClick);
      render();
    },
    unmount() { if (root) root.removeEventListener('click', onClick); root = null; },
    refresh: render,
  };
  MS.cos.onLoad(() => render());
  A.onChange(() => render());
})();
