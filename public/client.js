const socket = io();

const LISTEN_TIME = 30;
const state = {
  currentCode: "",
  myId: "",
  lobby: null,
  players: [],
  order: [],
  currentPlayerId: null,
  phase: "menu",
  role: "",
  theme: "",
  round: 1,
  totalRounds: 3,
  timeLeft: null,
  turnStage: "waiting",
  votedTarget: null
};

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("hidden", screen.id !== id);
  }
  state.phase = id;
}

function setStatus(id, message = "", isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function getName() {
  return $("name").value.trim() || "Без имени";
}

function getCode() {
  return $("code").value.trim().toUpperCase();
}

function createLobby() {
  setStatus("menuError");
  socket.emit("createLobby", { name: getName() }, (res) => {
    if (res.error) return setStatus("menuError", res.error, true);
    state.currentCode = res.code;
    state.myId = res.playerId || socket.id;
    $("code").value = res.code;
    showScreen("lobby");
  });
}

function joinLobby() {
  setStatus("menuError");
  const code = getCode();
  if (!code) return setStatus("menuError", "Введи код комнаты", true);

  socket.emit("joinLobby", { code, name: getName() }, (res) => {
    if (res.error) return setStatus("menuError", res.error, true);
    state.currentCode = res.code || code;
    state.myId = res.playerId || socket.id;
    showScreen("lobby");
  });
}

function startGame() {
  setStatus("lobbyStatus", "Запускаем...");
  socket.emit("startGame", { code: state.currentCode }, (res) => {
    if (res?.error) setStatus("lobbyStatus", res.error, true);
  });
}

function restartLobby() {
  socket.emit("restartLobby", { code: state.currentCode }, (res) => {
    if (res?.error) return setStatus("voteStatus", res.error, true);
    showScreen("lobby");
  });
}

async function copyRoomCode() {
  if (!state.currentCode) return;
  try {
    await navigator.clipboard.writeText(state.currentCode);
    setStatus("lobbyStatus", "Код скопирован");
  } catch {
    setStatus("lobbyStatus", `Код комнаты: ${state.currentCode}`);
  }
}

function sendTrack() {
  const url = $("url").value.trim();
  setStatus("gameStatus");
  socket.emit("playTrack", { code: state.currentCode, url }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    $("url").value = "";
    setStatus("gameStatus", "Трек принят. Слушаем 30 секунд...");
    state.turnStage = "listening";
    updateSendButton(true);
  });
}

function vote(target) {
  socket.emit("vote", { code: state.currentCode, target }, (res) => {
    if (res?.error) return setStatus("voteStatus", res.error, true);
    state.votedTarget = target;
    renderVoteList();
    setStatus("voteStatus", "Голос учтен");
  });
}

function renderLobby(lobby) {
  state.lobby = lobby;
  state.players = lobby.players || [];
  state.currentCode = lobby.code || state.currentCode;

  $("copyCode").textContent = state.currentCode || "-----";
  const isHost = lobby.host === socket.id;
  $("hostBadge").textContent = isHost ? "ты хост" : "хост: " + (state.players.find((p) => p.id === lobby.host)?.name || "...");
  $("startBtn").disabled = !isHost || state.players.length < 3;
  $("startBtn").textContent = state.players.length < 3 ? "Ждем минимум 3 игроков" : "Запустить игру";

  $("players").innerHTML = state.players.map((player, index) => `
    <div class="player-row">
      <span class="avatar">${index + 1}</span>
      <strong>${escapeHtml(player.name)}</strong>
      ${player.id === lobby.host ? "<em>host</em>" : ""}
      ${player.id === socket.id ? "<em>ты</em>" : ""}
    </div>
  `).join("");
}

function renderGameState(data) {
  state.players = data.players || state.players;
  state.order = data.order || state.order;
  state.currentPlayerId = data.currentPlayerId;
  state.round = data.round || state.round;
  state.totalRounds = data.totalRounds || state.totalRounds;
  state.turnStage = data.turnStage || state.turnStage;
  state.timeLeft = data.timeLeft ?? state.timeLeft;

  $("roundInfo").textContent = `Раунд ${state.round}/${state.totalRounds}`;
  $("roundBar").style.width = `${Math.min(100, (state.round / state.totalRounds) * 100)}%`;
  renderOrder();
  updateSendButton(data.submittedThisTurn);

  if (data.turnStage === "listening" && data.lastTrack) loadTrack(data.lastTrack);
}

function renderOrder() {
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  $("order").innerHTML = state.order.map((id, index) => {
    const player = playersById.get(id);
    const active = id === state.currentPlayerId;
    return `
      <div class="order-row ${active ? "active" : ""}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(player?.name || "Игрок")}</strong>
      </div>
    `;
  }).join("");
}

function updateTurn({ playerId, name, round, turnNumber, turnsInRound, stage }) {
  state.currentPlayerId = playerId;
  state.round = round;
  state.turnStage = stage || "waiting";
  state.timeLeft = null;
  const isMine = playerId === socket.id;
  $("turn").innerHTML = `
    <span>${isMine ? "Твой ход" : "Сейчас ходит"}</span>
    <strong>${escapeHtml(name || "Игрок")}</strong>
    <small>ход ${turnNumber}/${turnsInRound}</small>
  `;
  clearPlayer();
  updateTimer({ timeLeft: null, stage: "waiting", listenTime: LISTEN_TIME });
  setStatus("gameStatus", isMine ? "Очередь ждет тебя: вставь ссылку на трек." : "Ждем, пока игрок поставит трек. Таймер пока не идет.");
  renderOrder();
  updateSendButton(false);
}

