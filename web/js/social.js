'use strict';
// Social parts of the home hub: open rooms of every mode, the global chat panel and the dev console.
(() => {
  const MS = window.MS;
  const { $, esc } = MS;
  const A = MS.account;
  const MODE_TITLE = { spy: 'Spy', k5: 'Keep 5 Delete 5', koth: 'King of the Hill' };

  // ---------- open rooms ----------
  let rooms = [];
  let roomsTimer = null;
  async function loadRooms() {
    const r = await MS.emit('getOpenLobbies');
    rooms = MS.okOf(r) ? (r.rooms || []) : [];
    const card = $('#roomsCard');
    if (card) card.innerHTML = MS.social.roomsHtml();
  }
  MS.social = {
    roomsHtml() {
      const list = rooms.slice(0, 4);
      return `
        <span class="side-label">Open rooms${rooms.length ? ` <span class="tag">${rooms.length}</span>` : ''}</span>
        ${list.length ? `<ul class="room-list">${list.map((r) => `
          <li><button class="room-row" data-act="joinOpen" data-code="${esc(r.code)}">
            ${r.cover ? `<img src="${esc(r.cover)}" alt="">` : `<i class="room-mode ${esc(r.mode)}">${esc(MODE_TITLE[r.mode].charAt(0))}</i>`}
            <span><b>${esc(r.name)}</b><small>${esc(MODE_TITLE[r.mode])} · ${esc(r.detail || '')}</small></span>
            <em>${r.players}/${r.maxPlayers}</em>
          </button></li>`).join('')}</ul>`
          : '<span class="stub-line">No open rooms right now. Open yours from the lobby and people can join without a code</span>'}`;
    },
    startRooms() {
      clearInterval(roomsTimer);
      loadRooms();
      roomsTimer = setInterval(() => { if (!document.hidden && $('#roomsCard')) loadRooms(); }, 8000);
    },
    stopRooms() { clearInterval(roomsTimer); },
  };

  // ---------- global chat ----------
  let gmsgs = [];
  let gopen = false;
  let panel = null;
  let online = 0;
  MS.socket.on('globalChat:update', ({ messages } = {}) => {
    const before = gmsgs.length;
    gmsgs = messages || [];
    if (panel) renderG(false);
    if (gmsgs.length > before && before && !gopen) badge(true);
    if (gopen && gmsgs.length > before && gmsgs[gmsgs.length - 1] && (!A.user || gmsgs[gmsgs.length - 1].accountId !== A.user.id) && MS.sfx) MS.sfx.play('msg');
  });
  MS.socket.on('siteOnline:update', ({ count } = {}) => {
    online = count || 0;
    const el = panel && panel.querySelector('[data-online]');
    if (el) el.textContent = `${online} online`;
  });
  function badge(show) {
    MS.$$('[data-act="globalChat"]').forEach((b) => b.classList.toggle('has-new', show));
  }

  function gmsgHtml(m) {
    const p = { name: m.playerName, avatar: m.avatar, accountId: m.accountId, id: m.accountId || m.playerId, cosmetics: m.equippedCosmetics || {}, permissions: m.permissions || {} };
    const fx = MS.cos.chatAttrs(p);
    const mine = A.user && m.accountId === A.user.id;
    const who = m.accountId ? `data-act="viewProfile" data-id="${esc(m.accountId)}"` : '';
    return `<div class="msg ${mine ? 'mine' : ''} ${fx.cls}" style="${fx.style}"><button class="msg-face" ${who} aria-label="${esc(m.playerName)}">${MS.avatar(p, 'sm')}</button><p><b>${MS.cos.nick(m.playerName, p)}${MS.cos.levelText(p, m.level) ? `<small class="lvl">${MS.cos.levelText(p, m.level)}</small>` : ''}</b>${esc(m.text)}</p></div>`;
  }

  function renderG(stick) {
    if (!panel) return;
    const list = panel.querySelector('.chat-list');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = gmsgs.length ? gmsgs.map(gmsgHtml).join('') : '<p class="empty-note">Nobody has said anything yet. Start the talk.</p>';
    if (stick || atBottom) list.scrollTop = list.scrollHeight;
    const foot = panel.querySelector('.chat-foot');
    foot.innerHTML = A.user
      ? '<form class="chat-form"><input maxlength="240" placeholder="Message everyone" autocomplete="off" aria-label="Message"><button class="btn small">Send</button></form>'
      : '<div class="chat-guest"><span>Guests can read. Sign in to write</span><button class="btn small" data-gc="signin">Sign in</button></div>';
  }

  MS.gchat = {
    toggle(force) {
      gopen = typeof force === 'boolean' ? force : !gopen;
      if (!gopen) { if (panel) panel.remove(); panel = null; return; }
      badge(false);
      if (MS.chat && MS.chat.isOpen) MS.chat.toggle(false);
      panel = document.createElement('aside');
      panel.className = 'chat global-chat';
      panel.setAttribute('aria-label', 'Global chat');
      panel.innerHTML = `
        <div class="chat-head"><b>Global chat</b><small data-online>${online ? `${online} online` : ''}</small><button class="icon-btn plain" data-gc="close" aria-label="Close the chat">${MS.icon.close}</button></div>
        <div class="chat-list" aria-live="polite"></div>
        <div class="chat-foot"></div>`;
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-gc], [data-act="viewProfile"]');
        if (!b) return;
        if (b.dataset.gc === 'close') MS.gchat.toggle(false);
        else if (b.dataset.gc === 'signin') A.openAccount();
        else MS.profile.open(b.dataset.id);
      });
      panel.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = panel.querySelector('.chat-form input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const r = await MS.emit('globalChat:send', { text });
        if (!MS.okOf(r)) { MS.toast(r.error || 'Message not sent'); input.value = text; }
      });
      document.body.appendChild(panel);
      renderG(true);
      MS.emit('globalChat:get').then((r) => { if (MS.okOf(r)) { gmsgs = r.messages || []; renderG(true); } });
      setTimeout(() => { const i = panel && panel.querySelector('input'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); }, 30);
    },
    get isOpen() { return gopen; },
  };
  A.onChange(() => { if (panel) renderG(false); });

  // ---------- dev console ----------
  const history = [];
  let hpos = 0;
  MS.dev = {
    open() {
      if (!A.user || !A.user.permissions || !A.user.permissions.dev) return;
      const el = MS.sheet.open('dev', {
        title: 'Dev console',
        cls: 'tall',
        body: `<div class="dev-console"><pre class="dev-out" id="devOut">Type -help for the commands.\n</pre>
          <form class="dev-form"><span>&gt;</span><input id="devIn" autocomplete="off" spellcheck="false" aria-label="Command" placeholder="-help"></form></div>`,
      });
      const out = el.querySelector('#devOut');
      const input = el.querySelector('#devIn');
      const print = (text, cls = '') => {
        const line = document.createElement('span');
        line.className = cls;
        line.textContent = `${text}\n`;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
      };
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const command = input.value.trim();
        if (!command) return;
        history.push(command);
        hpos = history.length;
        input.value = '';
        print(`> ${command}`, 'dev-cmd');
        const r = await MS.emit('dev:command', { command });
        if (!MS.okOf(r)) print(r.error || 'Command failed', 'dev-err');
        else (r.output || ['Done']).forEach((l) => print(l));
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' && hpos > 0) { hpos -= 1; input.value = history[hpos]; e.preventDefault(); }
        if (e.key === 'ArrowDown') { hpos = Math.min(history.length, hpos + 1); input.value = history[hpos] || ''; e.preventDefault(); }
      });
      setTimeout(() => input.focus(), 60);
    },
  };
})();
