'use strict';
// Accounts: session restore, sign-in sheet, profile + stats, friends and room invites.
// Token storage keys match the old site, so people stay signed in after the redesign.
(() => {
  const MS = window.MS;
  const { esc, $, store } = MS;
  const ACCESS_KEY = 'musicspy_auth_access_token';
  const LEGACY_ACCESS_KEY = 'musicspy_auth_token';
  const REFRESH_KEY = 'musicspy_auth_refresh_token';
  const NAME_KEY = 'ms_name';

  const rawGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const rawSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };

  const listeners = new Set();
  const A = (MS.account = {
    user: null,
    social: { friends: [], incomingRequests: [], outgoingRequests: [] },
    ready: false,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get signedIn() { return Boolean(A.user); },
    get guestName() { return store.get(NAME_KEY) || ''; },
    set guestName(v) { store.set(NAME_KEY, String(v || '').trim().slice(0, 18)); },
    displayName() { return A.user ? (A.user.displayName || A.user.username) : A.guestName; },
  });
  const notify = () => listeners.forEach((fn) => { try { fn(A); } catch (err) { console.error(err); } });

  function storeTokens(res) {
    const access = res.accessToken || res.token;
    if (access) rawSet(ACCESS_KEY, access);
    if (res.refreshToken) rawSet(REFRESH_KEY, res.refreshToken);
  }
  function clearTokens() {
    rawSet(ACCESS_KEY, '');
    rawSet(LEGACY_ACCESS_KEY, '');
    rawSet(REFRESH_KEY, '');
  }
  function applyProfile(res) {
    const profile = res && res.profile;
    A.user = profile && profile.user ? profile.user : null;
    if (res && res.social) A.social = res.social;
    notify();
  }

  // After Google / Discord the server redirects back with tokens (or an error) in the query string.
  function consumeOAuthRedirect() {
    const params = new URLSearchParams(location.search);
    const token = params.get('auth_access_token') || params.get('auth_token');
    const refresh = params.get('auth_refresh_token');
    const error = params.get('auth_error');
    if (!token && !refresh && !error) return;
    if (token || refresh) storeTokens({ accessToken: token, refreshToken: refresh });
    ['auth_access_token', 'auth_refresh_token', 'auth_token', 'auth_error'].forEach((k) => params.delete(k));
    const q = params.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}`);
    if (error) setTimeout(() => MS.toast(error), 300);
  }

  A.restore = async () => {
    const access = rawGet(ACCESS_KEY) || rawGet(LEGACY_ACCESS_KEY);
    if (access) {
      const res = await MS.emit('auth:session', { accessToken: access });
      if (MS.okOf(res)) { applyProfile(res); A.ready = true; return; }
    }
    const refresh = rawGet(REFRESH_KEY);
    if (refresh) {
      const res = await MS.emit('auth:refresh', { refreshToken: refresh });
      if (MS.okOf(res)) { storeTokens(res); applyProfile(res); A.ready = true; return; }
      clearTokens();
    }
    // Restores a Google / Discord cookie session if there is one, otherwise stays a guest.
    const res = await MS.emit('auth:guest', { name: A.guestName });
    applyProfile(MS.okOf(res) ? res : null);
    A.ready = true;
  };

  consumeOAuthRedirect();

  MS.socket.on('social:state', (social) => { A.social = social || A.social; notify(); });
  MS.socket.on('profile:updated', (data) => {
    if (data && data.profile && data.profile.user) { A.user = data.profile.user; notify(); }
  });
  MS.socket.on('social:notification', (n) => {
    if (!n) return;
    if (n.type === 'lobby:invite' && n.code) {
      MS.toast(n.message || `Invite to room ${n.code}`, { label: 'Join', run: () => MS.app.joinByCode(n.code) });
    } else if (n.type !== 'dm:new') {
      MS.toast(n.message);
    }
    if (MS.sheet.isOpen('friends')) renderFriends();
  });

  // ---------- account sheet ----------
  function statsHtml(u) {
    const s = u.stats || {};
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
    const k5Avg = s.k5AgreeGames ? `${Math.round(s.k5AgreeSum / s.k5AgreeGames)}%` : '–';
    const tile = (v, label) => `<div class="stat"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
    return `
      <p class="section-label">Spy</p>
      <div class="stats">
        ${tile(s.games || 0, 'Games')}
        ${tile(pct(s.wins || 0, s.games || 0), 'Win rate')}
        ${tile(s.spyWins || 0, 'Wins as spy')}
        ${tile(s.civilianWins || 0, 'Wins as civilian')}
        ${tile(s.bestWinStreak || 0, 'Best streak')}
      </div>
      <p class="section-label">Keep 5 Delete 5</p>
      <div class="stats">
        ${tile(s.k5Games || 0, 'Games')}
        ${tile(s.k5Tracks || 0, 'Tracks judged')}
        ${tile(k5Avg, 'Average match')}
      </div>`;
  }

  function guestHtml(mode) {
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    return `
      <div class="sheet-body">
        <p class="src-sub" style="margin:0">Sign in to keep your stats and add friends. Guests can play without an account.</p>
        <div class="oauth">
          <a class="btn big" href="/auth/google?returnTo=${returnTo}">${MS.icon.google}Continue with Google</a>
          <a class="btn big" href="/auth/discord?returnTo=${returnTo}">${MS.icon.discord}Continue with Discord</a>
        </div>
        <div class="divider"></div>
        <form class="form-grid" data-form="password">
          <p class="section-label">${mode === 'register' ? 'Create an account with a password' : 'Sign in with a username'}</p>
          <input name="username" autocomplete="username" placeholder="Username" maxlength="32" required>
          ${mode === 'register' ? '<input name="displayName" autocomplete="nickname" placeholder="Display name" maxlength="18">' : ''}
          <input name="password" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="Password" maxlength="72" required>
          <div class="row-actions">
            <button class="btn primary">${mode === 'register' ? 'Create account' : 'Sign in'}</button>
            <button class="btn quiet" type="button" data-acct="${mode === 'register' ? 'toLogin' : 'toRegister'}">${mode === 'register' ? 'I have an account' : 'Create an account'}</button>
          </div>
        </form>
      </div>`;
  }

  function profileHtml(u) {
    return `
      <div class="sheet-body">
        <div class="profile-head">${MS.avatar({ ...u, name: u.displayName }, 'lg')}<div><b>${esc(u.displayName || u.username)}</b><small>@${esc(u.username)}</small></div></div>
        ${statsHtml(u)}
        <form class="form-grid" data-form="profile">
          <p class="section-label">Profile</p>
          <label class="field"><span>Display name</span><input name="displayName" maxlength="18" value="${esc(u.displayName || '')}"></label>
          <label class="field"><span>Tag (friends find you by it)</span><input name="username" maxlength="32" value="${esc(u.username || '')}"></label>
          <div class="row-actions"><button class="btn">Save profile</button></div>
        </form>
        <div class="divider"></div>
        <div class="row-actions">
          <button class="btn" type="button" data-acct="logout">Sign out</button>
          <button class="btn quiet danger" type="button" data-acct="delete">Delete account</button>
        </div>
      </div>`;
  }

  let guestMode = 'login';
  function renderAccount() {
    const el = MS.sheet.get('account');
    if (!el) return;
    const content = el.querySelector('.sheet-content');
    content.innerHTML = A.user ? profileHtml(A.user) : guestHtml(guestMode);
    el.querySelector('.sheet-head h2').textContent = A.user ? 'Account' : 'Sign in';
  }

  A.openAccount = () => {
    const el = MS.sheet.open('account', { title: A.user ? 'Account' : 'Sign in', cls: 'narrow' });
    renderAccount();
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form).entries());
      const btn = form.querySelector('button:not([type])');
      if (btn) btn.disabled = true;
      let res;
      if (form.dataset.form === 'password') {
        res = await MS.emit(guestMode === 'register' ? 'auth:register' : 'auth:login', data);
        if (MS.okOf(res)) {
          storeTokens(res);
          applyProfile(res);
          MS.toast(`Signed in as ${A.displayName()}`);
        }
      } else if (form.dataset.form === 'profile') {
        res = await MS.emit('profile:update', { displayName: data.displayName, username: data.username });
        if (MS.okOf(res)) { applyProfile(res); MS.toast('Profile saved'); }
      }
      if (btn) btn.disabled = false;
      if (res && !MS.okOf(res)) MS.toast(res.error || 'Something went wrong');
      else renderAccount();
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-acct]');
      if (!b) return;
      const act = b.dataset.acct;
      if (act === 'toRegister' || act === 'toLogin') {
        guestMode = act === 'toRegister' ? 'register' : 'login';
        renderAccount();
      } else if (act === 'logout') {
        const res = await MS.emit('auth:logout', { refreshToken: rawGet(REFRESH_KEY), accessToken: rawGet(ACCESS_KEY) });
        clearTokens();
        applyProfile(MS.okOf(res) ? res : null);
        A.social = { friends: [], incomingRequests: [], outgoingRequests: [] };
        notify();
        renderAccount();
        MS.toast('Signed out');
      } else if (act === 'delete') {
        if (!confirm('Delete your account and its stats? This cannot be undone.')) return;
        const res = await MS.emit('account:delete', { refreshToken: rawGet(REFRESH_KEY) });
        if (!MS.okOf(res)) return MS.toast(res.error || 'Could not delete the account');
        clearTokens();
        applyProfile(res);
        MS.sheet.close('account');
        MS.toast('Account deleted');
      }
    });
  };
  A.onChange(() => { if (MS.sheet.isOpen('account')) renderAccount(); });

  // ---------- friends sheet ----------
  let inviteTarget = null; // { code } while in a room
  function friendRow(f, actions) {
    const status = f.lobby ? `${f.activity} · ${f.lobby.code}` : f.activity;
    return `
      <li class="friend">
        ${MS.avatar({ ...f, name: f.displayName || f.nickname })}
        <span class="who-text"><b>${esc(f.displayName || f.nickname)}</b><small class="${f.online ? 'on' : ''}">${esc(status || (f.online ? 'Online' : 'Offline'))}</small></span>
        <span class="row-actions">${actions}</span>
      </li>`;
  }

  function renderFriends() {
    const el = MS.sheet.get('friends');
    if (!el) return;
    const content = el.querySelector('.sheet-content');
    if (!A.user) {
      content.innerHTML = `<div class="sheet-body"><p class="src-sub" style="margin:0">Sign in to add friends and invite them to your room.</p><div class="row-actions"><button class="btn primary" data-fr="signin">Sign in</button></div></div>`;
      return;
    }
    const s = A.social || {};
    const friends = [...(s.friends || [])].sort((a, b) => Number(b.online) - Number(a.online));
    const incoming = s.incomingRequests || [];
    const outgoing = s.outgoingRequests || [];
    const myRoom = inviteTarget && inviteTarget.code;
    content.innerHTML = `
      <div class="sheet-body">
        <form class="code-row" data-form="addFriend">
          <input name="nickname" placeholder="Friend's tag" autocomplete="off" spellcheck="false" style="text-transform:none;letter-spacing:normal;font-weight:400;text-align:left">
          <button class="btn">Add friend</button>
        </form>
        <p class="empty-note">Your tag: <b>@${esc(A.user.username)}</b></p>
        ${incoming.length ? `<p class="section-label">Requests</p><ul class="friend-list">${incoming.map((r) => friendRow(r.user, `<button class="btn small" data-fr="accept" data-id="${esc(r.id)}">Accept</button><button class="btn small quiet" data-fr="decline" data-id="${esc(r.id)}">Decline</button>`)).join('')}</ul>` : ''}
        <p class="section-label">Friends</p>
        ${friends.length ? `<ul class="friend-list">${friends.map((f) => {
          const acts = [];
          if (myRoom && f.online) acts.push(`<button class="btn small" data-fr="invite" data-id="${esc(f.id)}">Invite</button>`);
          if (!myRoom && f.lobby && f.lobby.canJoin) acts.push(`<button class="btn small" data-fr="join" data-code="${esc(f.lobby.code)}">Join</button>`);
          acts.push(`<button class="btn small quiet" data-fr="remove" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.displayName || f.nickname)}">Remove</button>`);
          return friendRow(f, acts.join(''));
        }).join('')}</ul>` : '<p class="empty-note">No friends yet. Add someone by their tag.</p>'}
        ${outgoing.length ? `<p class="section-label">Sent</p><ul class="friend-list">${outgoing.map((r) => friendRow(r.user, '<span class="tag">Pending</span>')).join('')}</ul>` : ''}
      </div>`;
  }

  A.openFriends = (opts = {}) => {
    inviteTarget = opts.inviteCode ? { code: opts.inviteCode } : null;
    const el = MS.sheet.open('friends', { title: 'Friends', cls: 'narrow tall' });
    renderFriends();
    if (A.user) MS.emit('social:get').then((res) => { if (res && res.friends) { A.social = res; renderFriends(); } });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const nickname = input.value.trim().replace(/^@/, '');
      if (!nickname) return;
      const res = await MS.emit('friend:request', { nickname });
      if (!MS.okOf(res)) return MS.toast(res.error || 'Could not send the request');
      input.value = '';
      MS.toast('Request sent');
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-fr]');
      if (!b) return;
      const act = b.dataset.fr;
      let res = null;
      if (act === 'signin') { MS.sheet.close('friends'); A.openAccount(); return; }
      if (act === 'accept') res = await MS.emit('friend:accept', { requestId: b.dataset.id });
      if (act === 'decline') res = await MS.emit('friend:decline', { requestId: b.dataset.id });
      if (act === 'remove') {
        if (!confirm('Remove this friend?')) return;
        res = await MS.emit('friend:remove', { friendId: b.dataset.id });
      }
      if (act === 'invite') {
        res = await MS.emit('friend:lobby:invite', { friendId: b.dataset.id, code: inviteTarget && inviteTarget.code });
        if (MS.okOf(res)) { MS.toast('Invite sent'); b.disabled = true; return; }
      }
      if (act === 'join') { MS.sheet.close('friends'); MS.app.joinByCode(b.dataset.code); return; }
      if (res && !MS.okOf(res)) MS.toast(res.error || 'Something went wrong');
    });
  };
  A.onChange(() => { if (MS.sheet.isOpen('friends')) renderFriends(); });

  A.incomingCount = () => ((A.social && A.social.incomingRequests) || []).length;
  A.whoHtml = () => {
    if (A.user) {
      return `${MS.avatar({ ...A.user, name: A.user.displayName })}<span class="who-text"><b>${esc(A.user.displayName || A.user.username)}</b><small>@${esc(A.user.username)}</small></span>`;
    }
    return `${MS.avatar({ name: A.guestName || '?' })}<span class="who-text"><b>${esc(A.guestName || 'Guest')}</b><small>Playing as a guest</small></span>`;
  };
  A.$ = $;
})();
