const socket = io();

const DEFAULT_LISTEN_TIME = 30;
const ALLOWED_REACTIONS = ["🔥", "❤️", "😂", "😮", "🕵️", "🤔"];
const DEFAULT_SITE_VOLUME = 70;
const BACKGROUND_MUSIC_VOLUME = 0.13;
const DUCKED_BACKGROUND_MUSIC_VOLUME = 0.018;
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
  reactionCounts: {},
  selectedReaction: null,
  currentTrackId: null,
  trackHistory: [],
  siteVolume: DEFAULT_SITE_VOLUME,
  musicEnabled: true,
  audio: null,
  ready: false,
  inviteSecretsVisible: false
};

const $ = (id) => document.getElementById(id);

const AMBIENT_PAD_NOTES = [130.81, 146.83, 174.61, 196, 220, 261.63, 293.66, 329.63];
const AMBIENT_SHIMMER_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33];

function getAudioContextConstructor() {
  return window.AudioContext || window.webkitAudioContext;
}

function createAmbientImpulse(context) {
  const duration = 3.8;
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const tail = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * (tail ** 2.4) * 0.42;
    }
  }

  return impulse;
}

function createAudioEngine() {
  if (state.audio) return state.audio;
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) return null;

  const context = new AudioContextConstructor();
  const master = context.createGain();
  const fxGain = context.createGain();
  const musicGain = context.createGain();
  const fxFilter = context.createBiquadFilter();
  const musicFilter = context.createBiquadFilter();
  const reverb = context.createConvolver();
  const reverbGain = context.createGain();
  const delay = context.createDelay(1.2);
  const delayFeedback = context.createGain();
  const delayGain = context.createGain();

  master.gain.value = state.siteVolume / 100;
  fxGain.gain.value = 0.24;
  musicGain.gain.value = getBackgroundMusicVolume();
  fxFilter.type = "lowpass";
  fxFilter.frequency.value = 1700;
  fxFilter.Q.value = 0.55;
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 1250;
  musicFilter.Q.value = 0.4;
  reverb.buffer = createAmbientImpulse(context);
  reverbGain.gain.value = 0.34;
  delay.delayTime.value = 0.46;
  delayFeedback.gain.value = 0.22;
  delayGain.gain.value = 0.26;

  fxGain.connect(fxFilter);
  fxFilter.connect(master);
  fxFilter.connect(reverb);
  musicGain.connect(musicFilter);
  musicFilter.connect(master);
  musicFilter.connect(delay);
  delay.connect(delayFeedback);
  delayFeedback.connect(delay);
  delay.connect(delayGain);
  delayGain.connect(reverb);
  reverb.connect(reverbGain);
  reverbGain.connect(master);
  master.connect(context.destination);

  state.audio = {
    context,
    master,
    fxGain,
    musicGain,
    fxFilter,
    musicFilter,
    reverbGain,
    delay,
    musicTimer: null,
    step: 0,
    startedAt: 0
  };
  return state.audio;
}

function setGainValue(gain, value, time = 0.025) {
  if (!gain) return;
  const context = state.audio?.context;
  if (!context) {
    gain.gain.value = value;
    return;
  }
  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.setTargetAtTime(value, context.currentTime, time);
}

function isTrackListening() {
  return state.turnStage === "listening" && Boolean(state.currentTrackId);
}

function getBackgroundMusicVolume() {
  if (!state.musicEnabled) return 0;
  return isTrackListening() ? DUCKED_BACKGROUND_MUSIC_VOLUME : BACKGROUND_MUSIC_VOLUME;
}

function syncAudioVolume({ fadeTime = 0.18 } = {}) {
  if (!state.audio) return;
  setGainValue(state.audio.master, state.siteVolume / 100, 0.08);
  setGainValue(state.audio.musicGain, getBackgroundMusicVolume(), fadeTime);
}

function unlockAudio({ startMusic = true } = {}) {
  const audio = createAudioEngine();
  if (!audio) return null;
  if (audio.context.state === "suspended") {
    audio.context.resume().catch(() => {});
  }
  syncAudioVolume();
  if (startMusic && state.musicEnabled) startBackgroundMusic();
  return audio;
}

