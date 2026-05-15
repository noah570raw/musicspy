const test = require("node:test");
const assert = require("node:assert/strict");

const { ALLOWED_REACTIONS, countReactions, getActiveTurnOrder, removePlayerFromLobby } = require("../server");

test("getActiveTurnOrder keeps the first-round order for later rounds", () => {
  const lobby = {
    baseOrder: ["player-3", "player-1", "player-2"],
    players: [
      { id: "player-1" },
      { id: "player-2" },
      { id: "player-3" }
    ]
  };

  assert.deepEqual(getActiveTurnOrder(lobby), ["player-3", "player-1", "player-2"]);
});

test("getActiveTurnOrder removes disconnected players without reshuffling survivors", () => {
  const lobby = {
    baseOrder: ["player-2", "player-1", "player-4", "player-3"],
    players: [
      { id: "player-1" },
      { id: "player-2" },
      { id: "player-3" }
    ]
  };

  assert.deepEqual(getActiveTurnOrder(lobby), ["player-2", "player-1", "player-3"]);
});
test("removePlayerFromLobby clears a kicked player from game state", () => {
  const lobby = {
    players: [{ id: "host" }, { id: "kicked" }, { id: "next" }],
    order: ["host", "kicked", "next"],
    baseOrder: ["host", "kicked", "next"],
    spies: ["kicked"],
    voteCandidates: ["host", "kicked", "next"],
    votes: { host: "kicked", kicked: "next" },
    currentTurnIndex: 2
  };

  const removedIndex = removePlayerFromLobby(lobby, "kicked");

  assert.equal(removedIndex, 1);
  assert.deepEqual(lobby.players, [{ id: "host" }, { id: "next" }]);
  assert.deepEqual(lobby.order, ["host", "next"]);
  assert.deepEqual(lobby.baseOrder, ["host", "next"]);
  assert.deepEqual(lobby.spies, []);
  assert.deepEqual(lobby.voteCandidates, ["host", "next"]);
  assert.deepEqual(lobby.votes, {});
  assert.equal(lobby.currentTurnIndex, 1);
});


test("countReactions aggregates only allowed reactions", () => {
  const [fire, heart, laugh] = ALLOWED_REACTIONS;

  assert.deepEqual(countReactions({
    player1: fire,
    player2: heart,
    player3: fire,
    player4: "invalid",
    player5: laugh
  }), {
    [fire]: 2,
    [heart]: 1,
    [laugh]: 1
  });
});

test("removePlayerFromLobby removes current track reaction and syncs history", () => {
  const [fire, heart] = ALLOWED_REACTIONS;
  const lobby = {
    players: [{ id: "host" }, { id: "kicked" }, { id: "next" }],
    order: ["host", "kicked", "next"],
    baseOrder: ["host", "kicked", "next"],
    spies: [],
    voteCandidates: ["host", "kicked", "next"],
    votes: {},
    currentTurnIndex: 1,
    lastTrack: { id: "track-1" },
    currentTrackReactions: { host: fire, kicked: heart },
    trackHistory: [{ id: "track-1", reactions: {} }]
  };

  removePlayerFromLobby(lobby, "kicked");

  assert.deepEqual(lobby.currentTrackReactions, { host: fire });
  assert.deepEqual(lobby.trackHistory[0].reactions, { [fire]: 1 });
});


test("resolveDataDir prefers persistent deployment storage over repo data", () => {
  const { resolveDataDir } = require("../server");
  const fakeFs = {
    existsSync(file) {
      return file === "/var/data";
    }
  };

  assert.equal(resolveDataDir({}, fakeFs), "/var/data/musicspy");
  assert.equal(resolveDataDir({ MUSICSPY_DATA_DIR: "/tmp/custom-users" }, fakeFs), "/tmp/custom-users");
});

test("account helpers normalize usernames and verify password hashes", () => {
  const { normalizeUsername, hashPassword, verifyPassword } = require("../server");
  const user = hashPassword("secret-password");

  assert.equal(normalizeUsername("  User.Name!!__  "), "username__");
  assert.equal(verifyPassword("secret-password", { salt: user.salt, passwordHash: user.hash }), true);
  assert.equal(verifyPassword("bad-password", { salt: user.salt, passwordHash: user.hash }), false);
});

test("normalizeAvatar accepts small image data urls and rejects oversized avatars", () => {
  const { normalizeAvatar } = require("../server");
  const avatar = `data:image/png;base64,${Buffer.from("tiny").toString("base64")}`;
  const oversized = `data:image/png;base64,${"a".repeat(70 * 1024)}`;

  assert.equal(normalizeAvatar(avatar), avatar);
  assert.throws(() => normalizeAvatar("https://example.com/avatar.png"), /Поддерживаются/);
  assert.throws(() => normalizeAvatar(oversized), /слишком большая/);
});

test("handlePlayerDeparture lets a waiting lobby member leave and reassigns host", () => {
  const { handlePlayerDeparture } = require("../server");
  const leftRooms = [];
  const lobby = {
    code: "ROOM1",
    host: "host",
    phase: "lobby",
    players: [{ id: "host" }, { id: "guest" }],
    order: [],
    baseOrder: [],
    spies: [],
    voteCandidates: [],
    votes: {},
    currentTurnIndex: 0
  };

  const result = handlePlayerDeparture(lobby, { id: "host", leave: (room) => leftRooms.push(room) });

  assert.deepEqual(leftRooms, ["ROOM1"]);
  assert.equal(result.deleted, false);
  assert.equal(lobby.host, "guest");
  assert.deepEqual(lobby.players, [{ id: "guest" }]);
});
