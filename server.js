const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const lobbies = {};

// ⏱ TIMER SYSTEM
const TURN_TIME = 60;
const timers = {};
const timeLeft = {};

// генерация кода комнаты
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// shuffle
function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

io.on("connection", (socket) => {

  socket.on("createLobby", ({ name }, cb) => {
    const code = generateCode();

    lobbies[code] = {
      host: socket.id,
      players: [],
      started: false,
      round: 0,
      spy: null,
      order: [],
      currentTurn: 0,
      theme: "",
      votes: {}
    };

    socket.join(code);
    lobbies[code].players.push({ id: socket.id, name });

    cb({ code });
    io.to(code).emit("lobbyUpdate", lobbies[code]);
  });

  socket.on("joinLobby", ({ code, name }, cb) => {
    const lobby = lobbies[code];
    if (!lobby) return cb({ error: "Lobby not found" });
    if (lobby.started) return cb({ error: "Game already started" });

    socket.join(code);
    lobby.players.push({ id: socket.id, name });

    io.to(code).emit("lobbyUpdate", lobby);
    cb({ success: true });
  });

  socket.on("startGame", (code) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    lobby.started = true;
    lobby.round = 1;
    lobby.theme = pickTheme();

    lobby.spy =
      lobby.players[Math.floor(Math.random() * lobby.players.length)].id;

    lobby.order = shuffle(lobby.players.map(p => p.id));
    lobby.currentTurn = 0;

    lobby.players.forEach((p) => {
      const isSpy = p.id === lobby.spy;

      io.to(p.id).emit("gameStarted", {
        theme: isSpy ? null : lobby.theme,
        round: lobby.round,
        order: lobby.order,
        isSpy
      });
    });

    nextTurn(code);
  });

  socket.on("playTrack", ({ code, url }) => {
    io.to(code).emit("newTrack", url);
  });

  socket.on("vote", ({ code, target }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    lobby.votes[target] = (lobby.votes[target] || 0) + 1;

    io.to(code).emit("voteUpdate", lobby.votes);
  });

  // ⏱ TIMER
  function startTurnTimer(code) {
    clearInterval(timers[code]);

    timeLeft[code] = TURN_TIME;

    timers[code] = setInterval(() => {
      const lobby = lobbies[code];
      if (!lobby || !lobby.started) return;

      timeLeft[code]--;

      io.to(code).emit("timer", {
        timeLeft: timeLeft[code]
      });

      if (timeLeft[code] <= 0) {
        clearInterval(timers[code]);
        nextTurn(code);
      }
    }, 1000);
  }

  // 🎮 NEXT TURN
  function nextTurn(code) {
    const lobby = lobbies[code];
    if (!lobby) return;

    if (lobby.currentTurn >= lobby.order.length) {
      endGame(code);
      return;
    }

    const playerId = lobby.order[lobby.currentTurn];
    lobby.currentTurn++;

    const player = lobby.players.find(p => p.id === playerId);

    io.to(code).emit("turn", {
      playerId,
      name: player?.name
    });

    startTurnTimer(code);
  }

  function endGame(code) {
    const lobby = lobbies[code];
    if (!lobby) return;

    const spy = lobby.spy;
    const votes = lobby.votes;

    io.to(code).emit("gameEnd", { spy, votes });

    // 🧹 cleanup timers
    clearInterval(timers[code]);
    delete timers[code];
    delete timeLeft[code];
  }

  socket.on("disconnect", () => {
    for (const code in lobbies) {
      const lobby = lobbies[code];

      if (!lobby) continue;

      lobby.players = lobby.players.filter(p => p.id !== socket.id);

      // 🔁 смена хоста если он вышел
      if (lobby.host === socket.id && lobby.players.length > 0) {
        lobby.host = lobby.players[0].id;
      }

      // 🧹 удалить пустое лобби
      if (lobby.players.length === 0) {
        clearInterval(timers[code]);
        delete timers[code];
        delete timeLeft[code];
        delete lobbies[code];
        continue;
      }

      io.to(code).emit("lobbyUpdate", lobby);
    }
  });
});

// 🎭 30 THEME SYSTEM
function pickTheme() {
  const themes = [
    "фрешмены",
    "русские хиты",
    "2010-е треки",
    "underground rap",
    "tiktok songs",
    "old school hip-hop",

    "drill музыка",
    "phonk",
    "rage beats",
    "hyperpop",
    "sad songs",
    "motivational tracks",

    "аниме опенинги",
    "k-pop",
    "rock classics",
    "punk energy",
    "edm festival vibes",
    "techno underground",

    "ночные вайбы",
    "треки для машины",
    "депрессивные песни",
    "любовные треки",
    "агрессивный рэп",

    "летние хиты",
    "зимняя атмосфера",
    "nostalgia vibes",
    "viral youtube songs",
    "soundcloud underground",

    "инструменталы",
    "lofi beats",
    "experimental music"
  ];

  return themes[Math.floor(Math.random() * themes.length)];
}

server.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);