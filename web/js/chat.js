'use strict';
// Room chat for both modes. A panel on the right (a sheet on phones), hidden behind the Chat button.
(() => {
  const MS = window.MS;
  const { esc } = MS;
  const OPEN_KEY = 'ms_chat_open';

  let source = null; // { roomKey, messages, meId, players, send }
  let open = MS.store.get(OPEN_KEY) === true;
  let seenCount = 0;
  let seenRoom = '';
  let panel = null;

  function unread() {
    if (!source || open) return 0;
    const fresh = source.messages.slice(seenCount);
    return fresh.filter((m) => m.playerId !== source.meId).length;
  }

  function updateButtons() {
    const n = unread();
    MS.$$('[data-act="toggleChat"]').forEach((b) => {
      b.setAttribute('aria-pressed', open ? 'true' : 'false');
      let badge = b.querySelector('.badge');
      if (n && !badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        b.appendChild(badge);
      }
      if (badge) {
        if (n) badge.textContent = n > 9 ? '9+' : String(n);
        else badge.remove();
      }
    });
  }

  function msgHtml(m) {
    const player = (source.players || []).find((p) => p.id === m.playerId) || { name: m.playerName, id: m.playerId, color: m.color };
    const p = { ...player, name: m.playerName };
    const fx = MS.cos.chatAttrs(p);
    const face = p.accountId ? `<button class="msg-face" data-act="viewProfile" data-id="${esc(p.accountId)}" aria-label="${esc(p.name)}">${MS.avatar(p, 'sm')}</button>` : MS.avatar(p, 'sm');
    return `<div class="msg ${m.playerId === source.meId ? 'mine' : ''} ${fx.cls}" style="${fx.style}">${face}<p><b>${MS.cos.nick(m.playerName, p)}</b>${esc(m.text)}</p></div>`;
  }

  function renderList(stick) {
    if (!panel || !source) return;
    const list = panel.querySelector('.chat-list');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = source.messages.length ? source.messages.map(msgHtml).join('') : '<p class="empty-note">No messages yet. Say hi.</p>';
    if (stick || atBottom) list.scrollTop = list.scrollHeight;
  }

  function mountPanel() {
    if (panel || !source) return;
    panel = document.createElement('aside');
    panel.className = 'chat';
    panel.setAttribute('aria-label', 'Room chat');
    panel.innerHTML = `
      <div class="chat-head"><b>Chat</b><button class="icon-btn plain" data-chat="close" aria-label="Hide chat">${MS.icon.close}</button></div>
      <div class="chat-list" aria-live="polite"></div>
      <form class="chat-form"><input maxlength="240" placeholder="Message" autocomplete="off" aria-label="Message"><button class="btn small">Send</button></form>`;
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-chat="close"]')) MS.chat.toggle(false);
      const who = e.target.closest('[data-act="viewProfile"]');
      if (who) MS.profile.open(who.dataset.id);
    });
    panel.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = panel.querySelector('input');
      const text = input.value.trim();
      if (!text || !source) return;
      input.value = '';
      const res = await source.send(text);
      if (res && !MS.okOf(res)) {
        MS.toast(res.error || 'Message not sent');
        input.value = text;
      }
    });
    document.body.appendChild(panel);
    renderList(true);
    setTimeout(() => { const i = panel && panel.querySelector('input'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); }, 30);
  }

  function unmountPanel() {
    if (panel) panel.remove();
    panel = null;
  }

  MS.chat = {
    buttonHtml: () => `<button class="icon-btn" data-act="toggleChat" aria-label="Chat" aria-pressed="${open}">${MS.icon.chat}</button>`,
    setSource(next) {
      if (!next) {
        source = null;
        unmountPanel();
        return;
      }
      const roomChanged = next.roomKey !== seenRoom;
      source = next;
      if (!roomChanged && open && next.messages.length > (source ? seenCount : 0)) {
        const last = next.messages[next.messages.length - 1];
        if (last && last.playerId !== next.meId && MS.sfx) MS.sfx.play('msg');
      }
      if (roomChanged) {
        seenRoom = next.roomKey;
        seenCount = open ? next.messages.length : Math.max(0, next.messages.length - 0);
        if (!open) seenCount = next.messages.length;
      }
      if (open) {
        seenCount = next.messages.length;
        if (!panel) mountPanel();
        else renderList(false);
      }
      updateButtons();
    },
    toggle(force) {
      open = typeof force === 'boolean' ? force : !open;
      MS.store.set(OPEN_KEY, open);
      if (open && source) {
        seenCount = source.messages.length;
        mountPanel();
      } else unmountPanel();
      updateButtons();
    },
    refreshButtons: updateButtons,
    get isOpen() { return open; },
  };
})();
