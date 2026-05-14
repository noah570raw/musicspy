:root {
  --bg: #050505;
  --panel: rgba(14, 14, 14, 0.86);
  --panel-strong: rgba(24, 24, 24, 0.96);
  --line: rgba(255, 255, 255, 0.1);
  --muted: #b8b8b8;
  --text: #f7f7fb;
  --accent: #e50914;
  --accent-2: #ffffff;
  --danger: #ff1f2d;
  --success: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 20% 10%, rgba(229, 9, 20, 0.22), transparent 28rem),
    radial-gradient(circle at 80% 70%, rgba(255, 255, 255, 0.08), transparent 24rem),
    var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input {
  font: inherit;
}

button {
  border: 0;
}

.noise {
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.23;
  background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(circle, black, transparent 82%);
}

.orb {
  position: fixed;
  width: 16rem;
  height: 16rem;
  border-radius: 999px;
  filter: blur(24px);
  opacity: 0.42;
  animation: float 8s ease-in-out infinite;
}

.orb-one {
  top: 8%;
  left: 7%;
  background: var(--accent);
}
codex/add-lobby-settings-for-customizable-game-rules-kb9lz9
.orb-two {
  right: 9%;
  bottom: 10%;
  background: var(--accent-2);
  animation-delay: -3s;
}

@keyframes float {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(18px, -22px, 0) scale(1.08); }
}

.app-shell {
  position: relative;
  z-index: 1;
  width: min(1180px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  display: grid;
  place-items: center;
  padding: 32px 0;
}

.card {
  width: min(100%, 520px);
  padding: 30px;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: linear-gradient(145deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025)), var(--panel);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.08);
  backdrop-filter: blur(22px);
}

.screen {
  animation: pop 0.42s ease both;
}