function playTone({
  frequency = 440,
  duration = 0.38,
  type = "sine",
  destination,
  start = 0,
  gain = 0.08,
  slideTo = null,
  attack = 0.08,
  release = 0.42,
  detune = 0
}) {
  const audio = unlockAudio({ startMusic: false });
  if (!audio) return;

  const now = audio.context.currentTime + start;
  const end = now + Math.max(duration, attack + 0.02);
  const oscillator = audio.context.createOscillator();
  const envelope = audio.context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.detune.setValueAtTime(detune, now);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, end);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(gain, now + attack);
  envelope.gain.setTargetAtTime(0.0001, end, release / 3);
  oscillator.connect(envelope);
  envelope.connect(destination || audio.fxGain);
  oscillator.start(now);
  oscillator.stop(end + release + 0.05);
}

function playButtonSound(button) {
  if (!button || button.disabled) return;
  if (button.classList.contains("danger")) {
    playSoundCue("danger");
  } else if (button.classList.contains("primary")) {
    playSoundCue("confirm");
  } else if (button.classList.contains("reaction-btn")) {
    playSoundCue("reaction");
  } else if (button.classList.contains("vote-row")) {
    playSoundCue("vote");
  } else {
    playSoundCue("click");
  }
}

function playSoundCue(name) {
  const audio = unlockAudio({ startMusic: false });
  if (!audio || state.siteVolume === 0) return;

  const cues = {
    click: () => playTone({ frequency: 329.63, duration: 0.18, gain: 0.035, slideTo: 392, attack: 0.035, release: 0.24 }),
    confirm: () => {
      playTone({ frequency: 261.63, duration: 0.34, gain: 0.046, attack: 0.06, release: 0.38 });
      playTone({ frequency: 392, duration: 0.42, start: 0.08, gain: 0.038, attack: 0.08, release: 0.46, detune: -4 });
      playTone({ frequency: 523.25, duration: 0.48, start: 0.18, gain: 0.026, attack: 0.12, release: 0.55, detune: 5 });
    },
    danger: () => {
      playTone({ frequency: 146.83, duration: 0.7, gain: 0.045, slideTo: 110, attack: 0.12, release: 0.65, detune: -6 });
      playTone({ frequency: 220, duration: 0.56, start: 0.09, gain: 0.026, slideTo: 174.61, attack: 0.15, release: 0.68 });
    },
    reaction: () => {
      playTone({ frequency: 659.25, duration: 0.24, gain: 0.026, attack: 0.045, release: 0.32, detune: -5 });
      playTone({ frequency: 880, duration: 0.34, start: 0.12, gain: 0.02, attack: 0.08, release: 0.42, detune: 7 });
    },
    vote: () => {
      playTone({ frequency: 196, duration: 0.32, gain: 0.038, attack: 0.08, release: 0.4 });
      playTone({ frequency: 293.66, duration: 0.4, start: 0.1, gain: 0.032, attack: 0.1, release: 0.44 });
    },
    screen: () => {
      playTone({ frequency: 164.81, duration: 0.65, gain: 0.034, slideTo: 246.94, attack: 0.16, release: 0.7 });
      playTone({ frequency: 493.88, duration: 0.6, start: 0.18, gain: 0.022, attack: 0.2, release: 0.72, detune: 4 });
    },
    track: () => {
      playTone({ frequency: 130.81, duration: 0.58, gain: 0.043, attack: 0.12, release: 0.7 });
      playTone({ frequency: 261.63, duration: 0.72, start: 0.16, gain: 0.035, attack: 0.18, release: 0.78, detune: -3 });
      playTone({ frequency: 523.25, duration: 0.86, start: 0.36, gain: 0.022, attack: 0.22, release: 0.86, detune: 6 });
    },
    reveal: () => {
      playTone({ frequency: 174.61, duration: 1.1, gain: 0.04, slideTo: 349.23, attack: 0.24, release: 1.05, detune: -5 });
      playTone({ frequency: 440, duration: 0.9, start: 0.28, gain: 0.026, attack: 0.28, release: 0.95, detune: 5 });
      playTone({ frequency: 659.25, duration: 1.0, start: 0.52, gain: 0.02, attack: 0.34, release: 1.1 });
    }
  };

  cues[name]?.();
}

