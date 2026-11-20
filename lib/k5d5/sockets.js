"use strict";
// Room games over Socket.IO: Keep 5 Delete 5 (prefix "k5") and King of the Hill (prefix "koth").
// Both game modules share the same room API (createRoom, joinRoom, action, viewFor, ...).
// Events below are shown with the "k5" prefix.
//
// Client -> server (all with an ack callback):
//   k5:create { name }                      -> { ok, code, pid, token }
//   k5:join   { code, name, pid?, token? }  -> { ok, code, pid, token }   (pid+token = reconnect)
//   k5:action { type, payload }             -> { ok, ... } | { ok: false, error }
//   k5:leave  {}                            -> { ok }
// Server -> client:
//   k5:state  { now, state }   the room as this player sees it (game.viewFor)
//   k5:kicked {}               this player is no longer in the room

function registerRoomSockets(io, { game, deezer, isCodeTaken, getAccount, onFinish, onPresence, decorate, prefix = "k5" }) {
  const ev = (name) => `${prefix}:${name}`;
  // room code -> Map(pid -> socket)
  const streams = new Map();

  function broadcast(room) {
    const map = streams.get(room.code);
    if (!map) return;
    const now = Date.now();
    for (const [pid, socket] of map) {
      if (!room.players.has(pid)) {
        socket.emit(ev("kicked"), {});
        if (socket.data[prefix] && socket.data[prefix].pid === pid) socket.data[prefix] = null;
        map.delete(pid);
        continue;
      }
      socket.emit(ev("state"), { now, state: game.viewFor(room, pid) });
    }
    if (!map.size) streams.delete(room.code);
  }

  game.init({ deezer, onChange: broadcast, isCodeTaken, onFinish, decorate });

  function detach(socket) {
    const link = socket.data[prefix];
    if (!link) return;
    socket.data[prefix] = null;
    socket.leave(ev(link.code));
    const map = streams.get(link.code);
    if (map && map.get(link.pid) === socket) {
      map.delete(link.pid);
      if (!map.size) streams.delete(link.code);
      const room = game.findRoom(link.code);
      if (room) game.setConnected(room, link.pid, false);
    }
    if (onPresence) onPresence(socket);
  }

  function attach(socket, { code, pid, token }) {
    if (socket.data[prefix] && (socket.data[prefix].code !== code || socket.data[prefix].pid !== pid)) detach(socket);
    socket.data[prefix] = { code, pid, token };
    socket.join(ev(code));
    if (!streams.has(code)) streams.set(code, new Map());
    const map = streams.get(code);
    const old = map.get(pid);
    if (old && old !== socket) {
      old.data[prefix] = null;
      old.leave(ev(code));
    }
    map.set(pid, socket);
    const room = game.findRoom(code);
    if (room) game.setConnected(room, pid, true);
    if (onPresence) onPresence(socket);
  }

  const fail = (cb, err) => {
    if (err instanceof game.GameError) return cb({ ok: false, error: err.message });
    console.error(`[${prefix}]`, err);
    return cb({ ok: false, error: "Something went wrong" });
  };

  io.on("connection", (socket) => {
    socket.on(ev("create"), ({ name } = {}, cb = () => {}) => {
      try {
        const account = getAccount(socket);
        const res = game.createRoom(account ? account.name : name, account || {});
        // ack first, then attach: attaching broadcasts k5:state, which must arrive after the ack
        cb({ ok: true, ...res });
        attach(socket, res);
      } catch (err) {
        fail(cb, err);
      }
    });

    socket.on(ev("join"), ({ code, name, pid, token } = {}, cb = () => {}) => {
      try {
        const account = getAccount(socket);
        const res = game.joinRoom({
          code,
          name: account ? account.name : name,
          pid,
          token,
          accountId: account ? account.accountId : null,
          avatar: account ? account.avatar : "",
        });
        cb({ ok: true, ...res });
        attach(socket, res);
      } catch (err) {
        fail(cb, err);
      }
    });

    socket.on(ev("action"), async ({ type, payload } = {}, cb = () => {}) => {
      const link = socket.data[prefix];
      if (!link) return cb({ ok: false, error: "Join the room again" });
      try {
        const result = await game.action(link.code, link.pid, link.token, type, payload || {});
        if (type === "leave") detach(socket);
        cb({ ok: true, ...result });
      } catch (err) {
        fail(cb, err);
      }
    });

    socket.on(ev("leave"), async (_ = {}, cb = () => {}) => {
      const link = socket.data[prefix];
      if (!link) return cb({ ok: true });
      try {
        await game.action(link.code, link.pid, link.token, "leave");
      } catch { /* room already gone */ }
      detach(socket);
      cb({ ok: true });
    });

    socket.on("disconnect", () => detach(socket));
  });

  return { broadcast };
}

module.exports = { registerRoomSockets, registerK5d5Sockets: registerRoomSockets };
