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


test("OAuth helpers normalize provider profiles and preserve return URLs", () => {
  const { normalizeOAuthProfile, buildOAuthSuccessRedirect, buildOAuthErrorRedirect } = require("../server");

  assert.deepEqual(normalizeOAuthProfile("google", {
    sub: "google-1",
    email: "Player@Example.com",
    name: "Google Player",
    picture: "https://example.com/avatar.png"
  }), {
    providerId: "google-1",
    email: "Player@Example.com",
    username: "Player",
    displayName: "Google Player",
    avatar: "https://example.com/avatar.png"
  });

  const discord = normalizeOAuthProfile("discord", { id: "42", username: "beatspy", global_name: "Beat Spy", avatar: "abc" });
  assert.equal(discord.providerId, "42");
  assert.equal(discord.displayName, "Beat Spy");
  assert.equal(discord.avatar, "https://cdn.discordapp.com/avatars/42/abc.png?size=128");

  assert.equal(buildOAuthSuccessRedirect("/room?code=ABC", "token-1"), "/room?code=ABC&auth_token=token-1");
  assert.equal(buildOAuthErrorRedirect("https://evil.example/path", "nope"), "/path?auth_error=nope");
});

test("OAuth token requests use provider-specific client authentication", () => {
  const { buildOAuthTokenRequest } = require("../server");

  const discordRequest = buildOAuthTokenRequest({
    clientId: "discord-client",
    clientSecret: "discord-secret",
    redirectUri: "https://musicspy.onrender.com/auth/discord/callback",
    tokenAuthStyle: "basic"
  }, "discord-code");

  assert.equal(discordRequest.method, "POST");
  assert.equal(discordRequest.headers.Authorization, `Basic ${Buffer.from("discord-client:discord-secret").toString("base64")}`);
  assert.equal(discordRequest.body.get("grant_type"), "authorization_code");
  assert.equal(discordRequest.body.get("code"), "discord-code");
  assert.equal(discordRequest.body.get("client_id"), null);
  assert.equal(discordRequest.body.get("client_secret"), null);

  const googleRequest = buildOAuthTokenRequest({
    clientId: "google-client",
    clientSecret: "google-secret",
    redirectUri: "https://musicspy.onrender.com/auth/google/callback",
    tokenAuthStyle: "body"
  }, "google-code");

  assert.equal(googleRequest.headers.Authorization, undefined);
  assert.equal(googleRequest.body.get("client_id"), "google-client");
  assert.equal(googleRequest.body.get("client_secret"), "google-secret");
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
    runoffOnTie: false,
    maxPlayers: 9
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
test("markAllPlayersReady lets host force everybody ready before launch", () => {
  const { markAllPlayersReady } = require("../server");
  const lobby = {
    players: [
      { id: "host", ready: false },
      { id: "guest-1", ready: true },
      { id: "guest-2", ready: false }
    ]
  };

  markAllPlayersReady(lobby);

  assert.deepEqual(lobby.players.map((player) => player.ready), [true, true, true]);
});

test("initializeGame starts immediately after forced readiness", () => {
  const { initializeGame, markAllPlayersReady } = require("../server");
  const lobby = {
    code: "FORCE",
    players: [
      { id: "host", ready: false },
      { id: "guest-1", ready: false },
      { id: "guest-2", ready: false }
    ],
    settings: { rounds: 3, listenTime: 30, spyMode: "auto", spyCount: 1 },
    votes: { host: "guest-1" },
    trackHistory: [{ id: "old-track" }],
    chatMessages: [{ text: "old" }]
  };

  markAllPlayersReady(lobby);
  initializeGame(lobby);

  assert.equal(lobby.started, true);
  assert.equal(lobby.phase, "playing");
  assert.equal(lobby.round, 1);
  assert.equal(lobby.spies.length, 1);
  assert.equal(lobby.order.length, 3);
  assert.equal(lobby.players.every((player) => player.ready), true);
  assert.deepEqual(lobby.votes, {});
  assert.deepEqual(lobby.trackHistory, []);
  assert.deepEqual(lobby.chatMessages, []);
});


test("normalizeSettings clamps lobby max players to host choices", () => {
  const { normalizeSettings } = require("../server");

  assert.equal(normalizeSettings({ maxPlayers: 3 }).maxPlayers, 3);
  assert.equal(normalizeSettings({ maxPlayers: 6 }).maxPlayers, 6);
  assert.equal(normalizeSettings({ maxPlayers: 9 }).maxPlayers, 9);
  assert.equal(normalizeSettings({ maxPlayers: 10 }).maxPlayers, 9);
});

test("createLobbyState applies host settings before players can join", () => {
  const { createLobbyState } = require("../server");

  const lobby = createLobbyState("SETUP", "host", { id: "host", name: "Мотя" }, {
    name: "Ночной сет",
    isOpen: false,
    settings: {
      gameMode: "blitz",
      rounds: 5,
      listenTime: 60,
      spyMode: "manual",
      spyCount: 2,
      anonymousVoting: false,
      votingTime: 90,
      runoffOnTie: true,
      maxPlayers: 5
    }
  });

  assert.equal(lobby.name, "Ночной сет");
  assert.equal(lobby.isOpen, false);
  assert.equal(lobby.phase, "lobby");
  assert.equal(lobby.settings.gameMode, "blitz");
  assert.equal(lobby.settings.rounds, 5);
  assert.equal(lobby.settings.listenTime, 60);
  assert.equal(lobby.settings.spyMode, "manual");
  assert.equal(lobby.settings.spyCount, 2);
  assert.equal(lobby.settings.votingTime, 90);
  assert.equal(lobby.settings.maxPlayers, 5);
});

test("publicOpenLobbies lists only waiting public rooms", () => {
  const { publicOpenLobbies } = require("../server");
  const lobbies = {
    OPEN1: {
      code: "OPEN1",
      host: "host-1",
      phase: "lobby",
      started: false,
      name: "Ночной плейлист",
      isOpen: true,
      createdAt: "2026-01-01T10:00:00.000Z",
      players: [{ id: "host-1", name: "Мотя" }, { id: "guest", name: "Лена" }],
      settings: { gameMode: "classic", rounds: 3, listenTime: 30, maxPlayers: 8 }
    },
    CLOSED1: {
      code: "CLOSED1",
      name: "Закрытая",
      isOpen: false,
      host: "host-3",
      phase: "lobby",
      started: false,
      createdAt: "2026-01-01T12:00:00.000Z",
      players: [{ id: "host-3", name: "Тихо" }],
      settings: { gameMode: "classic", rounds: 3, listenTime: 30 }
    },
    PLAY1: {
      code: "PLAY1",
      host: "host-2",
      phase: "playing",
      started: true,
      createdAt: "2026-01-01T11:00:00.000Z",
      players: [{ id: "host-2", name: "Играет" }],
      settings: { gameMode: "blitz", rounds: 1, listenTime: 15 }
    }
  };

  assert.deepEqual(publicOpenLobbies(lobbies), [{
    code: "OPEN1",
    name: "Ночной плейлист",
    hostName: "Мотя",
    playerCount: 2,
    gameMode: "classic",
    modeLabel: "Классика",
    rounds: 3,
    listenTime: 30,
    maxPlayers: 8,
    createdAt: "2026-01-01T10:00:00.000Z"
  }]);
});

test("persistence normalizes missing social collections and writes atomically", () => {
  const { createUserStorePersistence } = require("../lib/persistence");
  const files = new Map();
  const mkdirs = [];
  const fakeFs = {
    existsSync(file) {
      return files.has(file);
    },
    mkdirSync(dir) {
      mkdirs.push(dir);
    },
    readFileSync(file) {
      return files.get(file);
    },
    writeFileSync(file, content) {
      files.set(file, content);
    },
    renameSync(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    }
  };

  const persistence = createUserStorePersistence({
    env: { MUSICSPY_DATA_DIR: "/tmp/musicspy-test" },
    fsImpl: fakeFs,
    logger: { log() {}, error() {} }
  });

  files.set("/tmp/musicspy-test/users.json", JSON.stringify({ users: [{ id: "u1" }] }));
  assert.deepEqual(persistence.read(), { users: [{ id: "u1" }], friendships: [], friendRequests: [], directMessages: [], lobbyHistory: [], matchHistory: [], playerProgression: [] });

  persistence.write({ users: [], friendships: [{ id: "u1:u2", userAId: "u1", userBId: "u2" }], friendRequests: [{ id: "r1" }], directMessages: [{ id: "m1" }] });
  assert.equal(files.has(`/tmp/musicspy-test/users.json.${process.pid}.tmp`), false);
  assert.deepEqual(JSON.parse(files.get("/tmp/musicspy-test/users.json")), {
    users: [],
    friendships: [{ id: "u1:u2", userAId: "u1", userBId: "u2", createdAt: "1970-01-01T00:00:00.000Z" }],
    friendRequests: [{ id: "r1" }],
    directMessages: [{ id: "m1" }],
    lobbyHistory: [],
    matchHistory: [],
    playerProgression: []
  });
  assert.ok(mkdirs.includes("/tmp/musicspy-test"));
});

test("production persistence refuses ephemeral storage without a database", () => {
  const { createUserStorePersistence } = require("../lib/persistence");
  assert.throws(
    () => createUserStorePersistence({ env: { NODE_ENV: "production" }, logger: { warn() {} } }),
    /DATABASE_URL is required/
  );
});

test("postgres persistence exposes persistent schema and import path", async () => {
  const { createPostgresUserStorePersistence } = require("../lib/persistence");
  const queries = [];
  const fakeClient = {
    query: async (text, params) => { queries.push({ text, params }); },
    release() {}
  };
  const fakePool = {
    query: async (text, params) => {
      queries.push({ text, params });
      if (String(text).includes("COUNT(*)")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    },
    connect: async () => fakeClient,
    end: async () => undefined
  };

  const persistence = createPostgresUserStorePersistence({
    env: { DATABASE_URL: "postgres://example/musicspy", PGSSLMODE: "disable" },
    fsImpl: { existsSync: () => false },
    logger: { log() {} },
    pgModule: { Pool: function Pool() { return fakePool; } }
  });

  await persistence.init();
  await persistence.write({
    users: [{ id: "u1", username: "one", displayName: "One", stats: { games: 1 }, settings: { lang: "en" }, sessions: [{ id: "s1", refreshTokenHash: "r" }] }],
    friendships: [],
    friendRequests: [],
    directMessages: [],
    lobbyHistory: [{ id: "l1", lobbyCode: "ABCD", result: { civiliansWin: true } }],
    matchHistory: [{ id: "m1", lobbyHistoryId: "l1", userId: "u1", lobbyCode: "ABCD", role: "spy", won: true }],
    playerProgression: [{ id: "p1", userId: "u1", type: "match_completed", payload: { xp: 1 } }]
  });

  const sql = queries.map((item) => item.text).join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS accounts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS friendships/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS friend_requests/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS direct_messages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS lobby_history/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS match_history/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_progression/);
  assert.match(sql, /INSERT INTO accounts/);
  assert.match(sql, /INSERT INTO auth_sessions/);
  assert.match(sql, /INSERT INTO match_history/);
});

test("auth sessions persist refresh tokens and access lookup uses hashed tokens", () => {
  const { createSession, findUserByToken, hashSessionToken, refreshSession } = require("../lib/auth");
  const user = { id: "u1", sessions: [] };
  let saved = 0;

  const tokens = createSession(user, { save: () => { saved += 1; } });

  assert.equal(saved, 1);
  assert.equal(user.sessions.length, 1);
  assert.equal(user.sessions[0].accessTokenHash, hashSessionToken(tokens.accessToken));
  assert.equal(user.sessions[0].refreshTokenHash, hashSessionToken(tokens.refreshToken));
  assert.equal(findUserByToken([user], tokens.accessToken), user);
  assert.equal(findUserByToken([user], "wrong-token"), null);

  const refreshed = refreshSession([user], tokens.refreshToken, { save: () => { saved += 1; } });
  assert.equal(refreshed.user, user);
  assert.equal(saved, 2);
  assert.equal(findUserByToken([user], refreshed.tokens.accessToken), user);
  assert.equal(refreshSession([user], tokens.refreshToken), null);
});

test("getSkipVoteState excludes track owner and disconnected listeners", () => {
  const { getSkipVoteState, shouldCompleteSkip } = require("../server");
  const lobby = {
    phase: "playing",
    turnStage: "listening",
    lastTrack: { id: "track-1", playerId: "owner" },
    players: [
      { id: "owner", name: "Owner" },
      { id: "listener-1", name: "One" },
      { id: "listener-2", name: "Two" },
      { id: "listener-3", name: "Three", disconnected: true }
    ],
    skipVotes: { owner: Date.now(), "listener-1": Date.now(), "listener-3": Date.now() }
  };

  const skipState = getSkipVoteState(lobby);

  assert.equal(skipState.requiredVotes, 2);
  assert.equal(skipState.voteCount, 1);
  assert.deepEqual(skipState.voterIds, ["listener-1"]);
  assert.equal(shouldCompleteSkip(lobby), false);

  lobby.skipVotes["listener-2"] = Date.now();
  assert.equal(shouldCompleteSkip(lobby), true);
});
