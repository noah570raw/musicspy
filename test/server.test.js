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

test("playerFromSocket uses fixed account display name over submitted nickname", () => {
  const { playerFromSocket } = require("../server");
  const socket = {
    id: "account-socket",
    data: { user: { id: "user-1", username: "login", displayName: "Profile Nick", avatar: "" } }
  };

  const player = playerFromSocket(socket, "Lobby Nick");

  assert.equal(player.name, "Profile Nick");
  assert.equal(player.accountId, "user-1");
  assert.equal(player.guest, false);
});

test("playerFromSocket keeps guest nickname editable", () => {
  const { playerFromSocket } = require("../server");
  const socket = { id: "guest-socket", data: { user: null } };

  const player = playerFromSocket(socket, "Guest Nick");

  assert.equal(player.name, "Guest Nick");
  assert.equal(player.accountId, null);
  assert.equal(player.guest, true);
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


test("normalizeSettings applies blitz preset and supports one-round games", () => {
  const { normalizeSettings } = require("../server");

  assert.deepEqual(normalizeSettings({ gameMode: "blitz" }), {
    gameMode: "blitz",
    label: "Блиц",
    rounds: 1,
    listenTime: 15,
    spyMode: "auto",
    spyCount: 1,
    anonymousVoting: true,
    votingTime: 30,
    runoffOnTie: false
  });

  assert.equal(normalizeSettings({ rounds: 1 }).rounds, 1);
});

test("normalizeGuess makes theme guesses forgiving", () => {
  const { normalizeGuess } = require("../server");

  assert.equal(normalizeGuess("  Хиты-2021!! "), normalizeGuess("хиты 2021"));
  assert.equal(normalizeGuess("Ёдм электронщина"), "едм электронщина");
});

test("buildThemeGuessOptions returns one correct theme and three decoys", () => {
  const { buildThemeGuessOptions } = require("../server");

  const options = buildThemeGuessOptions("ру хайперпоп");

  assert.equal(options.length, 4);
  assert.equal(options.filter((option) => option.correct).length, 1);
  assert(options.some((option) => option.text === "ру хайперпоп" && option.correct));
  assert.equal(new Set(options.map((option) => option.id)).size, 4);
  assert(options.every((option) => typeof option.text === "string" && option.text.length > 0));
});

test("buildFinalBreakdown exposes vote details and track highlights", () => {
  const { buildFinalBreakdown } = require("../server");
  const lobby = {
    players: [
      { id: "civilian", name: "Мирный" },
      { id: "spy", name: "Шпион" },
      { id: "other", name: "Друг" }
    ],
    spies: ["spy"],
    votes: { civilian: "spy", spy: "other", other: "spy" },
    trackHistory: [
      { id: "track-1", playerName: "Мирный", reactions: { "🔥": 2 } },
      { id: "track-2", playerName: "Шпион", reactions: { "🕵️": 2, "🤔": 1 } }
    ]
  };

  const breakdown = buildFinalBreakdown(lobby, ["spy"], { spy: 2, other: 1 });

  assert.deepEqual(breakdown.topVoted, ["Шпион"]);
  assert.equal(breakdown.topVoteCount, 2);
  assert.equal(breakdown.voteDetails[0].hitSpy, true);
  assert.equal(breakdown.mostSuspiciousTrack.playerName, "Шпион");
  assert.deepEqual(breakdown.reactionTotals, { "🔥": 2, "🕵️": 2, "🤔": 1 });
});

test("host timer helpers pause and clamp an active listening turn", () => {
  const { pauseTurnTimer, adjustTurnTimer } = require("../server");
  const lobby = {
    code: "ROOM2",
    phase: "playing",
    turnStage: "listening",
    timeLeft: 12,
    settings: { listenTime: 30 },
    order: ["host"],
    players: [{ id: "host", name: "Host" }],
    currentTurnIndex: 0,
    currentTrackReactions: {},
    trackHistory: []
  };

  assert.equal(adjustTurnTimer(lobby, -15), 5);
  assert.equal(lobby.timeLeft, 5);
  assert.equal(pauseTurnTimer(lobby), true);
  assert.equal(lobby.turnStage, "paused");
  assert.equal(lobby.pausedTurnStage, "listening");
  assert.equal(adjustTurnTimer(lobby, 400), 300);
});