@keyframes pop {
  from { opacity: 0; transform: translateY(18px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.hidden {
  display: none !important;
}

.hero-card {
  text-align: center;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--accent-2);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
  line-height: 0.95;
  letter-spacing: -0.06em;
}

h1 {
  font-size: clamp(3.5rem, 12vw, 7rem);
  background: linear-gradient(100deg, #fff, #ff3340 48%, #ffffff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 34px rgba(229, 9, 20, 0.22);
}

h2 {
  font-size: clamp(2rem, 6vw, 3.5rem);
}

.lead {
  margin: 18px auto 24px;
  max-width: 42rem;
  color: var(--muted);
  line-height: 1.65;
}

.lead.small {
  margin-top: 12px;
  font-size: 0.95rem;
}

.form-grid {
  display: grid;
  gap: 14px;
  text-align: left;
}

label span {
  display: block;
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
}

input {
  width: 100%;
  padding: 15px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  outline: none;
  background: rgba(0, 0, 0, 0.32);
  color: var(--text);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

input:focus {
  border-color: rgba(229, 9, 20, 0.85);
  box-shadow: 0 0 0 4px rgba(229, 9, 20, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.actions,
.track-form {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.two-col {
  grid-template-columns: 1fr 1fr;
}

button {
  min-height: 50px;
  padding: 13px 18px;
  border-radius: 16px;
  color: var(--text);
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.18s ease, filter 0.18s ease, opacity 0.18s ease;
}

button:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.primary {
  background: linear-gradient(135deg, #e50914, #a8000b 52%, #ffffff);
  box-shadow: 0 16px 36px rgba(229, 9, 20, 0.32);
}

.secondary,
.code-pill {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.06);
}

.rules {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 22px;
}

.rules div,
.player-row,
.order-row,
.vote-row,
.turn-card {
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255,255,255,0.045);
}

.rules div {
  padding: 14px;
}

.rules strong {
  display: block;
  font-size: 1.3rem;
}

.rules span,
.status,
.turn-card span,
.turn-card small {
  color: var(--muted);
  font-size: 0.86rem;
}

.status {
  min-height: 20px;
  margin: 14px 0 0;
}

.error {
  color: var(--danger) !important;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.code-pill {
  width: auto;
  min-height: 0;
  margin-left: 8px;
  padding: 10px 12px;
  color: var(--accent-2);
  letter-spacing: 0.08em;
}

.badge {
  flex: 0 0 auto;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  color: var(--success);
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.8rem;
  font-weight: 800;
}

.players-list,
.order-list,
.vote-list {
  display: grid;
  gap: 10px;
  margin: 18px 0;
}

.invite-tools {
  margin: 14px 0 8px;
  display: grid;
  gap: 12px;
}

.lobby-actions {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.rename-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}
  
.qr-wrap {
  display: grid;
  place-items: center;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

#inviteQr {
  width: min(220px, 100%);
  border-radius: 12px;
}

.player-row,
.order-row,
.vote-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
}

.avatar,
.order-row span {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 12px;
  background: rgba(229, 9, 20, 0.22);
  color: #ffffff;
  font-weight: 800;
}

.player-row em {
  margin-left: auto;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  color: var(--muted);
  font-style: normal;
  font-size: 0.75rem;
}

.game-layout {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(230px, 0.8fr) minmax(360px, 1.4fr) minmax(220px, 0.7fr);
  gap: 18px;
  align-items: stretch;
}

.game-layout .card {
  width: 100%;
}

.side-panel,
.player-card {
  min-height: 560px;
}

.theme-text {
  color: var(--muted);
  line-height: 1.6;
}

.round-meter {
  margin: 24px 0;
}

.round-meter span {
  color: var(--muted);
  font-weight: 700;
}

.round-meter div {
  height: 10px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,0.07);
}

.round-meter i {
  display: block;
  width: 33%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #e50914, #ffffff);
}

.turn-card {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.turn-card strong {
  font-size: 1.3rem;
}

.player-card {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  gap: 18px;
}

.timer-ring {
  position: relative;
  width: 132px;
  height: 132px;
  margin: 0 auto;
}

.timer-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.timer-ring circle {
  fill: none;
  stroke-width: 9;
}

.timer-ring .track {
  stroke: rgba(255,255,255,0.08);
}

.timer-ring .progress {
  stroke: var(--accent-2);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.35s linear, stroke 0.2s;
}

.timer-ring .progress.danger {
  stroke: var(--danger);
}

.timer-ring div {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
}

.timer-ring strong {
  font-size: 2.5rem;
  line-height: 1;
}

.timer-ring span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.embed {
  display: grid;
  min-height: 310px;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: radial-gradient(circle at center, rgba(229, 9, 20, 0.18), rgba(255,255,255,0.035));
}

.embed.empty span {
  color: var(--muted);
}

.embed iframe {
  width: 100%;
  height: 100%;
  min-height: 310px;
  border: 0;
}

.embed a {
  color: var(--accent-2);
  font-weight: 800;
}

.order-row.active {
  border-color: rgba(229, 9, 20, 0.72);
  background: rgba(229, 9, 20, 0.13);
  box-shadow: 0 0 26px rgba(229, 9, 20, 0.18);
}

.vote-row {
  width: 100%;
  justify-content: space-between;
  text-align: left;
  background: rgba(255,255,255,0.055);
}

.vote-row.selected {
  border-color: rgba(229, 9, 20, 0.85);
  background: rgba(229, 9, 20, 0.18);
}

.vote-row.static {
  cursor: default;
}

@media (max-width: 920px) {
  .game-layout {
    grid-template-columns: 1fr;
  }

  .side-panel,
  .player-card {
    min-height: auto;
  }
}

@media (max-width: 560px) {
  .app-shell {
    width: min(100% - 18px, 1180px);
    padding: 10px 0;
  }

  .card {
    padding: 20px;
    border-radius: 22px;
  clearTimer(code);
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
const activeOrder = lobby.order.filter((id) => lobby.players.some((player) => player.id === id));
lobby.order = rotateOrder(activeOrder, 1);
io.to(code).emit("roundStarted", { round: lobby.round, order: lobby.order });

  
main
    io.to(code).emit("roundStarted", { round: lobby.round, order: lobby.order });
  }

  .two-col,
  .rules {
    grid-template-columns: 1fr;
  }

  .section-header {
    display: grid;
  finishGame(code, suspected, voteTotals);
}

function finishGame(code, suspected = [], voteTotals = null) {
  const lobby = lobbies[code];
  if (!lobby) return;

  const finalVotes = voteTotals || publicVotes(lobby);
  const spyPlayers = lobby.players.filter((player) => lobby.spies.includes(player.id));
  const civiliansWin = suspected.some((id) => lobby.spies.includes(id));

  lobby.phase = "ended";
  clearTimer(code);

  io.to(code).emit("gameEnd", {
    spies: lobby.spies,
    spy: lobby.spies[0] || null,
    spyNames: spyPlayers.map((player) => player.name),
    spyName: spyPlayers.map((player) => player.name).join(", ") || "Шпион",
    votes: finalVotes,
    suspected,
    civiliansWin,
    theme: lobby.theme,
    settings: lobby.settings
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
  lobby.submittedThisTurn = false;
  lobby.timeLeft = null;
  lobby.turnStage = "waiting";
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
    submittedThisTurn: false,
    timeLeft: null,
    turnStage: "waiting",
    settings: { ...DEFAULT_SETTINGS }
  };
}

io.on("connection", (socket) => {
  socket.on("createLobby", ({ name }, cb = () => {}) => {
    const code = generateCode();
    const player = { id: socket.id, name: normalizeName(name), ready: false };

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
    lobby.players.push({ id: socket.id, name: makeUniqueName(lobby, name), ready: false });

    cb({ success: true, code: roomCode, playerId: socket.id });
    emitLobbyUpdate(roomCode);
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
    lobby.order = rotateOrder(lobby.baseOrder, 0);
    lobby.currentTurnIndex = 0;
    lobby.votes = {};
    lobby.voteRound = 1;
    lobby.voteCandidates = [];
    lobby.voteTimeLeft = null;
    lobby.lastTrack = null;
    lobby.submittedThisTurn = false;
    lobby.turnStage = "waiting";
    lobby.timeLeft = null;

    for (const player of lobby.players) {
      io.to(player.id).emit("gameStarted", {
        code: lobby.code,
        role: lobby.spies.includes(player.id) ? "spy" : "civilian",
        theme: lobby.spies.includes(player.id) ? null : lobby.theme,
        round: lobby.round,
        totalRounds: lobby.settings.rounds,
        order: lobby.order,
        players: lobby.players,
        spyCount: lobby.spies.length,
        settings: lobby.settings
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

      const disconnectedOrderIndex = lobby.order.indexOf(socket.id);
      lobby.players = lobby.players.filter((player) => player.id !== socket.id);
      lobby.order = lobby.order.filter((id) => id !== socket.id);
      lobby.baseOrder = lobby.baseOrder.filter((id) => id !== socket.id);
      lobby.spies = lobby.spies.filter((id) => id !== socket.id);
      lobby.voteCandidates = lobby.voteCandidates.filter((id) => id !== socket.id);
      delete lobby.votes[socket.id];
      for (const [voter, target] of Object.entries(lobby.votes)) {
        if (target === socket.id) delete lobby.votes[voter];
      }

      if (lobby.host === socket.id && lobby.players.length > 0) {
        lobby.host = lobby.players[0].id;
      }

      if (lobby.players.length === 0) {
        clearTimer(code);
        delete lobbies[code];
        continue;
      }

      if (lobby.phase === "playing" && lobby.players.length < 3) {
        clearTimer(code);
        resetLobbyToWaiting(lobby);
        io.to(code).emit("gameCancelled", { reason: "Игрок вышел — нужно минимум 3 участника" });
      } else if (lobby.phase === "playing") {
        if (disconnectedOrderIndex !== -1 && disconnectedOrderIndex < lobby.currentTurnIndex) {
          lobby.currentTurnIndex = Math.max(0, lobby.currentTurnIndex - 1);
        }
        if (lobby.currentTurnIndex >= lobby.order.length) {
          lobby.currentTurnIndex = 0;
        }
        startTurn(code);
      } else if (lobby.phase === "voting" && Object.keys(lobby.votes).length >= lobby.players.length) {
        finishVote(code);
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

select {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  outline: none;
  background: rgba(0, 0, 0, 0.36);
  color: var(--text);
}

select:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.settings-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.035);
  text-align: left;
}

.settings-title {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.settings-title strong {
  font-size: 1rem;
}

.settings-title span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.vote-timer {
  display: grid;
  width: 76px;
  height: 76px;
  margin: 0 auto 14px;
  place-items: center;
  border: 1px solid rgba(229, 9, 20, 0.72);
  border-radius: 999px;
  background: rgba(229, 9, 20, 0.13);
  color: #ffffff;
  font-size: 1.8rem;
  font-weight: 900;
  box-shadow: 0 0 26px rgba(229, 9, 20, 0.18);
}

@media (max-width: 560px) {
  .settings-panel {
    grid-template-columns: 1fr;
  }
}
