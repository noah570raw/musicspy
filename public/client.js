const socket = io();

const DEFAULT_LISTEN_TIME = 30;
const state = {
  currentCode: "",
  myId: "",
  hostId: "",
  lobby: null,
  settings: {},
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
  votedTarget: null,
  voteCandidates: [],
  anonymousVoting: false,
  ready: false
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

function buildInviteLink(code = state.currentCode) {
  if (!code) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
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
    if (res?.error) {
      const statusId = state.phase === "game" ? "gameStatus" : "voteStatus";
      return setStatus(statusId, res.error, true);
    }
    showScreen("lobby");
  });
}

function hostSkipTurn() {
  socket.emit("hostSkipTurn", { code: state.currentCode }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", "Ход пропущен");
  });
}

function hostStartVoting() {
  socket.emit("hostStartVoting", { code: state.currentCode }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", "Запускаем голосование...");
  });
}

function hostKickPlayer(playerId) {
  socket.emit("hostKickPlayer", { code: state.currentCode, playerId }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", "Игрок удален из комнаты");
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

async function copyInviteLink() {
  const link = buildInviteLink();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    setStatus("lobbyStatus", "Ссылка-приглашение скопирована");
  } catch {
    setStatus("lobbyStatus", link);
  }
}

function readSettingsFromForm() {
  const spyModeValue = $("settingSpyMode").value;
  return {
    rounds: Number($("settingRounds").value),
    listenTime: Number($("settingListenTime").value),
    spyMode: spyModeValue === "auto" ? "auto" : "manual",
    spyCount: spyModeValue === "auto" ? 1 : Number(spyModeValue),
    anonymousVoting: $("settingAnonymousVoting").value === "true",
    votingTime: Number($("settingVotingTime").value),
    runoffOnTie: $("settingRunoffOnTie").value === "true"
  };
}

function updateLobbySettings() {
  if (!state.currentCode || state.lobby?.host !== socket.id) return;
  socket.emit("updateSettings", { code: state.currentCode, settings: readSettingsFromForm() }, (res) => {
    if (res?.error) return setStatus("lobbyStatus", res.error, true);
    setStatus("lobbyStatus", "Настройки обновлены");
  });
}

function toggleReady() {
  if (!state.currentCode) return;
  socket.emit("setReady", { code: state.currentCode, ready: !state.ready }, (res) => {
    if (res?.error) return setStatus("lobbyStatus", res.error, true);
    state.ready = Boolean(res.ready);
    setStatus("lobbyStatus", state.ready ? "Ты отметил готовность" : "Готовность снята");
  });
}

function changeNickname() {
  if (!state.currentCode) return;
  const value = $("renameInput").value.trim();
  if (!value) return setStatus("lobbyStatus", "Введи новый ник", true);
  socket.emit("updateName", { code: state.currentCode, name: value }, (res) => {
    if (res?.error) return setStatus("lobbyStatus", res.error, true);
    $("name").value = res.name || value;
    $("renameInput").value = "";
    setStatus("lobbyStatus", `Ник обновлен: ${res.name || value}`);
  });
}

function applySettingsToForm(settings = {}, isHost = false) {
  const spyValue = settings.spyMode === "manual" ? String(settings.spyCount || 1) : "auto";
  const fields = {
    settingRounds: settings.rounds || 3,
    settingListenTime: settings.listenTime || DEFAULT_LISTEN_TIME,
    settingSpyMode: spyValue,
    settingAnonymousVoting: String(Boolean(settings.anonymousVoting)),
    settingVotingTime: settings.votingTime ?? 60,
    settingRunoffOnTie: String(settings.runoffOnTie !== false)
  };

  for (const [id, value] of Object.entries(fields)) {
    const el = $(id);
    if (!el) continue;
    el.value = String(value);
    el.disabled = !isHost;
  }

  $("settingsHint").textContent = isHost ? "ты можешь менять" : "меняет хост";
}

function sendTrack() {
  const url = $("url").value.trim();
  setStatus("gameStatus");
  socket.emit("playTrack", { code: state.currentCode, url }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    $("url").value = "";
    setStatus("gameStatus", `Трек принят. Слушаем ${state.settings.listenTime || DEFAULT_LISTEN_TIME} секунд...`);
    state.turnStage = "listening";
    updateSendButton(true);
  });
}

function vote(target) {
  socket.emit("vote", { code: state.currentCode, target }, (res) => {
    if (res?.error) return setStatus("voteStatus", res.error, true);
    state.votedTarget = target;
    setStatus("voteStatus", "Голос учтен");
  });
}