function scheduleAmbientMusic() {
  const audio = state.audio;
  if (!audio || !state.musicEnabled || state.siteVolume === 0) return;

  const rootIndex = audio.step % AMBIENT_PAD_NOTES.length;
  const root = AMBIENT_PAD_NOTES[rootIndex];
  const fifth = AMBIENT_PAD_NOTES[(rootIndex + 3) % AMBIENT_PAD_NOTES.length];
  const shimmer = AMBIENT_SHIMMER_NOTES[(audio.step * 2) % AMBIENT_SHIMMER_NOTES.length];

  playTone({ frequency: root, duration: 3.7, destination: audio.musicGain, gain: 0.038, attack: 0.85, release: 1.4, detune: -4 });
  playTone({ frequency: fifth, duration: 3.3, destination: audio.musicGain, start: 0.45, gain: 0.03, attack: 0.95, release: 1.35, detune: 4 });
  playTone({ frequency: shimmer, duration: 1.45, destination: audio.musicGain, start: 1.2, gain: 0.012, attack: 0.35, release: 1.1, detune: audio.step % 2 === 0 ? 7 : -7 });

  audio.step = (audio.step + 1) % AMBIENT_PAD_NOTES.length;
  audio.startedAt = audio.context.currentTime;
}

function startBackgroundMusic() {
  const audio = createAudioEngine();
  if (!audio || audio.musicTimer || !state.musicEnabled) return;
  syncAudioVolume();
  scheduleAmbientMusic();
  audio.musicTimer = window.setInterval(scheduleAmbientMusic, 3600);
}

function stopBackgroundMusic() {
  if (!state.audio?.musicTimer) return;
  window.clearInterval(state.audio.musicTimer);
  state.audio.musicTimer = null;
}

function updateMusicToggle() {
  const toggle = $("musicToggle");
  if (!toggle) return;
  toggle.textContent = state.musicEnabled ? "🎧" : "🔇";
  toggle.setAttribute("aria-pressed", String(state.musicEnabled));
  toggle.title = state.musicEnabled ? "Музыкальное сопровождение включено" : "Музыкальное сопровождение выключено";
}

function toggleMusic() {
  state.musicEnabled = !state.musicEnabled;
  try {
    window.localStorage.setItem("musicSpyMusicEnabled", String(state.musicEnabled));
  } catch {
    // Ignore storage errors in private or restricted browser modes.
  }

  unlockAudio({ startMusic: state.musicEnabled });
  if (state.musicEnabled) {
    startBackgroundMusic();
    playSoundCue("confirm");
  } else {
    stopBackgroundMusic();
    playSoundCue("click");
  }
  syncAudioVolume();
  updateMusicToggle();
}

function restoreMusicPreference() {
  try {
    const storedMusic = window.localStorage.getItem("musicSpyMusicEnabled");
    state.musicEnabled = storedMusic === null ? true : storedMusic === "true";
  } catch {
    state.musicEnabled = true;
  }
  updateMusicToggle();
  syncAudioVolume();
}

function showScreen(id) {
  if (id === "lobby" && state.phase !== "lobby") {
    state.inviteSecretsVisible = false;
  }

  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("hidden", screen.id !== id);
  }
  const previousPhase = state.phase;
  state.phase = id;
  updateInviteSecretsVisibility();
  if (previousPhase !== id) playSoundCue("screen");
}

