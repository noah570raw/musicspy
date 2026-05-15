const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const RENDER_PERSISTENT_DIR = "/var/data";

function resolveDataDir(env = process.env, fsImpl = fs) {
  const explicitDataDir = String(env.MUSICSPY_DATA_DIR || env.DATA_DIR || "").trim();
  if (explicitDataDir) return path.resolve(explicitDataDir);

  const renderDiskMount = String(env.RENDER_DISK_MOUNT_PATH || "").trim();
  const persistentCandidates = [renderDiskMount, RENDER_PERSISTENT_DIR].filter(Boolean);
  const persistentRoot = persistentCandidates.find((candidate) => fsImpl.existsSync(candidate));
  if (persistentRoot) return path.join(persistentRoot, "musicspy");

  return DEFAULT_DATA_DIR;
}

const DATA_DIR = resolveDataDir();
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LEGACY_USERS_FILE = path.join(DEFAULT_DATA_DIR, "users.json");
const PASSWORD_ITERATIONS = 120000;
const AVATAR_MAX_BYTES = 64 * 1024;
const SPY_GUESS_SECONDS = 60;
const DECOY_GUESS_SECONDS = 10;
const DECOY_HOST_APPROVAL_SECONDS = 2;
const HOST_TIMER_STEP_SECONDS = 15;
const HOST_MIN_TIMER_SECONDS = 5;
const HOST_MAX_TIMER_SECONDS = 300;

const lobbies = {};
const timers = {};

const ALLOWED_REACTIONS = ["🔥", "❤️", "😂", "😮", "🕵️", "🤔"];


function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonStore(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return { users: Array.isArray(parsed.users) ? parsed.users : [] };
}

function readUsersStore() {
  try {
    ensureDataDir();
    if (fs.existsSync(USERS_FILE)) return readJsonStore(USERS_FILE);

    if (USERS_FILE !== LEGACY_USERS_FILE && fs.existsSync(LEGACY_USERS_FILE)) {
      const legacyStore = readJsonStore(LEGACY_USERS_FILE);
      fs.writeFileSync(USERS_FILE, JSON.stringify(legacyStore, null, 2));
      console.log(`Migrated users store from ${LEGACY_USERS_FILE} to ${USERS_FILE}`);
      return legacyStore;
    }

    return { users: [] };
  } catch (error) {
    console.error("Failed to read users store", error);
    return { users: [] };
  }
}

let usersStore = readUsersStore();

function saveUsersStore() {
  ensureDataDir();
  const tmpFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(usersStore, null, 2));
  fs.renameSync(tmpFile, USERS_FILE);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 72;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  user.sessions = [
    { tokenHash, createdAt: new Date().toISOString() },
    ...(user.sessions || []).slice(0, 4)
  ];
  user.updatedAt = new Date().toISOString();
  saveUsersStore();
  return token;
}

function findUserByToken(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
  return usersStore.users.find((user) => (user.sessions || []).some((session) => session.tokenHash === tokenHash)) || null;
}

function defaultStats() {
  return {
    games: 0,
    wins: 0,
    spyGames: 0,
    spyWins: 0,
    civilianGames: 0,
    civilianWins: 0,
    winStreak: 0,
    bestWinStreak: 0
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || "",
    createdAt: user.createdAt,
    stats: { ...defaultStats(), ...(user.stats || {}) }
  };
}

function normalizeAvatar(avatar) {
  const value = String(avatar || "");
  if (!value) return "";
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value)) {
    throw new Error("Поддерживаются только PNG, JPG, WEBP или GIF");
  }
  const size = Buffer.byteLength(value, "utf8");
  if (size > AVATAR_MAX_BYTES) {
    throw new Error("Аватарка слишком большая. Максимум 64 КБ после сжатия");
  }
  return value;
}

function profileForSocket(socket) {
  const user = socket.data.user;
  if (user) return { user: publicUser(user), guest: false };
  return { user: null, guest: true };
}

function playerFromSocket(socket, rawName, lobby = null) {
  const user = socket.data.user;
  const baseName = user ? (user.displayName || user.username) : (rawName || "Гость");
  const name = lobby ? makeUniqueName(lobby, baseName) : normalizeName(baseName);
  return {
    id: socket.id,
    accountId: user?.id || null,
    guest: !user,
    name,
    avatar: user?.avatar || "",
    ready: false
  };
}

function syncUserProfileInLobbies(user) {
  for (const lobby of Object.values(lobbies)) {
    let changed = false;
    for (const player of lobby.players) {
      if (player.accountId === user.id) {
        const nextName = makeUniqueName(lobby, user.displayName || user.username, player.id);
        if (player.name !== nextName) player.name = nextName;
        if (player.avatar !== (user.avatar || "")) player.avatar = user.avatar || "";
        changed = true;
      }
    }
    if (changed) emitLobbyUpdate(lobby.code);
  }
}

const GAME_MODES = {
  classic: {
    label: "Классика",
    rounds: 3,
    listenTime: 30,
    anonymousVoting: false,
    votingTime: 60,
    runoffOnTie: true
  },
  blitz: {
    label: "Блиц",
    rounds: 2,
    listenTime: 15,
    anonymousVoting: false,
    votingTime: 30,
    runoffOnTie: false
  },
  hardcore: {
    label: "Хардкор",
    rounds: 4,
    listenTime: 15,
    anonymousVoting: true,
    votingTime: 30,
    runoffOnTie: false
  },
  party: {
    label: "Вечеринка",
    rounds: 3,
    listenTime: 45,
    anonymousVoting: false,
    votingTime: 90,
    runoffOnTie: true
  }
};