function renderLobby(lobby) {
  state.lobby = lobby;
  state.players = lobby.players || [];
  state.settings = lobby.settings || state.settings;
  state.currentCode = lobby.code || state.currentCode;
  state.hostId = lobby.host || state.hostId;

  $("copyCode").textContent = state.currentCode || "-----";
  const inviteLink = buildInviteLink();
  const qr = $("inviteQr");
  if (inviteLink) {
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(inviteLink)}`;
    qr.classList.remove("hidden");
  } else {
    qr.removeAttribute("src");
    qr.classList.add("hidden");
  }
  const isHost = lobby.host === socket.id;
  const me = state.players.find((player) => player.id === socket.id);
  state.ready = Boolean(me?.ready);
  const readyCount = state.players.filter((player) => player.ready).length;
  $("hostBadge").textContent = isHost ? "ты хост" : "хост: " + (state.players.find((p) => p.id === lobby.host)?.name || "...");
  $("startBtn").disabled = !isHost || state.players.length < 3 || readyCount !== state.players.length;
  $("startBtn").textContent = state.players.length < 3
    ? "Ждем минимум 3 игроков"
    : readyCount !== state.players.length
      ? "Ждем готовность всех игроков"
      : "Запустить игру";
  $("readyBtn").textContent = state.ready ? "Не готов" : "Я готов";
  $("readySummary").textContent = `Готовы: ${readyCount}/${state.players.length}`;
  applySettingsToForm(state.settings, isHost);

  $("players").innerHTML = state.players.map((player, index) => `
    <div class="player-row">
      <span class="avatar">${index + 1}</span>
      <strong>${escapeHtml(player.name)}</strong>
      ${player.ready ? "<em>готов</em>" : "<em>не готов</em>"}
      ${player.id === lobby.host ? "<em>host</em>" : ""}
      ${player.id === socket.id ? "<em>ты</em>" : ""}
    </div>
  `).join("");

  if (state.phase === "game") renderHostControls();
}

function renderGameState(data) {
  state.players = data.players || state.players;
  state.order = data.order || state.order;
  state.hostId = data.host || state.hostId;
  state.settings = data.settings || state.settings;
  state.currentPlayerId = data.currentPlayerId;
  state.round = data.round || state.round;
  state.totalRounds = data.totalRounds || state.totalRounds;
  state.turnStage = data.turnStage || state.turnStage;
  state.timeLeft = data.timeLeft ?? state.timeLeft;
  state.voteCandidates = data.voteCandidates || state.voteCandidates;

  $("roundInfo").textContent = `Раунд ${state.round}/${state.totalRounds}`;
  $("roundBar").style.width = `${Math.min(100, (state.round / state.totalRounds) * 100)}%`;
  renderOrder();
  renderHostControls();
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

function renderHostControls() {
  const controls = $("hostControls");
  const kickList = $("hostKickList");
  if (!controls || !kickList) return;

  const isHost = state.hostId === socket.id;
  controls.classList.toggle("hidden", !isHost);
  if (!isHost) {
    kickList.innerHTML = "";
    return;
  }

  kickList.innerHTML = state.players.map((player) => {
    const isMe = player.id === socket.id;
    const isCurrent = player.id === state.currentPlayerId;
    return `
      <button class="kick-row" ${isMe ? "disabled" : ""} onclick="hostKickPlayer('${escapeAttribute(player.id)}')">
        <span>${escapeHtml(player.name)} ${isMe ? "(ты)" : ""}</span>
        <strong>${isMe ? "хост" : isCurrent ? "ходит" : "кик"}</strong>
      </button>
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
  updateTimer({ timeLeft: null, stage: "waiting", listenTime: state.settings.listenTime || DEFAULT_LISTEN_TIME });
  setStatus("gameStatus", isMine ? "Очередь ждет тебя: вставь ссылку на трек." : "Ждем, пока игрок поставит трек. Таймер пока не идет.");
  renderOrder();
  renderHostControls();
  updateSendButton(false);
}

function updateSendButton(submitted = false) {
  const isMine = state.currentPlayerId === socket.id;
  const listening = state.turnStage === "listening";
  $("sendBtn").disabled = !isMine || submitted || listening;
  $("url").disabled = !isMine || submitted || listening;
  $("sendBtn").textContent = submitted || listening ? "Трек играет" : isMine ? "Отправить трек" : "Ждем ход";
}