function setStatus(id, message = "", isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function updateSiteVolume(value) {
  const volume = Math.max(0, Math.min(100, Number(value) || 0));
  state.siteVolume = volume;
  const volumeInput = $("siteVolume");
  const volumeValue = $("siteVolumeValue");
  if (volumeInput) volumeInput.value = String(volume);
  if (volumeValue) volumeValue.textContent = `${volume}%`;
  try {
    window.localStorage.setItem("musicSpyVolume", String(volume));
  } catch {
    // Ignore storage errors in private or restricted browser modes.
  }
  applySiteVolume();
  syncAudioVolume();
}

function applySiteVolume() {
  const normalizedVolume = state.siteVolume / 100;
  for (const media of document.querySelectorAll("audio, video")) {
    media.volume = normalizedVolume;
  }

  const trackFrame = $("trackFrame");
  if (trackFrame?.contentWindow && trackFrame.src.includes("youtube.com")) {
    trackFrame.contentWindow.postMessage(JSON.stringify({
      event: "command",
      func: "setVolume",
      args: [state.siteVolume]
    }), "*");
    trackFrame.contentWindow.postMessage(JSON.stringify({
      event: "command",
      func: state.siteVolume === 0 ? "mute" : "unMute",
      args: []
    }), "*");
  }
}

function restoreSiteVolume() {
  restoreMusicPreference();
  let savedVolume = DEFAULT_SITE_VOLUME;
  try {
    const storedVolume = window.localStorage.getItem("musicSpyVolume");
    savedVolume = storedVolume === null ? DEFAULT_SITE_VOLUME : Number(storedVolume);
  } catch {
    savedVolume = DEFAULT_SITE_VOLUME;
  }

  updateSiteVolume(Number.isFinite(savedVolume) ? savedVolume : DEFAULT_SITE_VOLUME);
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

function sendReaction(reaction) {
  socket.emit("trackReaction", { code: state.currentCode, reaction }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    state.selectedReaction = res.selectedReaction || null;
    state.reactionCounts = res.reactionCounts || state.reactionCounts;
    renderReactions();
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

function updateInviteSecretsVisibility() {
  const isVisible = Boolean(state.inviteSecretsVisible);
  const copyCode = $("copyCode");
  const qrWrap = $("inviteQrWrap");
  const toggle = $("toggleInviteSecrets");

  for (const el of [copyCode, qrWrap]) {
    if (el) el.classList.toggle("secret-blurred", !isVisible);
  }

  if (toggle) {
    const label = isVisible ? "Скрыть код комнаты и QR" : "Показать код комнаты и QR";
    toggle.textContent = isVisible ? "🙈" : "👁️";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-pressed", String(isVisible));
    toggle.title = label;
  }
}

function toggleInviteSecrets() {
  state.inviteSecretsVisible = !state.inviteSecretsVisible;
  updateInviteSecretsVisibility();
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
    playSoundCue("track");
    state.turnStage = "listening";
    updateSendButton(true);
  });
}

function vote(target) {
  socket.emit("vote", { code: state.currentCode, target }, (res) => {
    if (res?.error) return setStatus("voteStatus", res.error, true);
    state.votedTarget = target;
    playSoundCue("vote");
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
  updateInviteSecretsVisibility();
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
  state.reactionCounts = data.reactionCounts || state.reactionCounts;
  state.trackHistory = data.trackHistory || state.trackHistory;
  if (data.lastTrack?.id && data.lastTrack.id !== state.currentTrackId) {
    state.currentTrackId = data.lastTrack.id;
    state.selectedReaction = null;
  }

  $("roundInfo").textContent = `Раунд ${state.round}/${state.totalRounds}`;
  $("roundBar").style.width = `${Math.min(100, (state.round / state.totalRounds) * 100)}%`;
  renderOrder();
  renderHostControls();
  renderReactions();
  renderTrackHistory();
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

function renderReactions() {
  const buttons = $("reactionButtons");
  const summary = $("reactionSummary");
  if (!buttons || !summary) return;

  buttons.innerHTML = ALLOWED_REACTIONS.map((reaction) => `
    <button class="reaction-btn ${state.selectedReaction === reaction ? "selected" : ""}" onclick="sendReaction('${escapeAttribute(reaction)}')">
      <span>${reaction}</span>
      <strong>${state.reactionCounts[reaction] || 0}</strong>
    </button>
  `).join("");

  const activeCounts = ALLOWED_REACTIONS
    .filter((reaction) => state.reactionCounts[reaction])
    .map((reaction) => `${reaction} ${state.reactionCounts[reaction]}`);
  summary.textContent = activeCounts.length ? activeCounts.join(" · ") : "Пока реакций нет";
}

function formatReactions(reactions = {}) {
  const activeCounts = ALLOWED_REACTIONS
    .filter((reaction) => reactions[reaction])
    .map((reaction) => `${reaction} ${reactions[reaction]}`);
  return activeCounts.length ? activeCounts.join(" · ") : "без реакций";
}

function renderTrackHistory(targetId = "trackHistory", history = state.trackHistory) {
  const el = $(targetId);
  if (!el) return;

  if (!history?.length) {
    el.classList.add("empty");
    el.textContent = "Пока треков нет";
    return;
  }

  el.classList.remove("empty");
  el.innerHTML = history.map((track) => `
    <div class="history-row">
      <span>Раунд ${track.round}, ход ${track.turnNumber || "?"}</span>
      <strong>${escapeHtml(track.playerName || "Игрок")}</strong>
      <small>${formatReactions(track.reactions)}</small>
    </div>
  `).join("");
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
  state.reactionCounts = {};
  state.selectedReaction = null;
  renderReactions();
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
  syncAudioVolume({ fadeTime: stage === "listening" ? 0.12 : 0.32 });
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
  state.currentTrackId = null;
  syncAudioVolume({ fadeTime: 0.32 });
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
  applySiteVolume();
}

function loadTrack(track) {
  const url = typeof track === "string" ? track : track.url;
  if (typeof track !== "string") {
    const nextTrackId = track.id || state.currentTrackId;
    if (nextTrackId !== state.currentTrackId) {
      state.selectedReaction = null;
    }
    state.currentTrackId = nextTrackId;
    state.reactionCounts = track.reactionCounts || {};
    renderReactions();
  }
  const embed = $("embed");
  const youtubeId = extractYoutubeId(url);
  const soundCloud = isSoundCloudUrl(url);

  embed.classList.remove("empty");
  if (youtubeId) {
    const origin = encodeURIComponent(window.location.origin);
    embed.innerHTML = `<iframe id="trackFrame" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}" title="YouTube player" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  } else if (soundCloud) {
    embed.innerHTML = `<iframe id="trackFrame" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&visual=true" title="SoundCloud player" allow="autoplay"></iframe>`;
  } else {
    embed.innerHTML = `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">Открыть трек</a>`;
  }

  if (typeof track !== "string") {
    state.turnStage = "listening";
  }
  applySiteVolume();
  syncAudioVolume({ fadeTime: 0.12 });
  updateSendButton(true);

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
  state.trackHistory = data.trackHistory || state.trackHistory;
  renderTrackHistory("resultTrackHistory", state.trackHistory);
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
  restoreSiteVolume();
  renderReactions();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    unlockAudio();
    playButtonSound(button);
  });
  const presetCode = new URL(window.location.href).searchParams.get("room");
  if (presetCode) {
    $("code").value = presetCode.slice(0, 5).toUpperCase();
    setStatus("menuError", "Код комнаты подставлен из ссылки. Введи ник и нажми «Войти по коду».");
  }
});

socket.on("gameStarted", (data) => {
  playSoundCue("reveal");
  state.role = data.role;
  state.theme = data.theme;
  state.hostId = data.host || state.hostId;
  state.players = data.players;
  state.order = data.order;
  state.totalRounds = data.totalRounds;
  state.settings = data.settings || state.settings;
  state.currentCode = data.code;
  state.votedTarget = null;
  state.reactionCounts = {};
  state.selectedReaction = null;
  state.currentTrackId = null;
  state.trackHistory = data.trackHistory || [];
  state.turnStage = "waiting";
  state.timeLeft = null;
  syncAudioVolume({ fadeTime: 0.32 });

  $("roleTitle").textContent = data.role === "spy" ? "Ты шпион" : "Ты мирный";
  $("theme").textContent = data.role === "spy"
    ? `Твоя задача — понять тему по чужим трекам и не выдать себя. Шпионов в игре: ${data.spyCount || 1}.`
    : `Тема: «${data.theme}»`;
  $("embed").className = "embed empty";
  $("embed").innerHTML = "<span>Здесь появится YouTube/SoundCloud плеер</span>";

  showScreen("game");
  renderOrder();
  renderHostControls();
  renderReactions();
  renderTrackHistory();
});

socket.on("gameState", renderGameState);
socket.on("turn", updateTurn);
socket.on("timer", updateTimer);
socket.on("voteTimer", ({ timeLeft }) => updateVoteTimer(timeLeft));
socket.on("newTrack", loadTrack);
socket.on("reactionUpdate", ({ trackId, reactionCounts, trackHistory }) => {
  if (trackId === state.currentTrackId) {
    state.reactionCounts = reactionCounts || {};
  }
  state.trackHistory = trackHistory || state.trackHistory;
  renderReactions();
  renderTrackHistory();
  renderTrackHistory("voteTrackHistory", state.trackHistory);
});
socket.on("roundStarted", ({ round, order }) => {
  state.round = round;
  state.order = order;
  state.reactionCounts = {};
  state.selectedReaction = null;
  setStatus("gameStatus", `Начался раунд ${round}`);
  renderOrder();
  renderHostControls();
  renderReactions();
  renderTrackHistory();
});

socket.on("votingStarted", ({ players, votes, anonymous, voteRound, candidates, votingTime }) => {
  playSoundCue("reveal");
  state.players = players;
  state.votedTarget = null;
  state.anonymousVoting = Boolean(anonymous);
  state.voteCandidates = candidates || [];
  clearPlayer();
  showScreen("voting");
  renderVoteList(votes);
  renderTrackHistory("voteTrackHistory", state.trackHistory);
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
  playSoundCue("reveal");
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
  state.trackHistory = [];
  state.reactionCounts = {};
  state.selectedReaction = null;
  clearPlayer();
  showScreen("menu");
  setStatus("menuError", reason || "Тебя удалили из комнаты", true);
});

socket.on("gameCancelled", ({ reason }) => {
  clearPlayer();
  showScreen("lobby");
  setStatus("lobbyStatus", reason, true);
});
