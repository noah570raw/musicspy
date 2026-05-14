const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const lobbies = {};
const LISTEN_TIME = 30;
const TOTAL_ROUNDS = 3;
const timers = {};

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

function publicLobby(lobby) {
  return {
    code: lobby.code,
    host: lobby.host,
    players: lobby.players,
    started: lobby.started,
    phase: lobby.phase,
    minPlayers: 3,
    totalRounds: TOTAL_ROUNDS
  };
}

function emitLobbyUpdate(code) {
  const lobby = lobbies[code];
  if (!lobby) return;
  io.to(code).emit("lobbyUpdate", publicLobby(lobby));
}

function emitGameState(code) {
  const lobby = lobbies[code];
  if (!lobby) return;
  const currentPlayerId = lobby.order[lobby.currentTurnIndex] || null;
  const currentPlayer = lobby.players.find((player) => player.id === currentPlayerId);

  io.to(code).emit("gameState", {
    code,
    phase: lobby.phase,
    round: lobby.round,
    totalRounds: TOTAL_ROUNDS,
    order: lobby.order,
    currentPlayerId,
    currentPlayerName: currentPlayer?.name || "",
    turnNumber: lobby.currentTurnIndex + 1,
    turnsInRound: lobby.order.length,
    lastTrack: lobby.lastTrack,
    players: lobby.players,
    submittedThisTurn: lobby.submittedThisTurn,
    turnStage: lobby.turnStage,
    timeLeft: lobby.timeLeft,
    listenTime: LISTEN_TIME,
    votes: publicVotes(lobby)
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

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function clearTurnTimer(code) {
  clearInterval(timers[code]);
  delete timers[code];
}

function startListeningTimer(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "playing") return;

  clearTurnTimer(code);
  lobby.turnStage = "listening";
  lobby.timeLeft = LISTEN_TIME;
  io.to(code).emit("timer", {
    timeLeft: lobby.timeLeft,
    stage: lobby.turnStage,
    listenTime: LISTEN_TIME
  });
  emitGameState(code);

  timers[code] = setInterval(() => {
    const currentLobby = lobbies[code];
    if (!currentLobby || currentLobby.phase !== "playing" || currentLobby.turnStage !== "listening") {
      clearTurnTimer(code);
      return;
    }

    currentLobby.timeLeft -= 1;
    io.to(code).emit("timer", {
      timeLeft: currentLobby.timeLeft,
      stage: currentLobby.turnStage,
      listenTime: LISTEN_TIME
    });

    if (currentLobby.timeLeft <= 0) {
      advanceTurn(code);
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

  clearTurnTimer(code);
  lobby.submittedThisTurn = false;
  lobby.turnStage = "waiting";
  lobby.timeLeft = null;
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
    listenTime: LISTEN_TIME
  });
  emitGameState(code);
}

function advanceTurn(code) {
  const lobby = lobbies[code];
  if (!lobby || lobby.phase !== "playing") return;

  clearTurnTimer(code);
  lobby.currentTurnIndex += 1;

  if (lobby.currentTurnIndex >= lobby.order.length) {
    if (lobby.round >= TOTAL_ROUNDS) {
      startVoting(code);
      return;
    }

    lobby.round += 1;
    lobby.currentTurnIndex = 0;
    lobby.order = shuffle(lobby.players.map((player) => player.id));
    io.to(code).emit("roundStarted", { round: lobby.round, order: lobby.order });
  }

  startTurn(code);
}

function startVoting(code) {
  const lobby = lobbies[code];
  if (!lobby) return;

  clearTurnTimer(code);
  lobby.phase = "voting";
  lobby.votes = {};
  io.to(code).emit("votingStarted", {
    players: lobby.players,
    votes: publicVotes(lobby)
  });
  emitGameState(code);
}

function finishGame(code) {
  const lobby = lobbies[code];
  if (!lobby) return;

  const voteTotals = publicVotes(lobby);
  const sorted = Object.entries(voteTotals).sort((a, b) => b[1] - a[1]);
  const topVotes = sorted[0]?.[1] || 0;
  const suspected = sorted.filter(([, count]) => count === topVotes).map(([id]) => id);
  const spyPlayer = lobby.players.find((player) => player.id === lobby.spy);

  lobby.phase = "ended";
  clearTurnTimer(code);

  io.to(code).emit("gameEnd", {
    spy: lobby.spy,
    spyName: spyPlayer?.name || "Шпион",
    votes: voteTotals,
    suspected,
    civiliansWin: suspected.length === 1 && suspected[0] === lobby.spy,
    theme: lobby.theme
  });
  emitLobbyUpdate(code);
}

function resetLobbyToWaiting(lobby) {
  lobby.started = false;
  lobby.phase = "lobby";
  lobby.round = 0;
  lobby.spy = null;
  lobby.order = [];
  lobby.currentTurnIndex = 0;
  lobby.theme = "";
  lobby.votes = {};
  lobby.lastTrack = null;
  lobby.submittedThisTurn = false;
  lobby.timeLeft = null;
  lobby.turnStage = "waiting";
}

io.on("connection", (socket) => {
  socket.on("createLobby", ({ name }, cb = () => {}) => {
    const code = generateCode();
    const player = { id: socket.id, name: normalizeName(name) };

    lobbies[code] = {
      code,
      host: socket.id,
      players: [player],
      started: false,
      phase: "lobby",
      round: 0,
      spy: null,
      order: [],
      currentTurnIndex: 0,
      theme: "",
      votes: {},
      lastTrack: null,
      submittedThisTurn: false,
      timeLeft: null,
      turnStage: "waiting"
    };

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
    lobby.players.push({ id: socket.id, name: normalizeName(name) });

    cb({ success: true, code: roomCode, playerId: socket.id });
    emitLobbyUpdate(roomCode);
  });

  socket.on("startGame", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Начать игру может только хост" });
    if (lobby.players.length < 3) return cb({ error: "Нужно минимум 3 игрока" });

    lobby.started = true;
    lobby.phase = "playing";
    lobby.round = 1;
    lobby.theme = pickTheme();
    lobby.spy = lobby.players[Math.floor(Math.random() * lobby.players.length)].id;
    lobby.order = shuffle(lobby.players.map((player) => player.id));
    lobby.currentTurnIndex = 0;
    lobby.votes = {};
    lobby.lastTrack = null;
    lobby.submittedThisTurn = false;
    lobby.turnStage = "waiting";
    lobby.timeLeft = null;

    for (const player of lobby.players) {
      io.to(player.id).emit("gameStarted", {
        code: lobby.code,
        role: player.id === lobby.spy ? "spy" : "civilian",
        theme: player.id === lobby.spy ? null : lobby.theme,
        round: lobby.round,
        totalRounds: TOTAL_ROUNDS,
        order: lobby.order,
        players: lobby.players
      });
    }

    cb({ success: true });
    emitLobbyUpdate(lobby.code);
    startTurn(lobby.code);
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
    lobby.lastTrack = {
      url: trackUrl,
      playerId: socket.id,
      playerName: player?.name || "Игрок",
      round: lobby.round
    };

    io.to(lobby.code).emit("newTrack", lobby.lastTrack);
    cb({ success: true });
    startListeningTimer(lobby.code);
  });

  socket.on("vote", ({ code, target }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "voting") return cb({ error: "Голосование еще не началось" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (!lobby.players.some((player) => player.id === target)) return cb({ error: "Игрок не найден" });
    if (target === socket.id) return cb({ error: "Нельзя голосовать за себя" });

    lobby.votes[socket.id] = target;
    const voteTotals = publicVotes(lobby);
    io.to(lobby.code).emit("voteUpdate", {
      votes: voteTotals,
      votedCount: Object.keys(lobby.votes).length,
      total: lobby.players.length
    });
    cb({ success: true });

    if (Object.keys(lobby.votes).length >= lobby.players.length) {
      finishGame(lobby.code);
    }
  });

  socket.on("restartLobby", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Перезапустить может только хост" });

    clearTurnTimer(lobby.code);
    resetLobbyToWaiting(lobby);
    cb({ success: true });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("disconnect", () => {
    for (const code of Object.keys(lobbies)) {
      const lobby = lobbies[code];
      const wasInLobby = lobby.players.some((player) => player.id === socket.id);
      if (!wasInLobby) continue;

      lobby.players = lobby.players.filter((player) => player.id !== socket.id);
      lobby.order = lobby.order.filter((id) => id !== socket.id);
      delete lobby.votes[socket.id];
      for (const [voter, target] of Object.entries(lobby.votes)) {
        if (target === socket.id) delete lobby.votes[voter];
      }

      if (lobby.host === socket.id && lobby.players.length > 0) {
        lobby.host = lobby.players[0].id;
      }

      if (lobby.players.length === 0) {
        clearTurnTimer(code);
        delete lobbies[code];
        continue;
      }

      if (lobby.phase === "playing" && lobby.players.length < 3) {
        clearTurnTimer(code);
        resetLobbyToWaiting(lobby);
        io.to(code).emit("gameCancelled", { reason: "Игрок вышел — нужно минимум 3 участника" });
      } else if (lobby.phase === "playing") {
        if (lobby.currentTurnIndex >= lobby.order.length) {
          lobby.currentTurnIndex = 0;
        }
        startTurn(code);
      } else if (lobby.phase === "voting" && Object.keys(lobby.votes).length >= lobby.players.length) {
        finishGame(code);
      }

      emitLobbyUpdate(code);
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
  ];

  return themes[Math.floor(Math.random() * themes.length)];
}

server.listen(process.env.PORT || 3000, () => {
  console.log("Music Spy server running");
});