const DEFAULT_SETTINGS = {
  gameMode: "classic",
  rounds: GAME_MODES.classic.rounds,
  listenTime: GAME_MODES.classic.listenTime,
  spyMode: "auto",
  spyCount: 1,
  anonymousVoting: GAME_MODES.classic.anonymousVoting,
  votingTime: GAME_MODES.classic.votingTime,
  runoffOnTie: GAME_MODES.classic.runoffOnTie
};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let code = "";

  do {
    code = "";
    for (let i = 0; i < 5; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (lobbies[code]);

  return code;
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clampNumber(value, allowed, fallback) {
  const number = Number(value);
  return allowed.includes(number) ? number : fallback;
}

function normalizeSettings(input = {}) {
  const requestedMode = GAME_MODES[input.gameMode] ? input.gameMode : DEFAULT_SETTINGS.gameMode;
  const modePreset = GAME_MODES[requestedMode];
  const next = { ...DEFAULT_SETTINGS, gameMode: requestedMode, ...modePreset };
  next.rounds = clampNumber(input.rounds, [2, 3, 4, 5], next.rounds);
  next.listenTime = clampNumber(input.listenTime, [15, 30, 45, 60], next.listenTime);
  next.spyMode = input.spyMode === "manual" ? "manual" : "auto";
  next.spyCount = clampNumber(input.spyCount, [1, 2, 3], DEFAULT_SETTINGS.spyCount);
  next.anonymousVoting = input.anonymousVoting === undefined ? next.anonymousVoting : Boolean(input.anonymousVoting);
  next.votingTime = clampNumber(input.votingTime, [0, 30, 60, 90], next.votingTime);
  next.runoffOnTie = input.runoffOnTie === undefined ? next.runoffOnTie : input.runoffOnTie !== false;
  return next;
}

function getSpyCount(lobby) {
  const playerCount = lobby.players.length;
  const maxSpies = Math.max(1, Math.min(3, playerCount - 1));

  if (lobby.settings.spyMode === "manual") {
    return Math.min(lobby.settings.spyCount, maxSpies);
  }

  if (playerCount >= 9) return Math.min(3, maxSpies);
  if (playerCount >= 6) return Math.min(2, maxSpies);
  return 1;
}


function getActiveTurnOrder(lobby) {
  const activePlayerIds = new Set(lobby.players.map((player) => player.id));
  return lobby.baseOrder.filter((id) => activePlayerIds.has(id));
}


function countReactions(reactions = {}) {
  const totals = {};
  for (const reaction of Object.values(reactions || {})) {
    if (ALLOWED_REACTIONS.includes(reaction)) {
      totals[reaction] = (totals[reaction] || 0) + 1;
    }
  }
  return totals;
}

function syncLastTrackHistory(lobby) {
  if (!lobby.lastTrack || !Array.isArray(lobby.trackHistory)) return;
  const entry = lobby.trackHistory.find((item) => item.id === lobby.lastTrack.id);
  if (!entry) return;
  entry.reactions = countReactions(lobby.currentTrackReactions);
}


function normalizeGuess(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`.,!?;:()\[\]{}_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVoteDetails(lobby) {
  return Object.entries(lobby.votes || {}).map(([voterId, targetId]) => {
    const voter = lobby.players.find((player) => player.id === voterId);
    const target = lobby.players.find((player) => player.id === targetId);
    return {
      voterId,
      voterName: voter?.name || "Игрок",
      targetId,
      targetName: target?.name || "Игрок",
      hitSpy: lobby.spies.includes(targetId)
    };
  });
}

function buildFinalBreakdown(lobby, suspected = [], finalVotes = {}) {
  const tracks = lobby.trackHistory || [];
  const sortedVotes = Object.entries(finalVotes).sort((a, b) => b[1] - a[1]);
  const topVoteCount = sortedVotes[0]?.[1] || 0;
  const topVoted = sortedVotes
    .filter(([, count]) => count === topVoteCount && count > 0)
    .map(([id]) => lobby.players.find((player) => player.id === id)?.name || "Игрок");

  const reactionTotals = {};
  let mostReactedTrack = null;
  let mostSuspiciousTrack = null;

  for (const track of tracks) {
    const reactions = track.reactions || {};
    const reactionCount = Object.values(reactions).reduce((sum, count) => sum + Number(count || 0), 0);
    const suspicionCount = Number(reactions["🕵️"] || 0) + Number(reactions["🤔"] || 0);

    for (const [reaction, count] of Object.entries(reactions)) {
      reactionTotals[reaction] = (reactionTotals[reaction] || 0) + Number(count || 0);
    }

    if (reactionCount > (mostReactedTrack?.reactionCount || 0)) {
      mostReactedTrack = { ...track, reactionCount };
    }
    if (suspicionCount > (mostSuspiciousTrack?.suspicionCount || 0)) {
      mostSuspiciousTrack = { ...track, suspicionCount };
    }
  }

  return {
    voteDetails: buildVoteDetails(lobby),
    topVoted,
    topVoteCount,
    reactionTotals,
    mostReactedTrack,
    mostSuspiciousTrack,
    suspectedNames: suspected.map((id) => lobby.players.find((player) => player.id === id)?.name || "Игрок")
  };
}

function removePlayerFromLobby(lobby, playerId) {
  const removedOrderIndex = lobby.order.indexOf(playerId);

  lobby.players = lobby.players.filter((player) => player.id !== playerId);
  lobby.order = lobby.order.filter((id) => id !== playerId);
  lobby.baseOrder = lobby.baseOrder.filter((id) => id !== playerId);
  lobby.spies = lobby.spies.filter((id) => id !== playerId);
  lobby.voteCandidates = lobby.voteCandidates.filter((id) => id !== playerId);
  delete lobby.votes[playerId];
  if (lobby.currentTrackReactions) delete lobby.currentTrackReactions[playerId];
  syncLastTrackHistory(lobby);

  for (const [voter, target] of Object.entries(lobby.votes)) {
    if (target === playerId) delete lobby.votes[voter];
  }

  if (removedOrderIndex !== -1 && removedOrderIndex < lobby.currentTurnIndex) {
    lobby.currentTurnIndex = Math.max(0, lobby.currentTurnIndex - 1);
  }

  if (lobby.currentTurnIndex >= lobby.order.length) {
    lobby.currentTurnIndex = 0;
  }

  return removedOrderIndex;
}



function publicLobby(lobby) {
  return {
    code: lobby.code,
    host: lobby.host,
    players: lobby.players,
    started: lobby.started,
    phase: lobby.phase,
    minPlayers: 3,
    totalRounds: lobby.settings.rounds,
    settings: lobby.settings
  };
}

function emitLobbyUpdate(code) {
  const lobby = lobbies[code];
  if (!lobby) return;
  io.to(code).emit("lobbyUpdate", publicLobby(lobby));
}

function handlePlayerDeparture(lobby, socket, { leaveRoom = true } = {}) {
  const code = lobby.code;

  if (leaveRoom) socket.leave(code);
  removePlayerFromLobby(lobby, socket.id);

  if (lobby.host === socket.id && lobby.players.length > 0) {
    lobby.host = lobby.players[0].id;
  }

  if (lobby.players.length === 0) {
    clearTimer(code);
    delete lobbies[code];
    return { deleted: true };
  }

  if (lobby.phase === "playing" && lobby.players.length < 3) {
    clearTimer(code);
    resetLobbyToWaiting(lobby);
    io.to(code).emit("gameCancelled", { reason: "Игрок вышел — нужно минимум 3 участника" });
  } else if (lobby.phase === "playing") {
    startTurn(code);
  } else if (lobby.phase === "voting" && Object.keys(lobby.votes).length >= lobby.players.length) {
    finishVote(code);
  } else if (lobby.phase === "spyGuess" && !lobby.players.some((player) => lobby.spies.includes(player.id))) {
    finishGame(code, lobby.suspected || [], lobby.finalVotes || null, { text: "", correct: false, skipped: true });
  }

  emitLobbyUpdate(code);
  return { deleted: false };
}

function emitGameState(code) {
  const lobby = lobbies[code];
  if (!lobby) return;
  const currentPlayerId = lobby.order[lobby.currentTurnIndex] || null;
  const currentPlayer = lobby.players.find((player) => player.id === currentPlayerId);

  io.to(code).emit("gameState", {
    code,
    phase: lobby.phase,
    host: lobby.host,
    round: lobby.round,
    totalRounds: lobby.settings.rounds,
    order: lobby.order,
    currentPlayerId,
    currentPlayerName: currentPlayer?.name || "",
    turnNumber: lobby.currentTurnIndex + 1,
    turnsInRound: lobby.order.length,
    lastTrack: lobby.lastTrack,
    players: lobby.players,
    submittedThisTurn: lobby.submittedThisTurn,
    turnStage: lobby.turnStage,
    pausedTurnStage: lobby.pausedTurnStage || null,
    timeLeft: lobby.timeLeft,
    listenTime: lobby.settings.listenTime,
    settings: lobby.settings,
    voteRound: lobby.voteRound,
    voteCandidates: lobby.voteCandidates,
    votes: lobby.settings.anonymousVoting && lobby.phase === "voting" ? {} : publicVotes(lobby),
    reactionCounts: countReactions(lobby.currentTrackReactions),
    trackHistory: lobby.trackHistory || [],
    pendingSpyGuess: lobby.pendingSpyGuess || null
  });
}

function publicVotes(lobby) {
  const totals = {};
  for (const target of Object.values(lobby.votes)) {
    totals[target] = (totals[target] || 0) + 1;
  }
  return totals;
}

function normalizeName(name) {
  return String(name || "").trim().slice(0, 18) || "Без имени";
}

function makeUniqueName(lobby, rawName, excludeId = null) {
  const base = normalizeName(rawName);
  const occupied = new Set(
    lobby.players
      .filter((player) => player.id !== excludeId)
      .map((player) => player.name.toLowerCase())
  );
  if (!occupied.has(base.toLowerCase())) return base;

  let index = 2;
  while (occupied.has(`${base} (${index})`.toLowerCase())) {
    index += 1;
  }
  return `${base} (${index})`;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function clearTimer(code) {
  clearInterval(timers[code]);
  delete timers[code];
}

function emitTurnTimer(lobby) {
  io.to(lobby.code).emit("timer", {
    timeLeft: lobby.timeLeft,
    stage: lobby.turnStage,
    listenTime: lobby.settings.listenTime
  });
}

function runListeningCountdown(code) {
  clearTimer(code);
  timers[code] = setInterval(() => {
    const currentLobby = lobbies[code];
    if (!currentLobby || currentLobby.phase !== "playing" || currentLobby.turnStage !== "listening") {
      clearTimer(code);
      return;
    }

    currentLobby.timeLeft -= 1;
    emitTurnTimer(currentLobby);

    if (currentLobby.timeLeft <= 0) {
      advanceTurn(code);
    }
  }, 1000);
}

function startListeningTimer(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "playing") return;

  lobby.turnStage = "listening";
  lobby.pausedTurnStage = null;
  lobby.timeLeft = lobby.settings.listenTime;
  emitTurnTimer(lobby);
  emitGameState(code);
  runListeningCountdown(code);
}

function pauseTurnTimer(lobby) {
  if (!lobby || lobby.phase !== "playing" || lobby.turnStage !== "listening") return false;
  clearTimer(lobby.code);
  lobby.pausedTurnStage = "listening";
  lobby.turnStage = "paused";
  emitTurnTimer(lobby);
  emitGameState(lobby.code);
  return true;
}

function resumeTurnTimer(lobby) {
  if (!lobby || lobby.phase !== "playing" || lobby.turnStage !== "paused") return false;
  if (!lobby.submittedThisTurn || !lobby.lastTrack || !Number.isFinite(lobby.timeLeft)) return false;
  lobby.turnStage = lobby.pausedTurnStage || "listening";
  lobby.pausedTurnStage = null;
  emitTurnTimer(lobby);
  emitGameState(lobby.code);
  runListeningCountdown(lobby.code);
  return true;
}

function adjustTurnTimer(lobby, deltaSeconds) {
  if (!lobby || lobby.phase !== "playing" || !["listening", "paused"].includes(lobby.turnStage)) return null;
  if (!Number.isFinite(lobby.timeLeft)) return null;
  const nextTimeLeft = Math.max(HOST_MIN_TIMER_SECONDS, Math.min(HOST_MAX_TIMER_SECONDS, lobby.timeLeft + deltaSeconds));
  lobby.timeLeft = nextTimeLeft;
  emitTurnTimer(lobby);
  emitGameState(lobby.code);
  return nextTimeLeft;
}

function startVotingTimer(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "voting" || lobby.settings.votingTime <= 0) return;

  clearTimer(code);
  lobby.voteTimeLeft = lobby.settings.votingTime;
  io.to(code).emit("voteTimer", { timeLeft: lobby.voteTimeLeft });

  timers[code] = setInterval(() => {
    const currentLobby = lobbies[code];
    if (!currentLobby || currentLobby.phase !== "voting") {
      clearTimer(code);
      return;
    }

    currentLobby.voteTimeLeft -= 1;
    io.to(code).emit("voteTimer", { timeLeft: currentLobby.voteTimeLeft });

    if (currentLobby.voteTimeLeft <= 0) {
      finishVote(code);
    }
  }, 1000);
}

function startTurn(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "playing") return;

  const playerId = lobby.order[lobby.currentTurnIndex];
  const player = lobby.players.find((item) => item.id === playerId);

  if (!player) {
    advanceTurn(code);
    return;
  }

  clearTimer(code);
  lobby.submittedThisTurn = false;
  lobby.turnStage = "waiting";
  lobby.timeLeft = null;
  lobby.pausedTurnStage = null;
  io.to(code).emit("turn", {
    playerId,
    name: player.name,
    round: lobby.round,
    turnNumber: lobby.currentTurnIndex + 1,
    turnsInRound: lobby.order.length,
    stage: lobby.turnStage
  });
  io.to(code).emit("timer", {
    timeLeft: null,
    stage: lobby.turnStage,
    listenTime: lobby.settings.listenTime
  });
  emitGameState(code);
}

function advanceTurn(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "playing") return;

  clearTimer(code);
  lobby.currentTurnIndex += 1;

  if (lobby.currentTurnIndex >= lobby.order.length) {
    if (lobby.round >= lobby.settings.rounds) {
      startVoting(code);
      return;
    }

    lobby.round += 1;
    lobby.currentTurnIndex = 0;
    lobby.order = getActiveTurnOrder(lobby);
    io.to(code).emit("roundStarted", { round: lobby.round, order: lobby.order });
  }

  startTurn(code);
}

function startVoting(code, candidates = null, voteRound = 1) {
  const lobby = lobbies[code];
  if (!lobby) return;

  clearTimer(code);
  lobby.phase = "voting";
  lobby.votes = {};
  lobby.voteRound = voteRound;
  lobby.voteCandidates = candidates || lobby.players.map((player) => player.id);
  lobby.voteTimeLeft = lobby.settings.votingTime;

  io.to(code).emit("votingStarted", {
    players: lobby.players,
    votes: lobby.settings.anonymousVoting ? {} : publicVotes(lobby),
    anonymous: lobby.settings.anonymousVoting,
    voteRound: lobby.voteRound,
    candidates: lobby.voteCandidates,
    votingTime: lobby.settings.votingTime
  });
  emitGameState(code);
  startVotingTimer(code);
}

function finishVote(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "voting") return;

  clearTimer(code);
  const voteTotals = publicVotes(lobby);
  const sorted = Object.entries(voteTotals).sort((a, b) => b[1] - a[1]);
  const topVotes = sorted[0]?.[1] || 0;
  const suspected = sorted.filter(([, count]) => count === topVotes).map(([id]) => id);

  if (lobby.settings.runoffOnTie && lobby.voteRound === 1 && suspected.length > 1 && topVotes > 0) {
    io.to(code).emit("runoffStarted", { candidates: suspected });
    startVoting(code, suspected, 2);
    return;
  }

  startSpyGuess(code, suspected, voteTotals);
}

function startSpyGuess(code, suspected, voteTotals) {
  const lobby = lobbies[code];
  if (!lobby) return;

  const activeSpies = lobby.players.filter((player) => lobby.spies.includes(player.id));
  if (!activeSpies.length) {
    finishGame(code, suspected, voteTotals, { text: "", correct: false, skipped: true });
    return;
  }

  clearTimer(code);
  const caughtSpy = suspected.some((id) => lobby.spies.includes(id));
  const guessedPlayer = lobby.players.find((player) => suspected.includes(player.id)) || lobby.players[0];
  const guesserId = caughtSpy ? activeSpies[0].id : guessedPlayer?.id;
  lobby.phase = "spyGuess";
  lobby.suspected = suspected;
  lobby.finalVotes = voteTotals || publicVotes(lobby);
  lobby.spyGuess = null;
  lobby.pendingSpyGuess = null;
  lobby.spyGuessMode = caughtSpy ? "spy" : "decoy";
  lobby.spyGuessTargetId = guesserId || null;
  lobby.spyGuessTimeLeft = caughtSpy ? SPY_GUESS_SECONDS : DECOY_GUESS_SECONDS;

  for (const player of lobby.players) {
    const isGuesser = player.id === guesserId;
    io.to(player.id).emit("spyGuessStarted", {
      spies: caughtSpy && isGuesser ? lobby.spies : [],
      guesserId: isGuesser ? guesserId : null,
      guesserRole: caughtSpy ? (isGuesser ? "spy" : "hidden") : (isGuesser ? "decoy" : "hidden"),
      accusedNames: suspected.map((id) => lobby.players.find((item) => item.id === id)?.name || "Игрок"),
      prefillTheme: !caughtSpy && isGuesser ? lobby.theme : "",
      suspected,
      votes: lobby.finalVotes,
      trackHistory: lobby.trackHistory || [],
      timeLeft: lobby.spyGuessTimeLeft
    });
  }
  emitLobbyUpdate(code);

  if (!caughtSpy) {
    timers[code] = setInterval(() => {
      const currentLobby = lobbies[code];
      if (!currentLobby || currentLobby.phase !== "spyGuess" || currentLobby.spyGuessMode !== "decoy") {
        clearTimer(code);
        return;
      }

      currentLobby.spyGuessTimeLeft -= 1;
      io.to(code).emit("spyGuessTimer", { timeLeft: currentLobby.spyGuessTimeLeft });
      if (currentLobby.spyGuessTimeLeft <= 0) {
        clearTimer(code);
        const player = currentLobby.players.find((item) => item.id === currentLobby.spyGuessTargetId);
        const pendingGuess = { text: currentLobby.theme, playerId: player?.id || "", playerName: player?.name || "Игрок", skipped: false, decoy: true, correct: false };
        currentLobby.pendingSpyGuess = pendingGuess;
        currentLobby.spyGuess = pendingGuess;
        io.to(code).emit("decoyGuessAutoSubmitted", { guess: pendingGuess });
        io.to(currentLobby.host).emit("spyGuessSubmitted", { guess: pendingGuess, decoy: true, spies: [] });
        timers[code] = setTimeout(() => {
          finishGame(code, currentLobby.suspected || [], currentLobby.finalVotes || null, pendingGuess);
        }, DECOY_HOST_APPROVAL_SECONDS * 1000);
      }
    }, 1000);
    return;
  }

  timers[code] = setInterval(() => {
    const currentLobby = lobbies[code];
    if (!currentLobby || currentLobby.phase !== "spyGuess") {
      clearTimer(code);
      return;
    }

    currentLobby.spyGuessTimeLeft -= 1;
    io.to(code).emit("spyGuessTimer", { timeLeft: currentLobby.spyGuessTimeLeft });
    if (currentLobby.spyGuessTimeLeft <= 0) {
      finishGame(code, currentLobby.suspected || [], currentLobby.finalVotes || null, { text: "", correct: false, skipped: true });
    }
  }, 1000);
}



function updateUserStatsForGame(lobby, civiliansWin) {
  let changed = false;
  const playerByAccount = new Map(lobby.players.filter((player) => player.accountId).map((player) => [player.accountId, player]));
  for (const user of usersStore.users) {
    const player = playerByAccount.get(user.id);
    if (!player) continue;
    const isSpy = lobby.spies.includes(player.id);
    const won = isSpy ? !civiliansWin : civiliansWin;
    const stats = { ...defaultStats(), ...(user.stats || {}) };
    stats.games += 1;
    stats.wins += won ? 1 : 0;
    stats.winStreak = won ? stats.winStreak + 1 : 0;
    stats.bestWinStreak = Math.max(stats.bestWinStreak || 0, stats.winStreak || 0);
    if (isSpy) {
      stats.spyGames += 1;
      stats.spyWins += won ? 1 : 0;
    } else {
      stats.civilianGames += 1;
      stats.civilianWins += won ? 1 : 0;
    }
    user.stats = stats;
    user.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) saveUsersStore();
}

function finishGame(code, suspected = [], voteTotals = null, spyGuess = null) {
  const lobby = lobbies[code];
  if (!lobby) return;

  syncLastTrackHistory(lobby);
  const finalVotes = voteTotals || publicVotes(lobby);
  const spyPlayers = lobby.players.filter((player) => lobby.spies.includes(player.id));
  const caughtSpy = suspected.some((id) => lobby.spies.includes(id));
  const finalSpyGuess = spyGuess || lobby.spyGuess || { text: "", correct: false, skipped: true };
  const civiliansWin = caughtSpy && !finalSpyGuess.correct;
  const decoyReveal = !caughtSpy && suspected.length > 0;
  const breakdown = buildFinalBreakdown(lobby, suspected, finalVotes);

  updateUserStatsForGame(lobby, civiliansWin);
  lobby.phase = "ended";
  clearTimer(code);

  for (const player of lobby.players) {
    const user = usersStore.users.find((item) => item.id === player.accountId);
    if (user) io.to(player.id).emit("profile:updated", { profile: { user: publicUser(user), guest: false } });
  }

  io.to(code).emit("gameEnd", {
    spies: lobby.spies,
    spy: lobby.spies[0] || null,
    spyNames: spyPlayers.map((player) => player.name),
    spyName: spyPlayers.map((player) => player.name).join(", ") || "Шпион",
    votes: finalVotes,
    suspected,
    caughtSpy,
    decoyReveal,
    civiliansWin,
    spyGuess: finalSpyGuess,
    theme: lobby.theme,
    settings: lobby.settings,
    trackHistory: lobby.trackHistory || [],
    breakdown
  });
  emitLobbyUpdate(code);
}

function resetLobbyToWaiting(lobby) {
  lobby.started = false;
  lobby.phase = "lobby";
  lobby.round = 0;
  lobby.spies = [];
  lobby.spy = null;
  lobby.order = [];
  lobby.baseOrder = [];
  lobby.currentTurnIndex = 0;
  lobby.theme = "";
  lobby.votes = {};
  lobby.voteRound = 1;
  lobby.voteCandidates = [];
  lobby.voteTimeLeft = null;
  lobby.lastTrack = null;
  lobby.currentTrackReactions = {};
  lobby.trackHistory = [];
  lobby.suspected = [];
  lobby.finalVotes = null;
  lobby.spyGuess = null;
  lobby.pendingSpyGuess = null;
  lobby.spyGuessTimeLeft = null;
  lobby.submittedThisTurn = false;
  lobby.timeLeft = null;
  lobby.turnStage = "waiting";
  lobby.pausedTurnStage = null;
}

function createLobbyState(code, hostId, player) {
  return {
    code,
    host: hostId,
    players: [player],
    started: false,
    phase: "lobby",
    round: 0,
    spies: [],
    spy: null,
    order: [],
    baseOrder: [],
    currentTurnIndex: 0,
    theme: "",
    votes: {},
    voteRound: 1,
    voteCandidates: [],
    voteTimeLeft: null,
    lastTrack: null,
    currentTrackReactions: {},
    trackHistory: [],
    suspected: [],
    finalVotes: null,
    spyGuess: null,
    pendingSpyGuess: null,
    spyGuessTimeLeft: null,
    spyGuessMode: null,
    spyGuessTargetId: null,
    submittedThisTurn: false,
    timeLeft: null,
    turnStage: "waiting",
    pausedTurnStage: null,
    settings: { ...DEFAULT_SETTINGS }
  };
}

io.on("connection", (socket) => {
  socket.data.user = null;

  socket.on("auth:session", ({ token } = {}, cb = () => {}) => {
    const user = findUserByToken(token);
    if (!user) return cb({ error: "Сессия не найдена" });
    socket.data.user = user;
    cb({ success: true, profile: profileForSocket(socket) });
  });

  socket.on("auth:guest", ({ name } = {}, cb = () => {}) => {
    socket.data.user = null;
    cb({ success: true, profile: profileForSocket(socket), name: normalizeName(name || "Гость") });
  });

  socket.on("auth:register", ({ username, password, displayName } = {}, cb = () => {}) => {
    const normalizedUsername = normalizeUsername(username);
    if (normalizedUsername.length < 3) return cb({ error: "Логин должен быть от 3 символов: латиница, цифры, _ или -" });
    if (!validatePassword(password)) return cb({ error: "Пароль должен быть от 6 до 72 символов" });
    if (usersStore.users.some((user) => user.username === normalizedUsername)) {
      return cb({ error: "Такой логин уже занят" });
    }

    const { salt, hash } = hashPassword(password);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      username: normalizedUsername,
      displayName: normalizeName(displayName || username),
      avatar: "",
      stats: defaultStats(),
      salt,
      passwordHash: hash,
      sessions: [],
      createdAt: now,
      updatedAt: now
    };
    usersStore.users.push(user);
    socket.data.user = user;
    const token = createSession(user);
    cb({ success: true, token, profile: profileForSocket(socket) });
  });

  socket.on("auth:login", ({ username, password } = {}, cb = () => {}) => {
    const normalizedUsername = normalizeUsername(username);
    const user = usersStore.users.find((item) => item.username === normalizedUsername);
    if (!user || !verifyPassword(password, user)) return cb({ error: "Неверный логин или пароль" });
    socket.data.user = user;
    const token = createSession(user);
    cb({ success: true, token, profile: profileForSocket(socket) });
  });

  socket.on("auth:logout", (cb = () => {}) => {
    socket.data.user = null;
    cb({ success: true, profile: profileForSocket(socket) });
  });

  socket.on("profile:update", ({ displayName, avatar } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы менять профиль" });
    try {
      user.displayName = normalizeName(displayName || user.displayName || user.username);
      if (avatar !== undefined) user.avatar = normalizeAvatar(avatar);
      user.updatedAt = new Date().toISOString();
      saveUsersStore();
      syncUserProfileInLobbies(user);
      cb({ success: true, profile: profileForSocket(socket) });
    } catch (error) {
      cb({ error: error.message || "Не удалось обновить профиль" });
    }
  });

  socket.on("createLobby", ({ name }, cb = () => {}) => {
    const code = generateCode();
    const player = playerFromSocket(socket, name);

    lobbies[code] = createLobbyState(code, socket.id, player);

    socket.join(code);
    cb({ code, playerId: socket.id });
    emitLobbyUpdate(code);
  });

  socket.on("joinLobby", ({ code, name }, cb = () => {}) => {
    const roomCode = normalizeCode(code);
    const lobby = lobbies[roomCode];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started) return cb({ error: "Игра уже началась" });
    if (lobby.players.some((player) => player.id === socket.id)) {
      return cb({ success: true, code: roomCode, playerId: socket.id });
    }

    socket.join(roomCode);
    lobby.players.push(playerFromSocket(socket, name, lobby));

    cb({ success: true, code: roomCode, playerId: socket.id });
    emitLobbyUpdate(roomCode);
  });

  socket.on("leaveLobby", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (lobby.started) return cb({ error: "Во время игры выйти можно только закрыв вкладку" });

    handlePlayerDeparture(lobby, socket);
    cb({ success: true });
  });

  socket.on("updateSettings", ({ code, settings }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Настройки может менять только хост" });
    if (lobby.started) return cb({ error: "Игра уже началась" });

    lobby.settings = normalizeSettings({ ...lobby.settings, ...settings });
    cb({ success: true, settings: lobby.settings });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("setReady", ({ code, ready }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started) return cb({ error: "Игра уже началась" });
    const player = lobby.players.find((item) => item.id === socket.id);
    if (!player) return cb({ error: "Ты не в этой комнате" });
    player.ready = Boolean(ready);
    cb({ success: true, ready: player.ready });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("updateName", ({ code, name }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started) return cb({ error: "Игра уже началась" });
    const player = lobby.players.find((item) => item.id === socket.id);
    if (!player) return cb({ error: "Ты не в этой комнате" });
    if (!player.guest || socket.data.user) {
      return cb({ error: "Ник аккаунта меняется только в профиле" });
    }
    player.name = makeUniqueName(lobby, name, socket.id);
    cb({ success: true, name: player.name });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("startGame", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Начать игру может только хост" });
    if (lobby.players.length < 3) return cb({ error: "Нужно минимум 3 игрока" });
    if (lobby.players.some((player) => !player.ready)) {
      return cb({ error: "Все игроки должны нажать «Готов»" });
    }

    const spyCount = getSpyCount(lobby);
    const spies = shuffle(lobby.players.map((player) => player.id)).slice(0, spyCount);

    lobby.started = true;
    lobby.phase = "playing";
    lobby.round = 1;
    lobby.theme = pickTheme();
    lobby.spies = spies;
    lobby.spy = spies[0] || null;
    lobby.baseOrder = shuffle(lobby.players.map((player) => player.id));
    lobby.order = [...lobby.baseOrder];
    lobby.currentTurnIndex = 0;
    lobby.votes = {};
    lobby.voteRound = 1;
    lobby.voteCandidates = [];
    lobby.voteTimeLeft = null;
    lobby.lastTrack = null;
    lobby.currentTrackReactions = {};
    lobby.trackHistory = [];
    lobby.suspected = [];
    lobby.finalVotes = null;
    lobby.spyGuess = null;
    lobby.pendingSpyGuess = null;
    lobby.spyGuessTimeLeft = null;
    lobby.spyGuessMode = null;
    lobby.spyGuessTargetId = null;
    lobby.submittedThisTurn = false;
    lobby.turnStage = "waiting";
    lobby.timeLeft = null;
    lobby.pausedTurnStage = null;

    for (const player of lobby.players) {
      io.to(player.id).emit("gameStarted", {
        code: lobby.code,
        host: lobby.host,
        role: lobby.spies.includes(player.id) ? "spy" : "civilian",
        theme: lobby.spies.includes(player.id) ? null : lobby.theme,
        round: lobby.round,
        totalRounds: lobby.settings.rounds,
        order: lobby.order,
        players: lobby.players,
        spyCount: lobby.spies.length,
        spyIds: lobby.spies.includes(player.id) ? lobby.spies : [],
        settings: lobby.settings,
        trackHistory: lobby.trackHistory
      });
    }

    cb({ success: true });
    emitLobbyUpdate(lobby.code);
    startTurn(lobby.code);
  });


  socket.on("hostSkipTurn", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может пропустить ход" });
    if (lobby.phase !== "playing") return cb({ error: "Сейчас нет активного хода" });

    const skippedPlayerId = lobby.order[lobby.currentTurnIndex];
    const skippedPlayer = lobby.players.find((player) => player.id === skippedPlayerId);
    io.to(lobby.code).emit("hostAction", {
      message: `Хост пропустил ход: ${skippedPlayer?.name || "игрок"}`
    });
    cb({ success: true });
    advanceTurn(lobby.code);
  });


  socket.on("hostTogglePause", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может ставить ход на паузу" });
    if (lobby.phase !== "playing") return cb({ error: "Пауза доступна только во время игры" });

    const paused = lobby.turnStage !== "paused";
    const ok = paused ? pauseTurnTimer(lobby) : resumeTurnTimer(lobby);
    if (!ok) return cb({ error: paused ? "Поставить на паузу можно только во время прослушивания" : "Продолжить можно только после паузы" });

    io.to(lobby.code).emit("hostAction", { message: paused ? "Хост поставил прослушивание на паузу" : "Хост продолжил прослушивание" });
    cb({ success: true, paused, timeLeft: lobby.timeLeft });
  });

  socket.on("hostAdjustTimer", ({ code, delta }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может менять таймер" });
    const normalizedDelta = Math.sign(Number(delta) || 0) * HOST_TIMER_STEP_SECONDS;
    if (!normalizedDelta) return cb({ error: "Выбери изменение таймера" });
    const timeLeft = adjustTurnTimer(lobby, normalizedDelta);
    if (timeLeft === null) return cb({ error: "Таймер можно менять только во время прослушивания" });

    io.to(lobby.code).emit("hostAction", { message: `Хост ${normalizedDelta > 0 ? "добавил" : "убрал"} 15 секунд` });
    cb({ success: true, timeLeft });
  });

  socket.on("hostAdjustRounds", ({ code, delta }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может менять раунды" });
    if (lobby.phase !== "playing") return cb({ error: "Раунды можно менять только во время игры" });

    const normalizedDelta = Math.sign(Number(delta) || 0);
    if (!normalizedDelta) return cb({ error: "Выбери изменение раундов" });
    const minRounds = Math.max(1, lobby.round || 1);
    const nextRounds = Math.max(minRounds, Math.min(8, Number(lobby.settings.rounds || DEFAULT_SETTINGS.rounds) + normalizedDelta));
    if (nextRounds === lobby.settings.rounds) return cb({ error: normalizedDelta < 0 ? "Нельзя убрать текущий или прошедший раунд" : "Достигнут максимум раундов" });

    lobby.settings.rounds = nextRounds;
    io.to(lobby.code).emit("hostAction", { message: `Хост изменил число раундов: ${nextRounds}` });
    cb({ success: true, rounds: nextRounds });
    emitLobbyUpdate(lobby.code);
    emitGameState(lobby.code);
  });

  socket.on("hostSetTurn", ({ code, playerId }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может передать ход" });
    if (lobby.phase !== "playing") return cb({ error: "Ход можно передать только во время игры" });
    const targetIndex = lobby.order.indexOf(playerId);
    if (targetIndex === -1 || !lobby.players.some((player) => player.id === playerId)) return cb({ error: "Игрок не найден в очереди" });

    const target = lobby.players.find((player) => player.id === playerId);
    lobby.currentTurnIndex = targetIndex;
    io.to(lobby.code).emit("stopTrack");
    io.to(lobby.code).emit("hostAction", { message: `Хост передал ход: ${target?.name || "игрок"}` });
    cb({ success: true });
    startTurn(lobby.code);
  });

  socket.on("hostStartVoting", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост может запустить голосование" });
    if (lobby.phase !== "playing") return cb({ error: "Голосование можно запустить только во время игры" });

    io.to(lobby.code).emit("stopTrack");
    io.to(lobby.code).emit("hostAction", { message: "Хост досрочно запустил голосование" });
    cb({ success: true });
    startVoting(lobby.code);
  });

  socket.on("hostKickPlayer", ({ code, playerId }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Кикать игроков может только хост" });
    if (playerId === socket.id) return cb({ error: "Хост не может кикнуть себя" });

    const kickedPlayer = lobby.players.find((player) => player.id === playerId);
    if (!kickedPlayer) return cb({ error: "Игрок не найден" });

    const wasCurrentTurn = lobby.phase === "playing" && lobby.order[lobby.currentTurnIndex] === playerId;
    removePlayerFromLobby(lobby, playerId);

    const kickedSocket = io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(lobby.code);
      kickedSocket.emit("kicked", { reason: "Хост удалил тебя из комнаты" });
    }

    io.to(lobby.code).emit("hostAction", { message: `Хост кикнул игрока ${kickedPlayer.name}` });
    cb({ success: true });

    if (lobby.phase === "playing" && lobby.players.length < 3) {
      clearTimer(lobby.code);
      resetLobbyToWaiting(lobby);
      io.to(lobby.code).emit("gameCancelled", { reason: "Игрок кикнут — нужно минимум 3 участника" });
    } else if (lobby.phase === "playing" && wasCurrentTurn) {
      startTurn(lobby.code);
    } else if (lobby.phase === "playing") {
      emitGameState(lobby.code);
    } else if (lobby.phase === "voting") {
      io.to(lobby.code).emit("voteUpdate", {
        votes: lobby.settings.anonymousVoting ? {} : publicVotes(lobby),
        votedCount: Object.keys(lobby.votes).length,
        total: lobby.players.length,
        anonymous: lobby.settings.anonymousVoting,
        voteRound: lobby.voteRound
      });

      if (Object.keys(lobby.votes).length >= lobby.players.length) {
        finishVote(lobby.code);
      }
    } else if (lobby.phase === "spyGuess" && !lobby.players.some((player) => lobby.spies.includes(player.id))) {
      finishGame(lobby.code, lobby.suspected || [], lobby.finalVotes || null, { text: "", correct: false, skipped: true });
    }

    emitLobbyUpdate(lobby.code);
  });

  socket.on("playTrack", ({ code, url }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    const trackUrl = String(url || "").trim();
    if (!lobby || lobby.phase !== "playing") return cb({ error: "Сейчас нельзя отправить трек" });
    if (lobby.order[lobby.currentTurnIndex] !== socket.id) return cb({ error: "Сейчас ход другого игрока" });
    if (lobby.submittedThisTurn) return cb({ error: "Трек уже отправлен" });
    if (!isSupportedTrackUrl(trackUrl)) return cb({ error: "Вставь ссылку YouTube или SoundCloud" });

    const player = lobby.players.find((item) => item.id === socket.id);
    lobby.submittedThisTurn = true;
    lobby.currentTrackReactions = {};
    lobby.lastTrack = {
      id: `${lobby.round}-${lobby.currentTurnIndex + 1}-${Date.now()}`,
      url: trackUrl,
      playerId: socket.id,
      playerName: player?.name || "Игрок",
      round: lobby.round,
      turnNumber: lobby.currentTurnIndex + 1
    };
    lobby.trackHistory.push({ ...lobby.lastTrack, reactions: {} });

    io.to(lobby.code).emit("newTrack", { ...lobby.lastTrack, reactionCounts: {} });
    cb({ success: true });
    startListeningTimer(lobby.code);
  });

  socket.on("trackReaction", ({ code, reaction }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "playing" || !lobby.lastTrack) {
      return cb({ error: "Сейчас не на что реагировать" });
    }
    if (!lobby.players.some((player) => player.id === socket.id)) {
      return cb({ error: "Ты не в этой комнате" });
    }
    if (!ALLOWED_REACTIONS.includes(reaction)) {
      return cb({ error: "Такой реакции нет" });
    }
    if (lobby.lastTrack.playerId === socket.id) {
      return cb({ error: "Нельзя ставить реакции на свой трек" });
    }

    if (lobby.currentTrackReactions[socket.id] === reaction) {
      delete lobby.currentTrackReactions[socket.id];
    } else {
      lobby.currentTrackReactions[socket.id] = reaction;
    }

    syncLastTrackHistory(lobby);
    const reactionCounts = countReactions(lobby.currentTrackReactions);
    const selectedReaction = lobby.currentTrackReactions[socket.id] || null;
    io.to(lobby.code).emit("reactionUpdate", {
      trackId: lobby.lastTrack.id,
      reactionCounts,
      trackHistory: lobby.trackHistory
    });
    cb({ success: true, selectedReaction, reactionCounts });
  });

  socket.on("vote", ({ code, target }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "voting") return cb({ error: "Голосование еще не началось" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (!lobby.voteCandidates.includes(target)) return cb({ error: "Этот игрок не участвует в текущем голосовании" });
    if (target === socket.id) return cb({ error: "Нельзя голосовать за себя" });

    lobby.votes[socket.id] = target;
    const voteTotals = publicVotes(lobby);
    io.to(lobby.code).emit("voteUpdate", {
      votes: lobby.settings.anonymousVoting ? {} : voteTotals,
      votedCount: Object.keys(lobby.votes).length,
      total: lobby.players.length,
      anonymous: lobby.settings.anonymousVoting,
      voteRound: lobby.voteRound
    });
    cb({ success: true });

    if (Object.keys(lobby.votes).length >= lobby.players.length) {
      finishVote(lobby.code);
    }
  });

  socket.on("submitSpyGuess", ({ code, guess }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "spyGuess") return cb({ error: "Сейчас нельзя угадывать тему" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (!lobby.spies.includes(socket.id)) return cb({ error: "Тему угадывает только шпион" });

    const text = String(guess || "").trim().slice(0, 80);
    if (!text) return cb({ error: "Введи версию темы" });
    if (lobby.pendingSpyGuess) return cb({ error: "Версия уже отправлена хосту" });

    clearTimer(lobby.code);
    const player = lobby.players.find((item) => item.id === socket.id);
    const pendingGuess = { text, playerId: socket.id, playerName: player?.name || "Шпион", skipped: false };
    lobby.pendingSpyGuess = pendingGuess;
    lobby.spyGuess = pendingGuess;

    io.to(lobby.host).emit("spyGuessSubmitted", { guess: pendingGuess, spies: lobby.spies });
    io.to(lobby.code).emit("spyGuessPending", { guess: pendingGuess });
    cb({ success: true });
    emitGameState(lobby.code);
  });

  socket.on("hostResolveSpyGuess", ({ code, correct }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Только хост решает, угадал ли шпион" });
    if (lobby.phase !== "spyGuess" || !lobby.pendingSpyGuess) return cb({ error: "Нет версии шпиона на рассмотрении" });

    const spyGuess = { ...lobby.pendingSpyGuess, correct: Boolean(correct), skipped: false };
    lobby.spyGuess = spyGuess;
    lobby.pendingSpyGuess = null;
    cb({ success: true });
    finishGame(lobby.code, lobby.suspected || [], lobby.finalVotes || null, spyGuess);
  });

  socket.on("restartLobby", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Перезапустить может только хост" });

    clearTimer(lobby.code);
    resetLobbyToWaiting(lobby);
    cb({ success: true });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("disconnect", () => {
    for (const code of Object.keys(lobbies)) {
      const lobby = lobbies[code];
      const wasInLobby = lobby.players.some((player) => player.id === socket.id);
      if (!wasInLobby) continue;

      handlePlayerDeparture(lobby, socket, { leaveRoom: false });
    }
  });
});

function isSupportedTrackUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname)
      || /(^|\.)youtu\.be$/i.test(parsed.hostname)
      || /(^|\.)soundcloud\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function pickTheme() {
  const themes = [
    "ру андер ск",
    "англ андер ск",
    "ру реп новая школа",
    "олдскул хип хоп",
    "бразил фонк тайп",
    "дрилл",
    "мемфис фонк тайп",
    "ру хайперпоп",
    "англ хайперпоп",
    "дрейн",
    "классика рока 90-х",
    "ремиксы",
    "кринж",
    "хит прошлого лета",
    "чилловый приятный тречок",
    "едм электронщина",
    "мемы/музыка из мемов",
    "ностальгия",
    "дотерский трек",
    "молодой исполнитель >18",
    "хиты 2021",
    "легендарные треки",
    "трепахолик",
    "тикток музло",
    "умерший исполнитель",
    "худший трек в истории мира",
  ];

  return themes[Math.floor(Math.random() * themes.length)];
}

if (require.main === module) {
  server.listen(process.env.PORT || 3000, () => {
    console.log(`Music Spy server running; users store: ${USERS_FILE}`);
  });
}

module.exports = {
  ALLOWED_REACTIONS,
  GAME_MODES,
  buildFinalBreakdown,
  normalizeGuess,
  normalizeSettings,
  countReactions,
  getActiveTurnOrder,
  removePlayerFromLobby,
  handlePlayerDeparture,
  playerFromSocket,
  normalizeAvatar,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  resolveDataDir,
  pauseTurnTimer,
  resumeTurnTimer,
  adjustTurnTimer
};