function updateSendButton(submitted = false) {
  const isMine = state.currentPlayerId === socket.id;
  const listening = state.turnStage === "listening";
  $("sendBtn").disabled = !isMine || submitted || listening;
  $("url").disabled = !isMine || submitted || listening;
  $("sendBtn").textContent = submitted || listening ? "Трек играет" : isMine ? "Отправить трек" : "Ждем ход";
}

function updateTimer({ timeLeft, stage = "waiting", listenTime = LISTEN_TIME }) {
  state.turnStage = stage;
  state.timeLeft = timeLeft;
  const waiting = timeLeft === null || timeLeft === undefined;
  $("timer").textContent = waiting ? "∞" : timeLeft;
  const circle = $("timerCircle");
  const circumference = 2 * Math.PI * 54;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = waiting ? circumference : circumference * (1 - Math.max(0, timeLeft) / listenTime);
  circle.classList.toggle("danger", !waiting && timeLeft <= 10);

  if (!waiting && timeLeft > 0 && timeLeft <= 5) {
    $("tickSound").currentTime = 0;
    $("tickSound").play().catch(() => {});
  }
}

function clearPlayer() {
  const embed = $("embed");
  embed.className = "embed empty";
  embed.innerHTML = "<span>Ждем трек от текущего игрока</span>";
}

function loadTrack(track) {
  const url = typeof track === "string" ? track : track.url;
  const embed = $("embed");
  const youtubeId = extractYoutubeId(url);
  const soundCloud = isSoundCloudUrl(url);

  embed.classList.remove("empty");
  if (youtubeId) {
    embed.innerHTML = `<iframe src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0" title="YouTube player" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  } else if (soundCloud) {
    embed.innerHTML = `<iframe src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&visual=true" title="SoundCloud player" allow="autoplay"></iframe>`;
  } else {
    embed.innerHTML = `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">Открыть трек</a>`;
  }

  if (track.playerName) {
    setStatus("gameStatus", `${track.playerName} поставил трек — слушаем 30 секунд`);
  }
}

function extractYoutubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("/")[0];
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
      if (shorts) return shorts[1];
      const embed = parsed.pathname.match(/\/embed\/([^/?]+)/);
      if (embed) return embed[1];
    }
  } catch {
    return "";
  }
  return "";
}

function isSoundCloudUrl(url) {
  try {
    return new URL(url).hostname.includes("soundcloud.com");
  } catch {
    return false;
  }
}

function renderVoteList(votes = {}) {
  const voteCounts = votes;
  $("voteList").innerHTML = state.players.map((player) => {
    const isMe = player.id === socket.id;
    return `
      <button class="vote-row ${state.votedTarget === player.id ? "selected" : ""}" ${isMe ? "disabled" : ""} onclick="vote('${player.id}')">
        <span>${escapeHtml(player.name)} ${isMe ? "(ты)" : ""}</span>
        <strong>${voteCounts[player.id] || 0}</strong>
      </button>
    `;
  }).join("");
}

function renderResults(data) {
  const suspectedNames = data.suspected.map((id) => state.players.find((player) => player.id === id)?.name || "Игрок").join(", ");
  $("resultTitle").textContent = data.civiliansWin ? "Мирные вычислили шпиона" : "Шпион не спалился";
  $("resultText").textContent = `Шпионом был ${data.spyName}. Тема: «${data.theme}». Под подозрением: ${suspectedNames || "никто"}.`;
  $("resultVotes").innerHTML = state.players.map((player) => `
    <div class="vote-row static">
      <span>${escapeHtml(player.name)}</span>
      <strong>${data.votes[player.id] || 0}</strong>
    </div>
  `).join("");
  $("restartBtn").classList.toggle("hidden", state.lobby?.host !== socket.id);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

socket.on("connect", () => {
  state.myId = socket.id;
});

socket.on("lobbyUpdate", (lobby) => {
  renderLobby(lobby);
  if (lobby.phase === "lobby" && state.phase !== "menu") showScreen("lobby");
});

socket.on("gameStarted", (data) => {
  state.role = data.role;
  state.theme = data.theme;
  state.players = data.players;
  state.order = data.order;
  state.totalRounds = data.totalRounds;
  state.currentCode = data.code;
  state.votedTarget = null;
  state.turnStage = "waiting";
  state.timeLeft = null;

  $("roleTitle").textContent = data.role === "spy" ? "Ты шпион" : "Ты мирный";
  $("theme").textContent = data.role === "spy"
    ? "Твоя задача — понять тему по чужим трекам и не выдать себя."
    : `Тема: «${data.theme}»`;
  $("embed").className = "embed empty";
  $("embed").innerHTML = "<span>Здесь появится YouTube/SoundCloud плеер</span>";

  showScreen("game");
  renderOrder();
});

socket.on("gameState", renderGameState);
socket.on("turn", updateTurn);
socket.on("timer", updateTimer);
socket.on("newTrack", loadTrack);
socket.on("roundStarted", ({ round, order }) => {
  state.round = round;
  state.order = order;
  setStatus("gameStatus", `Начался раунд ${round}`);
  renderOrder();
});

socket.on("votingStarted", ({ players, votes }) => {
  state.players = players;
  state.votedTarget = null;
  showScreen("voting");
  renderVoteList(votes);
  setStatus("voteStatus", "Голосование началось");
});

socket.on("voteUpdate", ({ votes, votedCount, total }) => {
  renderVoteList(votes);
  setStatus("voteStatus", `Проголосовало ${votedCount}/${total}`);
});

socket.on("gameEnd", (data) => {
  showScreen("results");
  renderResults(data);
});

socket.on("gameCancelled", ({ reason }) => {
  showScreen("lobby");
  setStatus("lobbyStatus", reason, true);
});