function updateTimer({ timeLeft, stage = "waiting", listenTime = DEFAULT_LISTEN_TIME }) {
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

function updateVoteTimer(timeLeft) {
  const el = $("voteTimer");
  if (!el) return;
  el.classList.toggle("hidden", timeLeft === null || timeLeft === undefined);
  el.textContent = timeLeft;
}

function clearPlayer() {
  const embed = $("embed");
  const activeIframes = embed.querySelectorAll("iframe");
  activeIframes.forEach((frame) => {
    frame.src = "about:blank";
  });
  embed.className = "embed empty";
  embed.innerHTML = "<span>Ждем трек от текущего игрока</span>";
  ["tickSound", "startSound", "revealSound"].forEach((id) => {
    const media = $(id);
    if (media && typeof media.pause === "function") {
      media.pause();
      media.currentTime = 0;
    }
  });
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
    setStatus("gameStatus", `${track.playerName} поставил трек — слушаем ${state.settings.listenTime || DEFAULT_LISTEN_TIME} секунд`);
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
  const candidates = state.voteCandidates.length ? state.voteCandidates : state.players.map((player) => player.id);
  $("voteList").innerHTML = state.players.filter((player) => candidates.includes(player.id)).map((player) => {
    const isMe = player.id === socket.id;
    const countMarkup = state.anonymousVoting ? "<strong>?</strong>" : `<strong>${voteCounts[player.id] || 0}</strong>`;
    return `
      <button class="vote-row ${state.votedTarget === player.id ? "selected" : ""}" ${isMe ? "disabled" : ""} onclick="vote('${player.id}')">
        <span>${escapeHtml(player.name)} ${isMe ? "(ты)" : ""}</span>
        ${countMarkup}
      </button>
    `;
  }).join("");
}

function renderResults(data) {
  const suspectedNames = data.suspected.map((id) => state.players.find((player) => player.id === id)?.name || "Игрок").join(", ");
  const spyNames = data.spyNames?.length ? data.spyNames.join(", ") : data.spyName;
  $("resultTitle").textContent = data.civiliansWin ? "Шпион паражняк" : "Шпион красавчик";
  $("resultText").textContent = `Шпионы: ${spyNames}. Тема: «${data.theme}». Зачервили: ${suspectedNames || "никто"}.`;
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

window.addEventListener("DOMContentLoaded", () => {
  const presetCode = new URL(window.location.href).searchParams.get("room");
  if (presetCode) {
    $("code").value = presetCode.slice(0, 5).toUpperCase();
    setStatus("menuError", "Код комнаты подставлен из ссылки. Введи ник и нажми «Войти по коду».");
  }
});

socket.on("gameStarted", (data) => {
  state.role = data.role;
  state.theme = data.theme;
  state.hostId = data.host || state.hostId;
  state.players = data.players;
  state.order = data.order;
  state.totalRounds = data.totalRounds;
  state.settings = data.settings || state.settings;
  state.currentCode = data.code;
  state.votedTarget = null;
  state.turnStage = "waiting";
  state.timeLeft = null;

  $("roleTitle").textContent = data.role === "spy" ? "Ты шпион" : "Ты мирный";
  $("theme").textContent = data.role === "spy"
    ? `Твоя задача — понять тему по чужим трекам и не выдать себя. Шпионов в игре: ${data.spyCount || 1}.`
    : `Тема: «${data.theme}»`;
  $("embed").className = "embed empty";
  $("embed").innerHTML = "<span>Здесь появится YouTube/SoundCloud плеер</span>";

  showScreen("game");
  renderOrder();
  renderHostControls();
});

socket.on("gameState", renderGameState);
socket.on("turn", updateTurn);
socket.on("timer", updateTimer);
socket.on("voteTimer", ({ timeLeft }) => updateVoteTimer(timeLeft));
socket.on("newTrack", loadTrack);
socket.on("roundStarted", ({ round, order }) => {
  state.round = round;
  state.order = order;
  setStatus("gameStatus", `Начался раунд ${round}`);
  renderOrder();
  renderHostControls();
});

socket.on("votingStarted", ({ players, votes, anonymous, voteRound, candidates, votingTime }) => {
  state.players = players;
  state.votedTarget = null;
  state.anonymousVoting = Boolean(anonymous);
  state.voteCandidates = candidates || [];
  clearPlayer();
  showScreen("voting");
  renderVoteList(votes);
  updateVoteTimer(votingTime > 0 ? votingTime : null);
  $("voteDescription").textContent = voteRound > 1
    ? "Ничья! Голосуем во втором туре только между кандидатами."
    : anonymous
      ? "Анонимное голосование: счет голосов откроется только в конце."
      : "Выбери игрока, который хуже всех попадал в тему. Менять голос можно до конца голосования.";
  setStatus("voteStatus", voteRound > 1 ? "Второй тур начался" : "Голосование началось");
});

socket.on("voteUpdate", ({ votes, votedCount, total, anonymous }) => {
  state.anonymousVoting = Boolean(anonymous);
  renderVoteList(votes);
  setStatus("voteStatus", `Проголосовало ${votedCount}/${total}`);
});

socket.on("runoffStarted", () => {
  setStatus("voteStatus", "Ничья — запускаем второй тур");
});

socket.on("gameEnd", (data) => {
  clearPlayer();
  showScreen("results");
  updateVoteTimer(null);
  renderResults(data);
});

socket.on("hostAction", ({ message }) => {
  if (message) setStatus("gameStatus", message);
});

socket.on("kicked", ({ reason }) => {
  state.currentCode = "";
  state.lobby = null;
  state.players = [];
  state.order = [];
  clearPlayer();
  showScreen("menu");
  setStatus("menuError", reason || "Тебя удалили из комнаты", true);
});

socket.on("gameCancelled", ({ reason }) => {
  clearPlayer();
  showScreen("lobby");
  setStatus("lobbyStatus", reason, true);
});
