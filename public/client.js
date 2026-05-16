const socket = io();

const DUCKED_BACKGROUND_MUSIC_VOLUME = 0.04;
const UI_CUE_FADE_SECONDS = 0.045;
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
  spyIds: [],
  round: 1,
  totalRounds: 3,
  timeLeft: null,
  turnStage: "waiting",
  pausedTurnStage: null,
  votedTarget: null,
  voteCandidates: [],
  voteCounts: {},
  anonymousVoting: false,
  spyGuessActive: false,
  pendingSpyGuess: null,
  reactionCounts: {},
  selectedReaction: null,
  currentTrackId: null,
  trackHistory: [],
  chatMessages: [],
  siteVolume: DEFAULT_SITE_VOLUME,
  musicEnabled: true,
  audio: null,
  ready: false,
  inviteSecretsVisible: false,
  cinematicTimer: null,
  cinematicIntervals: [],
  cinematicOnClose: null,
  profile: null,
  authGuest: true,
  pendingAvatar: undefined,
  authFormMode: "choice",
  authResolved: false,
  pendingInviteCode: "",
  inviteAutoJoinAttempted: false,
  volumePanelOpen: false,
  lang: "ru",
  oauthRedirectError: "",
  latestResult: null,
  finalComments: [],
  mobileTurnLabel: ""
};

const $ = (id) => document.getElementById(id);

function translateTheme(theme) {
  const text = String(theme ?? "");
  if (currentLanguage() === "ru" || !text) return text;
  return EN_THEME_TRANSLATIONS[text] || text;
}

function currentLanguage() {
  return state.lang || "ru";
}

function translateText(value) {
  const text = String(value ?? "");
  if (currentLanguage() === "ru" || !text) return text;
  if (EN_TRANSLATIONS[text]) return EN_TRANSLATIONS[text];
  return text
    .replace(/Раунд (\d+)\/(\d+)/g, "Round $1/$2")
    .replace(/Раунд (\d+), ход (\?|\d+)/g, "Round $1, turn $2")
    .replace(/ход (\d+)\/(\d+)/g, "turn $1/$2")
    .replace(/Готовы: (\d+)\/(\d+)/g, "Ready: $1/$2")
    .replace(/хост: (.+)/g, "host: $1")
    .replace(/Проголосовало (\d+)\/(\d+)/g, "Voted $1/$2")
    .replace(/Последний шанс: угадай тему \((\d+)с\)/g, "Last chance: guess the theme ($1s)")
    .replace(/Ждем версию шпиона \((\d+)с\)/g, "Waiting for the spy's guess ($1s)")
    .replace(/Начался раунд (\d+)/g, "Round $1 started")
    .replace(/Ник обновлен: (.+)/g, "Nickname updated: $1")
    .replace(/Трек принят\. Слушаем (\d+) секунд\.\.\./g, "Track accepted. Listening for $1 seconds...")
    .replace(/(.+) поставил трек — слушаем (\d+) секунд/g, "$1 submitted a track — listening for $2 seconds")
    .replace(/Шпионы: (.+)\. Тема: «(.+)»\. Зачервили: (.+)\./g, (match, spies, theme, suspected) => `Spies: ${spies}. Theme: “${translateTheme(theme)}”. Suspected: ${suspected}.`)
    .replace(/Мирные нашли шпиона: (.+)\. Ждем, сможет ли он назвать тему\./g, "Civilians found the spy: $1. Waiting to see if they can name the theme.")
    .replace(/голосов: (\d+)/g, "votes: $1")
    .replace(/подозрительных реакций: (\d+)/g, "suspicious reactions: $1")
    .replace(/Твоя задача — понять тему по чужим трекам и не выдать себя\. Шпионов в игре: (\d+)\./g, "Your goal is to figure out the theme from other tracks and avoid exposing yourself. Spies in the game: $1.")
    .replace(/Тема: «(.+)»/g, (match, theme) => `Theme: “${translateTheme(theme)}”`)
    .replace(/Последний шанс: выбери тему \((\d+)с\)/g, "Last chance: choose the theme ($1s)")
    .replace(/Ждем финальный выбор \((\d+)с\)/g, "Waiting for the final choice ($1s)")
    .replace(/Выбрана тема: «(.+)»/g, (match, theme) => `Selected theme: “${translateTheme(theme)}”`)
    .replace(/Код комнаты (.+)/g, "Room code $1")
    .replace(/Хост пропустил ход: (.+)/g, "Host skipped turn: $1")
    .replace(/Хост передал ход: (.+)/g, "Host passed the turn: $1")
    .replace(/Хост (добавил|убрал) 15 секунд/g, (match, action) => `Host ${action === "добавил" ? "added" : "removed"} 15 seconds`)
    .replace(/Шпион(ы?)$/g, "Spy$1");
}

function t(value) {
  return translateText(value);
}

function setLanguage(lang) {
  state.lang = lang === "en" ? "en" : "ru";
  document.documentElement.lang = state.lang;
  try {
    window.localStorage.setItem(LANGUAGE_KEY, state.lang);
  } catch {
    // Ignore storage errors.
  }
  const toggle = $("languageToggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(state.lang === "en"));
    toggle.title = state.lang === "en" ? "Переключить на русский" : "Switch to English";
  }
  localizeStaticDom();
  updateMusicToggle();
  syncNameInput();
  updateLobbyRenameControls();
  if (state.lobby) renderLobby(state.lobby);
  if (state.phase === "game") {
    renderOrder();
    renderHostControls();
    renderReactions();
    renderTrackHistory();
    renderChat();
    updateSendButton();
  }
  if (state.phase === "voting") {
    renderVoteList(state.voteCounts);
    renderTrackHistory("voteTrackHistory", state.trackHistory);
  }
  if (state.phase === "spyGuess") {
    renderTrackHistory("spyGuessTrackHistory", state.trackHistory);
  }
}

function toggleLanguage() {
  setLanguage(currentLanguage() === "en" ? "ru" : "en");
}

function restoreLanguagePreference() {
  let lang = "ru";
  try {
    lang = window.localStorage.getItem(LANGUAGE_KEY) || "ru";
  } catch {
    lang = "ru";
  }
  setLanguage(lang);
}

function localizeStaticDom(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE"].includes(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    const translated = currentLanguage() === "en" ? EN_TRANSLATIONS[trimmed] : Object.keys(EN_TRANSLATIONS).find((key) => EN_TRANSLATIONS[key] === trimmed);
    if (translated) node.nodeValue = raw.replace(trimmed, translated);
  });

  for (const el of root.querySelectorAll("[placeholder], [title], [aria-label], [alt]")) {
    for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const translated = currentLanguage() === "en" ? EN_TRANSLATIONS[value] : Object.keys(EN_TRANSLATIONS).find((key) => EN_TRANSLATIONS[key] === value);
      if (translated) el.setAttribute(attr, translated);
    }
  }
}


const AMBIENT_CHORDS = [
  [110, 164.81, 220, 329.63],
  [98, 146.83, 196, 293.66],
  [123.47, 185, 246.94, 369.99],
  [92.5, 138.59, 207.65, 311.13],
  [103.83, 155.56, 233.08, 349.23],
  [87.31, 130.81, 196, 293.66]
];
const AMBIENT_SHIMMER_NOTES = [440, 493.88, 554.37, 659.25, 739.99, 659.25, 554.37, 493.88];
const AMBIENT_ARPEGGIO_PATTERNS = [
  [220, 329.63, 493.88, 659.25, 987.77, 659.25, 493.88, 329.63],
  [196, 293.66, 440, 587.33, 880, 587.33, 440, 293.66],
  [246.94, 369.99, 554.37, 739.99, 1108.73, 739.99, 554.37, 369.99],
  [185, 277.18, 415.3, 622.25, 830.61, 622.25, 415.3, 277.18],
  [207.65, 311.13, 466.16, 622.25, 932.33, 622.25, 466.16, 311.13],
  [174.61, 261.63, 392, 587.33, 783.99, 587.33, 392, 261.63]
];

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
  fxGain.gain.value = 0.9;
  musicGain.gain.value = getBackgroundMusicVolume();
  fxFilter.type = "lowpass";
  fxFilter.frequency.value = 2300;
  fxFilter.Q.value = 0.55;
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 1180;
  musicFilter.Q.value = 0.82;
  reverb.buffer = createAmbientImpulse(context);
  reverbGain.gain.value = 0.48;
  delay.delayTime.value = 0.46;
  delayFeedback.gain.value = 0.32;
  delayGain.gain.value = 0.2;

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
    activeCue: null,
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

function createUiCueDestination() {
  const audio = state.audio;
  if (!audio) return null;

  const now = audio.context.currentTime;
  if (audio.activeCue) {
    const previous = audio.activeCue;
    previous.gain.cancelScheduledValues(now);
    previous.gain.setValueAtTime(Math.max(previous.gain.value, 0.0001), now);
    previous.gain.exponentialRampToValueAtTime(0.0001, now + UI_CUE_FADE_SECONDS);
    window.setTimeout(() => {
      try {
        previous.disconnect();
      } catch {
        // The cue may already be disconnected after a rapid sequence of clicks.
      }
    }, (UI_CUE_FADE_SECONDS + 0.03) * 1000);
  }

  const cueGain = audio.context.createGain();
  cueGain.gain.setValueAtTime(0.0001, now);
  cueGain.gain.exponentialRampToValueAtTime(1, now + 0.012);
  cueGain.connect(audio.fxGain);
  audio.activeCue = cueGain;
  return cueGain;
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

function getButtonCueName(button) {
  if (!button || button.disabled) return null;
  if (button.dataset.sound) return button.dataset.sound;
  if (button.id === "toggleInviteSecrets") return state.inviteSecretsVisible ? "inviteReveal" : "inviteHide";
  if (button.id === "copyCode") return "copyCode";
  if (button.id === "copyInvite") return "copyInvite";
  if (button.id === "readyBtn") return state.ready ? "readyDown" : "readyUp";
  if (button.classList.contains("danger")) return "danger";
  if (button.classList.contains("primary")) return "confirm";
  if (button.classList.contains("reaction-btn")) return "reaction";
  if (button.classList.contains("vote-row")) return "vote";
  return "click";
}

function playButtonSound(button) {
  const cueName = getButtonCueName(button);
  if (cueName) playSoundCue(cueName);
}

function playSoftChord(notes, { start = 0, duration = 1.35, gain = 0.026, attack = 0.22, release = 0.82, destination = null } = {}) {
  notes.forEach((note, index) => {
    playTone({
      frequency: note,
      duration: duration + index * 0.08,
      destination,
      start: start + index * 0.055,
      gain: gain * (index === 0 ? 1.12 : 0.82),
      attack: attack + index * 0.035,
      release,
      detune: index % 2 === 0 ? -5 : 5
    });
  });
}

function playFilteredNoise({ start = 0, duration = 0.42, gain = 0.018, attack = 0.08, release = 0.36, frequency = 2600, type = "bandpass", destination = null } = {}) {
  const audio = unlockAudio({ startMusic: false });
  if (!audio) return;

  const now = audio.context.currentTime + start;
  const length = Math.max(1, Math.floor(audio.context.sampleRate * duration));
  const buffer = audio.context.createBuffer(1, length, audio.context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const fade = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }

  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const envelope = audio.context.createGain();
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, now);
  filter.Q.value = 1.4;
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(gain, now + attack);
  envelope.gain.setTargetAtTime(0.0001, now + duration, release / 3);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination || audio.fxGain);
  source.start(now);
  source.stop(now + duration + release);
}

function playAmbientArpeggio(pattern, { start = 0, destination = null } = {}) {
  const stepTime = 0.22;
  const repeats = 4;

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    pattern.forEach((note, index) => {
      const stepIndex = repeat * pattern.length + index;
      const accent = stepIndex % 8 === 0 ? 1.35 : stepIndex % 4 === 0 ? 1.12 : 0.86;
      playTone({
        frequency: note,
        slideTo: note * 1.003,
        duration: 0.22,
        type: stepIndex % 2 === 0 ? "triangle" : "sine",
        destination,
        start: start + stepIndex * stepTime,
        gain: 0.0058 * accent,
        attack: 0.012,
        release: 0.16,
        detune: stepIndex % 2 === 0 ? 5 : -5
      });
    });
  }
}

function playAmbientBreakcoreFill({ start = 0, destination = null } = {}) {
  const pattern = [
    { t: 0, kind: "kick" },
    { t: 0.16, kind: "hat" },
    { t: 0.27, kind: "snare" },
    { t: 0.39, kind: "hat" },
    { t: 0.49, kind: "kick" },
    { t: 0.58, kind: "ghost" },
    { t: 0.68, kind: "snare" },
    { t: 0.78, kind: "hat" },
    { t: 0.88, kind: "kick" },
    { t: 1.02, kind: "snare" }
  ];

  pattern.forEach(({ t, kind }) => {
    if (kind === "kick") {
      playTone({ frequency: 96, slideTo: 48, duration: 0.12, type: "sine", destination, start: start + t, gain: 0.009, attack: 0.004, release: 0.16 });
    } else if (kind === "snare") {
      playFilteredNoise({ start: start + t, duration: 0.105, gain: 0.0068, attack: 0.004, release: 0.11, frequency: 1800, type: "bandpass", destination });
      playTone({ frequency: 210, slideTo: 170, duration: 0.08, type: "triangle", destination, start: start + t, gain: 0.0038, attack: 0.004, release: 0.11 });
    } else if (kind === "ghost") {
      playFilteredNoise({ start: start + t, duration: 0.07, gain: 0.0038, attack: 0.003, release: 0.08, frequency: 1450, type: "bandpass", destination });
    } else {
      playFilteredNoise({ start: start + t, duration: 0.045, gain: 0.0027, attack: 0.002, release: 0.05, frequency: 6800, type: "highpass", destination });
    }
  });
}

function playMetronomeTick() {
  const audio = unlockAudio({ startMusic: false });
  if (!audio || state.siteVolume === 0) return;

  const now = audio.context.currentTime;
  const bell = audio.context.createOscillator();
  const body = audio.context.createOscillator();
  const bellEnvelope = audio.context.createGain();
  const bodyEnvelope = audio.context.createGain();
  const filter = audio.context.createBiquadFilter();
  const tickGain = audio.context.createGain();

  bell.type = "sine";
  bell.frequency.setValueAtTime(880, now);
  bell.frequency.exponentialRampToValueAtTime(660, now + 0.12);
  body.type = "triangle";
  body.frequency.setValueAtTime(440, now);
  body.frequency.exponentialRampToValueAtTime(330, now + 0.16);
  filter.type = "lowpass";
  filter.frequency.value = 1250;
  filter.Q.value = 0.45;
  tickGain.gain.value = 0.78;

  bellEnvelope.gain.setValueAtTime(0.0001, now);
  bellEnvelope.gain.exponentialRampToValueAtTime(0.028, now + 0.018);
  bellEnvelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  bodyEnvelope.gain.setValueAtTime(0.0001, now);
  bodyEnvelope.gain.exponentialRampToValueAtTime(0.018, now + 0.024);
  bodyEnvelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

  bell.connect(bellEnvelope);
  body.connect(bodyEnvelope);
  bellEnvelope.connect(filter);
  bodyEnvelope.connect(filter);
  filter.connect(tickGain);
  tickGain.connect(audio.fxGain);
  bell.start(now);
  body.start(now);
  bell.stop(now + 0.3);
  body.stop(now + 0.32);
}

function playInviteStyleCue(destination, {
  root = 220,
  chord = [220, 329.63, 493.88, 659.25],
  sparkle = 987.77,
  direction = 1,
  noiseFrequency = 5100,
  gain = 1
} = {}) {
  playSoftChord(chord, { destination, duration: 0.42, gain: 0.014 * gain, attack: 0.025, release: 0.28 });
  playTone({
    frequency: root,
    slideTo: root * (direction > 0 ? 1.5 : 0.72),
    duration: 0.2,
    type: "triangle",
    destination,
    start: 0.015,
    gain: 0.012 * gain,
    attack: 0.01,
    release: 0.2
  });
  playTone({ frequency: sparkle, duration: 0.16, type: "sine", destination, start: 0.07, gain: 0.0075 * gain, attack: 0.012, release: 0.18 });
  playFilteredNoise({ start: 0.01, duration: 0.11, gain: 0.007 * gain, attack: 0.004, release: 0.1, frequency: noiseFrequency, destination });
}

function playSoundCue(name) {
  const audio = unlockAudio({ startMusic: false });
  if (!audio || state.siteVolume === 0) return;

  const destination = createUiCueDestination();
  if (!destination) return;

  const cues = {
    click: () => {
      playInviteStyleCue(destination, { root: 246.94, chord: [185, 277.18, 369.99, 554.37], sparkle: 739.99, noiseFrequency: 4600, gain: 0.92 });
    },
    confirm: () => {
      playInviteStyleCue(destination, { root: 261.63, chord: [220, 329.63, 493.88, 659.25], sparkle: 1046.5, noiseFrequency: 5400, gain: 1.12 });
      playTone({ frequency: 659.25, slideTo: 987.77, duration: 0.22, type: "triangle", destination, start: 0.09, gain: 0.012, attack: 0.015, release: 0.22 });
    },
    danger: () => {
      playInviteStyleCue(destination, { root: 196, chord: [146.83, 220, 293.66, 440], sparkle: 587.33, direction: -1, noiseFrequency: 2600, gain: 1.08 });
      playTone({ frequency: 196, slideTo: 130.81, duration: 0.28, type: "triangle", destination, start: 0.02, gain: 0.011, attack: 0.014, release: 0.26, detune: -7 });
    },
    reaction: () => {
      playInviteStyleCue(destination, { root: 329.63, chord: [261.63, 392, 523.25, 783.99], sparkle: 1318.51, noiseFrequency: 5600, gain: 0.96 });
    },
    vote: () => {
      playInviteStyleCue(destination, { root: 246.94, chord: [196, 293.66, 440, 587.33], sparkle: 880, noiseFrequency: 4800, gain: 1.02 });
    },
    copyCode: () => {
      playInviteStyleCue(destination, { root: 261.63, chord: [196, 293.66, 440, 587.33], sparkle: 1046.5, noiseFrequency: 5000, gain: 0.98 });
    },
    copyInvite: () => {
      playInviteStyleCue(destination, { root: 220, chord: [220, 329.63, 493.88, 659.25], sparkle: 987.77, noiseFrequency: 5100, gain: 1 });
    },
    inviteReveal: () => {
      playInviteStyleCue(destination, { root: 293.66, chord: [220, 329.63, 493.88, 739.99], sparkle: 1174.66, noiseFrequency: 6200, gain: 1.08 });
    },
    inviteHide: () => {
      playInviteStyleCue(destination, { root: 293.66, chord: [220, 293.66, 392, 493.88], sparkle: 659.25, direction: -1, noiseFrequency: 2200, gain: 0.9 });
    },
    readyUp: () => {
      playInviteStyleCue(destination, { root: 261.63, chord: [261.63, 392, 523.25, 783.99], sparkle: 1174.66, noiseFrequency: 5400, gain: 1.05 });
    },
    readyDown: () => {
      playInviteStyleCue(destination, { root: 246.94, chord: [220, 277.18, 369.99, 554.37], sparkle: 739.99, direction: -1, noiseFrequency: 3200, gain: 0.95 });
    },
    nickname: () => {
      playInviteStyleCue(destination, { root: 329.63, chord: [246.94, 369.99, 493.88, 739.99], sparkle: 987.77, noiseFrequency: 5200, gain: 1 });
    },
    screen: () => {
      playInviteStyleCue(destination, { root: 196, chord: [164.81, 246.94, 369.99, 493.88], sparkle: 739.99, noiseFrequency: 3600, gain: 0.82 });
    },
    track: () => {
      playInviteStyleCue(destination, { root: 261.63, chord: [174.61, 261.63, 392, 587.33], sparkle: 880, noiseFrequency: 5000, gain: 1.06 });
      playTone({ frequency: 440, slideTo: 880, duration: 0.34, type: "triangle", destination, start: 0.11, gain: 0.01, attack: 0.04, release: 0.38, detune: 5 });
    },
    reveal: () => {
      playInviteStyleCue(destination, { root: 293.66, chord: [196, 293.66, 440, 659.25], sparkle: 1174.66, noiseFrequency: 6100, gain: 1.12 });
      playSoftChord([293.66, 440, 659.25, 987.77], { destination, duration: 0.78, gain: 0.011, attack: 0.12, release: 0.65 });
    }
  };

  cues[name]?.();
}

function scheduleAmbientMusic() {
  const audio = state.audio;
  if (!audio || !state.musicEnabled || state.siteVolume === 0) return;

  const step = audio.step;
  const chord = AMBIENT_CHORDS[step % AMBIENT_CHORDS.length];
  const shimmer = AMBIENT_SHIMMER_NOTES[(step + 1) % AMBIENT_SHIMMER_NOTES.length];
  const arpeggio = AMBIENT_ARPEGGIO_PATTERNS[step % AMBIENT_ARPEGGIO_PATTERNS.length];
  const breathFrequency = step % 2 === 0 ? 720 : 540;

  playTone({ frequency: chord[0] / 2, duration: 7.6, type: "sine", destination: audio.musicGain, start: 0, gain: 0.017, attack: 1.7, release: 2.2, detune: -10 });
  playSoftChord(chord, { destination: audio.musicGain, duration: 6.9, gain: 0.0095, attack: 1.45, release: 2.05 });
  playTone({ frequency: shimmer, duration: 2.25, type: "sine", destination: audio.musicGain, start: 2.1, gain: 0.0038, attack: 0.65, release: 1.2, detune: step % 2 === 0 ? 8 : -8 });
  playFilteredNoise({ start: 0.45, duration: 5.4, gain: 0.0024, attack: 0.7, release: 1.4, frequency: breathFrequency, type: "lowpass", destination: audio.musicGain });
  playAmbientArpeggio(arpeggio, { start: 0, destination: audio.musicGain });

  if (step % 3 === 2 && !isTrackListening()) {
    playAmbientBreakcoreFill({ start: 4.25, destination: audio.musicGain });
  }

  audio.step = (audio.step + 1) % AMBIENT_CHORDS.length;
  audio.startedAt = audio.context.currentTime;
}

function startBackgroundMusic() {
  const audio = createAudioEngine();
  if (!audio || audio.musicTimer || !state.musicEnabled) return;
  syncAudioVolume();
  scheduleAmbientMusic();
  audio.musicTimer = window.setInterval(scheduleAmbientMusic, 7000);
}

function stopBackgroundMusic() {
  if (!state.audio?.musicTimer) return;
  window.clearInterval(state.audio.musicTimer);
  state.audio.musicTimer = null;
}

function updateMusicToggle() {
  const toggle = $("musicToggle");
  const icon = $("musicToggleIcon");
  const emoji = state.musicEnabled ? "🎧" : "🔇";
  if (toggle) {
    toggle.textContent = emoji;
    toggle.setAttribute("aria-pressed", String(state.musicEnabled));
    toggle.title = state.musicEnabled ? t("Музыкальное сопровождение включено") : t("Музыкальное сопровождение выключено");
  }
  if (icon) icon.textContent = emoji;
}

function toggleVolumePanel(force) {
  state.volumePanelOpen = typeof force === "boolean" ? force : !state.volumePanelOpen;
  const control = $("volumeControl");
  const toggle = $("volumeToggle");
  const panel = $("volumePanel");
  control?.classList.toggle("open", state.volumePanelOpen);
  toggle?.setAttribute("aria-expanded", String(state.volumePanelOpen));
  panel?.setAttribute("aria-hidden", String(!state.volumePanelOpen));
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

function applyRoleTheme(role = "") {
  if (["spy", "civilian"].includes(role)) {
    document.body.dataset.role = role;
    return;
  }
  delete document.body.dataset.role;
}

function applyRoomTheme(theme = "neon") {
  const safeTheme = ["neon", "vinyl", "cyber", "retro", "minimal"].includes(theme) ? theme : "neon";
  document.body.dataset.visualTheme = safeTheme;
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
  document.body.dataset.screen = id;
  if (["menu", "lobby"].includes(id)) applyRoleTheme();
  updateInviteSecretsVisibility();
  updateMobileTurnBanner();
  if (previousPhase !== id) playSoundCue("screen");
}

function setStatus(id, message = "", isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = t(message);
  el.classList.toggle("error", isError);
}

function clearCinematicTimers() {
  if (state.cinematicTimer) {
    window.clearTimeout(state.cinematicTimer);
    state.cinematicTimer = null;
  }
  state.cinematicIntervals.forEach((timer) => window.clearTimeout(timer));
  state.cinematicIntervals = [];
}

function setCinematicOverlay({ eyebrow = "секретное досье", title = "...", text = "", meta = "", mode = "role", closeLabel = "Понял, играем", closable = true, onClose = null } = {}) {
  const overlay = $("cinematicOverlay");
  if (!overlay) return null;

  overlay.className = `cinematic-overlay ${mode ? `cinematic-${mode}` : ""}`;
  $("cinematicEyebrow").textContent = t(eyebrow);
  $("cinematicTitle").textContent = t(title);
  $("cinematicText").textContent = t(text);
  $("cinematicMeta").innerHTML = meta;
  const close = $("cinematicClose");
  close.textContent = t(closeLabel);
  close.classList.toggle("hidden", !closable);
  state.cinematicOnClose = typeof onClose === "function" ? onClose : null;
  overlay.classList.remove("hidden");
  document.body.classList.add("cinematic-open");
  return overlay;
}

function hideCinematicOverlay({ runOnClose = true } = {}) {
  clearCinematicTimers();
  const overlay = $("cinematicOverlay");
  if (!overlay) return;
  const onClose = runOnClose ? state.cinematicOnClose : null;
  state.cinematicOnClose = null;
  overlay.classList.add("closing");
  document.body.classList.remove("cinematic-open");
  state.cinematicTimer = window.setTimeout(() => {
    overlay.className = "cinematic-overlay hidden";
    state.cinematicTimer = null;
    if (onClose) onClose();
  }, 280);
}

function showRoleReveal(data) {
  clearCinematicTimers();
  const isSpy = data.role === "spy";
  const spyCount = data.spyCount || 1;
  const visibleSpyNames = isSpy
    ? (data.players || [])
      .filter((player) => (data.spyIds || []).includes(player.id))
      .map((player) => player.name)
      .join(", ")
    : "";
  const meta = isSpy
    ? `<span>${t("Тема скрыта")}</span><strong>${escapeHtml(visibleSpyNames || `${spyCount} ${spyCount === 1 ? t("1 шпион").replace("1 ", "") : t("Шпионы")}`)}</strong>`
    : `<span>${t("Тема игры")}</span><strong>«${escapeHtml(translateTheme(data.theme))}»</strong>`;

  setCinematicOverlay({
    eyebrow: t("игра началась"),
    title: isSpy ? t("Ты шпион") : t("Ты мирный"),
    text: isSpy
      ? t("Слушай чужие треки, лови вайб темы и не выдавай себя. Тема тебе не показывается.")
      : t("Это твоя секретная тема. Ставь треки так, чтобы свои поняли, а шпион запутался."),
    meta,
    mode: isSpy ? "spy" : "civilian",
    closeLabel: t("Запомнил")
  });

  playSoundCue(isSpy ? "danger" : "reveal");
  state.cinematicTimer = window.setTimeout(hideCinematicOverlay, 5200);
}

function showSpyRevealCountdown(data, onDone) {
  clearCinematicTimers();
  const spyNames = data.spyNames?.length ? data.spyNames.join(", ") : data.spyName;
  const suspectedNames = data.breakdown?.suspectedNames?.length ? data.breakdown.suspectedNames.join(", ") : t("подозреваемый");
  let count = 3;

  setCinematicOverlay({
    eyebrow: t("голоса приняты"),
    title: data.decoyReveal ? t("Проверяем подозреваемого...") : t("Шпионом был..."),
    text: data.decoyReveal ? t("Хост одобрил тему. Сейчас узнаем, попали ли игроки.") : t("Сейчас вскроем досье. Не моргай."),
    meta: `<strong class="countdown-number">${count}</strong>`,
    mode: "countdown",
    closable: false
  });
  playSoundCue("reveal");

  const showFinalSpy = () => {
    const meta = $("cinematicMeta");
    if (meta) {
      meta.innerHTML = `<span>${t(data.spyNames?.length > 1 ? "Шпионы" : "Шпион")}</span><strong>${escapeHtml(spyNames || t("не найден"))}</strong><small>${t(`Тема: «${data.theme || "?"}»`)}</small>`;
    }
    $("cinematicTitle").textContent = data.civiliansWin ? t("Мирные вычислили!") : t("Шпион ускользнул!");
    $("cinematicText").textContent = data.spyGuess?.correct
      ? t("Шпиона поймали, но он угадал тему и спасся.")
      : data.civiliansWin
        ? t("Красиво зачервили подозреваемых.")
        : t("Подозрения ушли не туда, настоящий шпион забирает победу.");
    const close = $("cinematicClose");
    close.textContent = t("Показать результаты");
    close.classList.remove("hidden");
    state.cinematicOnClose = onDone;
    playSoundCue(data.civiliansWin ? "confirm" : "danger");
  };

  const showWrongSuspect = () => {
    const meta = $("cinematicMeta");
    if (meta) {
      meta.innerHTML = `<span>${t("Подозреваемый")}</span><strong>${escapeHtml(suspectedNames)}</strong><small>${t("это был мирный игрок")}</small>`;
    }
    $("cinematicTitle").textContent = t("Это не шпион");
    $("cinematicText").textContent = t("Игроки промахнулись. Настоящее досье откроется через 5 секунд.");
    playSoundCue("danger");
    state.cinematicIntervals.push(window.setTimeout(showFinalSpy, 5000));
  };

  const tick = () => {
    count -= 1;
    const meta = $("cinematicMeta");
    if (!meta) return;
    if (count > 0) {
      meta.innerHTML = `<strong class="countdown-number pulse-pop">${count}</strong>`;
      playMetronomeTick();
      return;
    }

    if (data.decoyReveal) {
      showWrongSuspect();
      return;
    }
    showFinalSpy();
  };

  [1000, 2000, 3000].forEach((delay) => {
    state.cinematicIntervals.push(window.setTimeout(tick, delay));
  });
}

function addButtonRipple(button, event) {
  if (!button || button.disabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "button-ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  button.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 620);
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

  if (trackFrame?.contentWindow && trackFrame.src.includes("w.soundcloud.com") && window.SC?.Widget) {
    try {
      window.SC.Widget(trackFrame).setVolume(state.siteVolume);
    } catch {
      // SoundCloud widget may not be ready immediately after iframe creation.
    }
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
  if (state.profile?.displayName) return state.profile.displayName;
  return $("name").value.trim() || t("Без имени");
}

function syncNameInput() {
  const nameInput = $("name");
  if (!nameInput) return;
  if (state.profile?.displayName) {
    nameInput.value = state.profile.displayName;
    nameInput.disabled = true;
    nameInput.title = t("Ник аккаунта меняется в профиле");
  } else {
    nameInput.disabled = false;
    nameInput.title = "";
  }
}

function updateLobbyRenameControls() {
  const input = $("renameInput");
  const button = $("renameBtn");
  const row = input?.closest(".rename-row");
  const panel = input?.closest(".lobby-action-panel");
  if (!input || !button) return;
  const canRenameInLobby = state.authGuest;
  row?.classList.toggle("hidden", !canRenameInLobby);
  panel?.classList.toggle("no-guest-rename", !canRenameInLobby);
  input.disabled = !canRenameInLobby;
  button.disabled = !canRenameInLobby;
  input.placeholder = canRenameInLobby ? t("Новый ник") : t("Ник меняется в профиле");
  button.textContent = canRenameInLobby ? t("Сменить ник") : t("Ник из профиля");
}

function getStoredAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function storeAuthToken(token) {
  if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearStoredAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

function consumeOAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("auth_token");
  const error = params.get("auth_error");
  if (!token && !error) return;

  if (token) storeAuthToken(token);
  params.delete("auth_token");
  params.delete("auth_error");
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState({}, document.title, nextUrl || "/");

  state.oauthRedirectError = error || "";
  if (error) setAuthStatus(error || "Не удалось войти через соцсеть", true);
  if (token) setAuthStatus("Вход через соцсеть выполнен");
}

function getReconnectToken() {
  let token = window.localStorage.getItem(RECONNECT_TOKEN_KEY) || "";
  if (!token) {
    token = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, token);
  }
  return token;
}

function storeReconnectState(code) {
  if (!code) return;
  window.localStorage.setItem(RECONNECT_STATE_KEY, JSON.stringify({
    code,
    reconnectToken: getReconnectToken(),
    name: getName(),
    savedAt: Date.now()
  }));
}

function getStoredReconnectState() {
  try {
    return JSON.parse(window.localStorage.getItem(RECONNECT_STATE_KEY) || "null");
  } catch {
    return null;
  }
}

function clearReconnectState() {
  window.localStorage.removeItem(RECONNECT_STATE_KEY);
}

function attemptReconnectToGame() {
  const saved = getStoredReconnectState();
  if (!saved?.code || !saved?.reconnectToken || state.currentCode || !state.authResolved || !socket.connected) return;

  socket.emit("reconnectGame", { code: saved.code, reconnectToken: saved.reconnectToken }, (res) => {
    if (!res?.success) return;
    state.currentCode = res.code || saved.code;
    state.myId = res.playerId || socket.id;
    storeReconnectState(state.currentCode);
    setStatus("gameStatus", "Ты вернулся в игру");
  });
}

function setAuthStatus(message = "", isError = false) {
  setStatus("authStatus", message, isError);
  setStatus("accountStatus", message, isError);
}

function showAuthModal(mode = "choice") {
  selectAuthMode(mode);
  $("authModal").classList.remove("hidden");
}

function openAccountPanel() {
  showAuthModal(state.profile ? "profile" : "choice");
}

function hideAuthModal() {
  $("authModal").classList.add("hidden");
  setAuthStatus();
}


function showHowToPlay() {
  const modal = $("howToPlayModal");
  if (!modal) return;
  modal.classList.remove("hidden");
}

function hideHowToPlay() {
  const modal = $("howToPlayModal");
  if (modal) modal.classList.add("hidden");
}

function focusNicknameInput() {
  const nameInput = $("name");
  if (!nameInput) return;
  nameInput.focus({ preventScroll: false });
  nameInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showDemoFlow() {
  setCinematicOverlay({
    eyebrow: "демо партия",
    title: "Тема: ностальгия",
    text: "Мирные ставят треки из прошлого, шпион слушает подсказки и пытается не выдать себя. После раундов все голосуют, а найденный шпион выбирает настоящую тему.",
    meta: `<span>${t("пример хода")}</span><strong>${escapeHtml(t("Игрок ставит трек → все реагируют → ищем подозрительного"))}</strong>`,
    mode: "demo",
    closeLabel: "Понял, играем",
    onClose: focusNicknameInput
  });
}

function scrollMobilePanel(targetId) {
  const target = $(targetId);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateMobileTurnBanner(label = state.mobileTurnLabel) {
  const banner = $("mobileTurnBanner");
  if (!banner) return;
  state.mobileTurnLabel = label || "";
  const shouldShow = state.phase === "game" && state.currentPlayerId === socket.id && state.turnStage === "waiting";
  banner.textContent = t(label || "Твой ход — вставь трек");
  banner.classList.toggle("hidden", !shouldShow);
}

function selectAuthMode(mode) {
  state.authFormMode = mode;
  const isProfile = mode === "profile" && state.profile;
  const isChoice = mode === "choice" || (mode === "profile" && !state.profile);
  const isRegister = false;
  const isForm = mode === "login";
  $("authChoiceView").classList.toggle("hidden", !isChoice);
  $("authFormView").classList.toggle("hidden", !isForm);
  $("accountProfileView").classList.toggle("hidden", !isProfile);
  $("authRegisterHint").classList.toggle("hidden", !isRegister);
  $("authModalTitle").textContent = isProfile
    ? t("Профиль игрока")
    : isChoice ? t("Как продолжим?") : t("Вход в аккаунт");
  $("authModalText").textContent = isProfile
    ? t("Твоя музыкальная легенда, аватар и статистика партий.")
    : isChoice
      ? t("Войди через соцсети, старый логин или останься гостем на одну партию.")
      : t("Войди, если уже регистрировался раньше.");
  $("authSubmitBtn").textContent = t("Войти");
  if (isProfile) renderProfileStats();
  setAuthStatus();
  if (isForm) $("authLogin").focus();
}

function submitAuthForm() {
  return loginAccount();
}

function loginWithOAuth(provider) {
  const normalizedProvider = provider === "discord" ? "discord" : "google";
  setAuthStatus(normalizedProvider === "google" ? "Перекидываем на Google..." : "Перекидываем в Discord...");
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = `/auth/${normalizedProvider}?returnTo=${encodeURIComponent(returnTo)}`;
}

function applyProfile(profileData = { user: null, guest: true }) {
  state.profile = profileData.user || null;
  state.authGuest = Boolean(profileData.guest);
  state.authResolved = true;
  const user = state.profile;
  const displayName = user?.displayName || $("name").value.trim() || t("Гость");
  $("accountProfileView")?.classList.toggle("hidden", !user || state.authFormMode !== "profile");
  $("profileEditor")?.classList.add("hidden");
  $("logoutBtn")?.classList.toggle("hidden", !user);
  if ($("profileName")) $("profileName").textContent = displayName;
  if ($("profileLogin")) $("profileLogin").textContent = user ? `@${user.username}` : t("гость без регистрации");
  if ($("profileDisplayName")) $("profileDisplayName").value = displayName;
  if ($("profileAvatar")) {
    $("profileAvatar").innerHTML = user?.avatar
      ? `<img src="${escapeAttribute(user.avatar)}" alt="Аватар профиля">`
      : escapeHtml(displayName.slice(0, 1).toUpperCase() || "?");
  }
  updateAccountToggle(displayName, user);
  renderProfileStats();
  syncNameInput();
  updateLobbyRenameControls();
  attemptReconnectToGame();
  attemptAutoJoinFromInvite();
}

function updateAccountToggle(displayName, user) {
  const avatar = $("accountToggleAvatar");
  const label = $("accountToggleLabel");
  if (label) label.textContent = user ? displayName : t("Гость");
  if (!avatar) return;
  avatar.innerHTML = user?.avatar
    ? `<img src="${escapeAttribute(user.avatar)}" alt="">`
    : (user ? escapeHtml(displayName.slice(0, 1).toUpperCase() || "?") : "👤");
}

function percent(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function renderProfileStats() {
  const grid = $("profileStatsGrid");
  if (!grid || !state.profile) return;
  const stats = state.profile.stats || {};
  const games = Number(stats.games || 0);
  const spyGames = Number(stats.spyGames || 0);
  const civilianGames = Number(stats.civilianGames || 0);
  const wins = Number(stats.wins || 0);
  const spyWins = Number(stats.spyWins || 0);
  const civilianWins = Number(stats.civilianWins || 0);
  const spyRate = spyGames ? spyWins / spyGames : 0;
  const civilianRate = civilianGames ? civilianWins / civilianGames : 0;
  const bestRole = spyGames && spyRate >= civilianRate ? t("теневой шпион") : t("народный детектив");
  grid.innerHTML = [
    ["🎮", t("Игр сыграно"), games],
    ["🏆", t("Общий винрейт"), percent(wins, games)],
    ["🕵️", t("Побед за шпиона"), `${spyWins}/${spyGames} · ${percent(spyWins, spyGames)}`],
    ["🛡️", t("Побед за мирных"), `${civilianWins}/${civilianGames} · ${percent(civilianWins, civilianGames)}`],
    ["🎯", t("Любимая роль"), bestRole],
    ["🔥", t("Серия побед"), stats.winStreak || 0]
  ].map(([icon, label, value]) => `
    <div class="profile-stat-card">
      <span>${icon}</span>
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join("");
}

function authenticateWithStoredToken() {
  const token = getStoredAuthToken();
  if (!token) {
    continueAsGuest({ silent: true });
    return;
  }
  socket.emit("auth:session", { token }, (res) => {
    if (res?.success) {
      applyProfile(res.profile);
      hideAuthModal();
      setAuthStatus("С возвращением!");
    } else {
      clearStoredAuthToken();
      continueAsGuest({ silent: true });
    }
  });
}

function authPayload() {
  return {
    username: $("authLogin").value.trim(),
    password: $("authPassword").value,
    displayName: getName() || $("authLogin").value.trim()
  };
}

function loginAccount() {
  setAuthStatus();
  socket.emit("auth:login", authPayload(), (res) => {
    if (res?.error) return setAuthStatus(res.error, true);
    storeAuthToken(res.token);
    applyProfile(res.profile);
    hideAuthModal();
    setAuthStatus("Вход выполнен");
  });
}


function continueAsGuest({ silent = false } = {}) {
  clearStoredAuthToken();
  socket.emit("auth:guest", { name: getName() }, (res) => {
    applyProfile(res?.profile || { user: null, guest: true });
    if (!silent) hideAuthModal();
    if (silent && state.oauthRedirectError) {
      setAuthStatus(state.oauthRedirectError, true);
      state.oauthRedirectError = "";
    } else {
      setAuthStatus();
    }
  });
}

function logoutAccount() {
  clearStoredAuthToken();
  socket.emit("auth:logout", () => {
    applyProfile({ user: null, guest: true });
    hideAuthModal();
    setAuthStatus("Ты вышел из аккаунта");
  });
}

function toggleProfileEditor() {
  $("profileEditor").classList.toggle("hidden");
}

function previewAvatarFile(file) {
  state.pendingAvatar = undefined;
  if (!file) return;
  if (!file.type.startsWith("image/")) return setAuthStatus("Выбери картинку", true);
  if (file.size > 1024 * 1024) return setAuthStatus("Файл слишком большой. Выбери картинку до 1 МБ", true);
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const dataUrl = canvas.toDataURL("image/webp", 0.72);
      if (dataUrl.length > AVATAR_MAX_BYTES) {
        return setAuthStatus("Аватар не удалось сжать до 64 КБ", true);
      }
      state.pendingAvatar = dataUrl;
      $("profileAvatar").innerHTML = `<img src="${escapeAttribute(dataUrl)}" alt="Предпросмотр аватара">`;
      setAuthStatus("Предпросмотр готов. Нажми «Сохранить профиль»");
    };
    image.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function clearAvatar() {
  state.pendingAvatar = "";
  $("profileAvatar").textContent = ($("profileDisplayName").value || "?").slice(0, 1).toUpperCase();
  setAuthStatus("Аватар будет удален после сохранения");
}

function saveProfile() {
  const payload = { displayName: $("profileDisplayName").value.trim() || state.profile?.displayName || getName() };
  if (state.pendingAvatar !== undefined) payload.avatar = state.pendingAvatar;
  socket.emit("profile:update", payload, (res) => {
    if (res?.error) return setAuthStatus(res.error, true);
    state.pendingAvatar = undefined;
    applyProfile(res.profile);
    setAuthStatus();
  });
}

function playerAvatarMarkup(player, fallback = "?") {
  if (player?.avatar) return `<span class="avatar image-avatar"><img src="${escapeAttribute(player.avatar)}" alt=""></span>`;
  return `<span class="avatar">${escapeHtml(fallback)}</span>`;
}

function normalizeRoomCodeInput(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function getCode() {
  return normalizeRoomCodeInput($("code").value);
}

function buildInviteLink(code = state.currentCode) {
  const roomCode = normalizeRoomCodeInput(code);
  if (!roomCode) return "";
  const url = new URL(window.location.pathname || "/", window.location.origin);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function attemptAutoJoinFromInvite() {
  const code = normalizeRoomCodeInput(state.pendingInviteCode);
  if (!code || state.inviteAutoJoinAttempted || state.currentCode || !state.authResolved || !socket.connected) return;

  state.inviteAutoJoinAttempted = true;
  if ($("code")) $("code").value = code;
  setStatus("menuError", "Подключаем к лобби по ссылке-приглашению...");

  socket.emit("joinLobby", { code, name: getName(), reconnectToken: getReconnectToken() }, (res) => {
    if (res?.error) {
      state.inviteAutoJoinAttempted = false;
      return setStatus("menuError", res.error, true);
    }

    state.currentCode = res.code || code;
    state.myId = res.playerId || socket.id;
    storeReconnectState(state.currentCode);
    showScreen("lobby");
    setStatus("lobbyStatus", "Ты вошел в лобби по ссылке-приглашению");
  });
}

function createLobby() {
  setStatus("menuError");
  socket.emit("createLobby", { name: getName(), reconnectToken: getReconnectToken() }, (res) => {
    if (res.error) return setStatus("menuError", res.error, true);
    state.currentCode = res.code;
    state.myId = res.playerId || socket.id;
    storeReconnectState(state.currentCode);
    $("code").value = res.code;
    showScreen("lobby");
  });
}

function joinLobby() {
  setStatus("menuError");
  const code = getCode();
  if (!code) return setStatus("menuError", "Введи код комнаты", true);

  socket.emit("joinLobby", { code, name: getName(), reconnectToken: getReconnectToken() }, (res) => {
    if (res.error) return setStatus("menuError", res.error, true);
    state.currentCode = res.code || code;
    state.myId = res.playerId || socket.id;
    storeReconnectState(state.currentCode);
    showScreen("lobby");
  });
}

function showStartCinematic() {
  setCinematicOverlay({
    eyebrow: "старт шоу",
    title: "Распределяем роли…",
    text: "Выбираем тему, перемешиваем очередь и загружаем секретные досье.",
    meta: `<span>${t("загружаем досье")}</span><strong>ACCESS CHECK</strong>`,
    mode: "countdown",
    closable: false
  });
}

function startGame() {
  showStartCinematic();
  setStatus("lobbyStatus", "Запускаем...");
  socket.emit("startGame", { code: state.currentCode }, (res) => {
    if (res?.error) {
      hideCinematicOverlay({ runOnClose: false });
      setStatus("lobbyStatus", res.error, true);
    }
  });
}

function forceStartGame() {
  showStartCinematic();
  setStatus("lobbyStatus", "FORCE START: отмечаем всех готовыми и запускаем...");
  socket.emit("forceStartGame", { code: state.currentCode }, (res) => {
    if (res?.error) {
      hideCinematicOverlay({ runOnClose: false });
      setStatus("lobbyStatus", res.error, true);
    }
  });
}

function restartLobby() {
  socket.emit("restartLobby", { code: state.currentCode }, (res) => {
    if (res?.error) {
      const statusId = state.phase === "game" ? "gameStatus" : "voteStatus";
      return setStatus(statusId, res.error, true);
    }
    closeTransientOverlays();
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

function hostTogglePause() {
  socket.emit("hostTogglePause", { code: state.currentCode }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", res.paused ? "Прослушивание на паузе" : "Прослушивание продолжено");
  });
}

function hostAdjustTimer(delta) {
  socket.emit("hostAdjustTimer", { code: state.currentCode, delta }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", `Таймер: ${res.timeLeft} сек`);
  });
}

function hostAdjustRounds(delta) {
  socket.emit("hostAdjustRounds", { code: state.currentCode, delta }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    state.totalRounds = res.rounds || state.totalRounds;
    setStatus("gameStatus", `Раундов в игре: ${state.totalRounds}`);
  });
}

function openHostPlayersModal() {
  renderHostControls();
  const modal = $("hostPlayersModal");
  if (modal) modal.classList.remove("hidden");
}

function closeHostPlayersModal() {
  const modal = $("hostPlayersModal");
  if (modal) modal.classList.add("hidden");
}

function closeSpyReviewModal() {
  const modal = $("spyReviewModal");
  if (modal) modal.classList.add("hidden");
  setStatus("spyReviewStatus");
}

function closeTransientOverlays() {
  hideCinematicOverlay({ runOnClose: false });
  closeHostPlayersModal();
  closeSpyReviewModal();
  hideHowToPlay();
  const authModal = $("authModal");
  if (authModal) authModal.classList.add("hidden");
}

function hostSetTurn(playerId) {
  socket.emit("hostSetTurn", { code: state.currentCode, playerId }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", "Ход передан игроку");
    closeHostPlayersModal();
  });
}

function hostKickPlayer(playerId) {
  socket.emit("hostKickPlayer", { code: state.currentCode, playerId }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    setStatus("gameStatus", "Игрок удален из комнаты");
    closeHostPlayersModal();
  });
}

function selectSpyGuessOption(optionId) {
  const input = $("spyGuessInput");
  if (input) input.value = optionId;
  document.querySelectorAll(".spy-guess-option").forEach((button) => {
    const selected = button.dataset.optionId === optionId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  });
}

function renderSpyGuessOptions(options = []) {
  const box = $("spyGuessOptions");
  if (!box) return;
  box.innerHTML = options.length
    ? options.map((option) => `
      <button class="spy-guess-option" type="button" role="radio" aria-checked="false" data-option-id="${escapeHtml(option.id)}" onclick="selectSpyGuessOption('${escapeHtml(option.id)}')">
        ${escapeHtml(translateTheme(option.text))}
      </button>
    `).join("")
    : `<div class="spy-guess-auto">${t("Тема выбрана автоматически")}</div>`;
}

function submitSpyGuess() {
  const input = $("spyGuessInput");
  const button = $("spyGuessSubmitBtn");
  const optionId = input?.value.trim() || "";
  if (!optionId) return setStatus("spyGuessStatus", "Выбери один из вариантов темы", true);
  if (button) button.disabled = true;
  socket.emit("submitSpyGuess", { code: state.currentCode, optionId }, (res) => {
    if (res?.error) {
      if (button) button.disabled = false;
      return setStatus("spyGuessStatus", res.error, true);
    }
    document.querySelectorAll(".spy-guess-option").forEach((item) => { item.disabled = true; });
    setStatus("spyGuessStatus", "Ответ принят. Сейчас будет финальное раскрытие.");
  });
}

function resolveSpyGuess(correct) {
  socket.emit("hostResolveSpyGuess", { code: state.currentCode, correct }, (res) => {
    if (res?.error) return setStatus("spyReviewStatus", res.error, true);
    closeSpyReviewModal();
  });
}

function popReactionEmoji(reaction) {
  const stage = document.querySelector(".player-stage");
  if (!stage) return;
  const burst = document.createElement("span");
  burst.className = "reaction-burst";
  burst.textContent = reaction;
  stage.appendChild(burst);
  window.setTimeout(() => burst.remove(), 900);
}

function sendReaction(reaction) {
  socket.emit("trackReaction", { code: state.currentCode, reaction }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    state.selectedReaction = res.selectedReaction || null;
    state.reactionCounts = res.reactionCounts || state.reactionCounts;
    popReactionEmoji(reaction);
    renderReactions();
  });
}

async function copyRoomCode() {
  if (!state.currentCode) return;
  try {
    await navigator.clipboard.writeText(state.currentCode);
    setStatus("lobbyStatus", "Код скопирован");
  } catch {
    setStatus("lobbyStatus", "Не удалось скопировать код автоматически", true);
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

  if (copyCode) {
    copyCode.textContent = isVisible ? (state.currentCode || "-----") : "•••••";
    copyCode.classList.toggle("secret-blurred", !isVisible);
    copyCode.setAttribute("aria-label", isVisible ? `Скопировать код комнаты ${state.currentCode || ""}` : "Скопировать скрытый код комнаты");
    copyCode.title = isVisible ? "Скопировать код комнаты" : "Скопировать код комнаты, не показывая его";
  }

  if (qrWrap) {
    qrWrap.classList.toggle("secret-blurred", !isVisible);
    qrWrap.setAttribute("aria-hidden", String(!isVisible));
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

function resetRoomState() {
  state.currentCode = "";
  state.lobby = null;
  state.players = [];
  state.order = [];
  state.hostId = null;
  state.role = "";
  state.theme = "";
  state.spyIds = [];
  state.ready = false;
  state.trackHistory = [];
  state.reactionCounts = {};
  state.selectedReaction = null;
  state.finalComments = [];
  state.latestResult = null;
  state.inviteSecretsVisible = false;
  clearReconnectState();
}

function leaveLobby() {
  if (!state.currentCode) {
    resetRoomState();
    showScreen("menu");
    return;
  }

  setStatus("lobbyStatus", "Выходим из лобби...");
  socket.emit("leaveLobby", { code: state.currentCode }, (res) => {
    if (res?.error) return setStatus("lobbyStatus", res.error, true);
    resetRoomState();
    clearPlayer();
    hideCinematicOverlay({ runOnClose: false });
    showScreen("menu");
    setStatus("menuError", "Ты вышел из лобби");
  });
}

function readSettingsFromForm() {
  const spyModeValue = $("settingSpyMode").value;
  return {
    gameMode: $("settingGameMode").value,
    rounds: Number($("settingRounds").value),
    listenTime: Number($("settingListenTime").value),
    spyMode: spyModeValue === "auto" ? "auto" : "manual",
    spyCount: spyModeValue === "auto" ? 1 : Number(spyModeValue),
    anonymousVoting: $("settingAnonymousVoting").value === "true",
    votingTime: Number($("settingVotingTime").value),
    runoffOnTie: $("settingRunoffOnTie").value === "true",
    roomTheme: $("settingRoomTheme")?.value || "neon"
  };
}

function changeGameMode() {
  const preset = GAME_MODE_PRESETS[$("settingGameMode").value] || GAME_MODE_PRESETS.classic;
  $("settingRounds").value = String(preset.rounds);
  $("settingListenTime").value = String(preset.listenTime);
  if ($("settingSpyMode")) $("settingSpyMode").value = preset.spyMode || "auto";
  $("settingAnonymousVoting").value = String(preset.anonymousVoting);
  $("settingVotingTime").value = String(preset.votingTime);
  $("settingRunoffOnTie").value = String(preset.runoffOnTie);
  if ($("settingRoomTheme")) $("settingRoomTheme").value = preset.roomTheme || "neon";
  updateGameModeHint(preset);
  updateLobbySettings();
}

function updateGameModeHint(preset = null) {
  const mode = $("settingGameMode")?.value || state.settings.gameMode || "classic";
  const activePreset = preset || GAME_MODE_PRESETS[mode] || GAME_MODE_PRESETS.classic;
  const hint = $("gameModeHint");
  if (hint) hint.textContent = t(activePreset.hint);
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
  if (!state.authGuest) {
    updateLobbyRenameControls();
    return setStatus("lobbyStatus", "Ник аккаунта меняется только в профиле", true);
  }
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
    settingGameMode: settings.gameMode || "classic",
    settingRounds: settings.rounds || 3,
    settingListenTime: settings.listenTime || DEFAULT_LISTEN_TIME,
    settingSpyMode: spyValue,
    settingAnonymousVoting: String(Boolean(settings.anonymousVoting)),
    settingVotingTime: settings.votingTime ?? 60,
    settingRunoffOnTie: String(settings.runoffOnTie !== false),
    settingRoomTheme: settings.roomTheme || "neon"
  };

  for (const [id, value] of Object.entries(fields)) {
    const el = $(id);
    if (!el) continue;
    el.value = String(value);
    el.disabled = !isHost;
  }

  updateGameModeHint(GAME_MODE_PRESETS[fields.settingGameMode]);
  $("settingsHint").textContent = isHost ? t("ты можешь менять") : t("меняет хост");
  applyRoomTheme(fields.settingRoomTheme);
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
    updateMobileTurnBanner("Трек играет");
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
  state.chatMessages = lobby.chatMessages || state.chatMessages;
  state.finalComments = lobby.finalComments || state.finalComments;
  applyRoomTheme(state.settings.roomTheme || "neon");

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
  $("hostBadge").textContent = isHost ? t("ты хост") : `${t("хост")}: ${state.players.find((p) => p.id === lobby.host)?.name || "..."}`;
  $("startBtn").disabled = !isHost || state.players.length < 3 || readyCount !== state.players.length;
  $("startBtn").textContent = state.players.length < 3
    ? t("Ждем минимум 3 игроков")
    : readyCount !== state.players.length
      ? t("Ждем готовность всех игроков")
      : t("Запустить игру");
  const forceStartBtn = $("forceStartBtn");
  forceStartBtn.disabled = !isHost || state.players.length < 3;
  forceStartBtn.classList.toggle("hidden", !isHost);
  forceStartBtn.textContent = t("FORCE START");
  $("readyBtn").textContent = state.ready ? t("Не готов") : t("Я готов");
  $("readyBtn").classList.toggle("ready", state.ready);
  $("readySummary").textContent = t(`Готовы: ${readyCount}/${state.players.length}`);
  applySettingsToForm(state.settings, isHost);
  updateLobbyRenameControls();

  $("players").innerHTML = state.players.map((player, index) => `
    <div class="player-row">
      ${playerAvatarMarkup(player, index + 1)}
      <strong>${escapeHtml(player.name)}</strong>
      ${player.ready ? `<em>${t("готов")}</em>` : `<em>${t("не готов")}</em>`}
      ${player.id === lobby.host ? "<em>host</em>" : ""}
      ${player.id === socket.id ? `<em>${t("ты")}</em>` : ""}
    </div>
  `).join("");
  renderChat();

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
  state.pausedTurnStage = data.pausedTurnStage || null;
  state.timeLeft = data.timeLeft ?? state.timeLeft;
  state.voteCandidates = data.voteCandidates || state.voteCandidates;
  state.reactionCounts = data.reactionCounts || state.reactionCounts;
  state.trackHistory = data.trackHistory || state.trackHistory;
  state.chatMessages = data.chatMessages || state.chatMessages;
  state.finalComments = data.finalComments || state.finalComments;
  applyRoomTheme(state.settings.roomTheme || "neon");
  state.pendingSpyGuess = data.pendingSpyGuess || state.pendingSpyGuess;
  if (Array.isArray(data.spyIds)) state.spyIds = data.spyIds;
  const shouldLoadLastTrack = ["listening", "paused"].includes(data.turnStage)
    && data.lastTrack
    && data.lastTrack.id !== state.currentTrackId;
  if (shouldLoadLastTrack) {
    state.selectedReaction = null;
  }

  $("roundInfo").textContent = t(`Раунд ${state.round}/${state.totalRounds}`);
  $("roundBar").style.width = `${Math.min(100, (state.round / state.totalRounds) * 100)}%`;
  renderOrder();
  renderHostControls();
  renderReactions();
  renderTrackHistory();
  renderChat();
  updateSendButton(data.submittedThisTurn);

  if (shouldLoadLastTrack) loadTrack(data.lastTrack);
}

function canSeeSpyMarkers() {
  return state.role === "spy" && Array.isArray(state.spyIds) && state.spyIds.length > 0;
}

function playerNameMarkup(player, fallback = "Игрок") {
  const name = escapeHtml(player?.name || t(fallback));
  const isVisibleSpy = canSeeSpyMarkers() && state.spyIds.includes(player?.id);
  return `<strong class="${isVisibleSpy ? "spy-visible-name" : ""}">${name}</strong>${isVisibleSpy ? `<small class="spy-visible-badge">${t("Шпион")}</small>` : ""}`;
}

function renderOrder() {
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  $("order").innerHTML = state.order.map((id, index) => {
    const player = playersById.get(id);
    const active = id === state.currentPlayerId;
    return `
      <div class="order-row ${active ? "active" : ""}">
        <span>${index + 1}</span>
        ${playerNameMarkup(player)}
      </div>
    `;
  }).join("");
}

function renderHostControls() {
  const controls = $("hostControls");
  const kickList = $("hostKickList");
  const nowPlaying = $("hostNowPlaying");
  const timerState = $("hostTimerState");
  const pauseBtn = $("hostPauseBtn");
  if (!controls) return;

  const isHost = state.hostId === socket.id;
  controls.classList.toggle("hidden", !isHost);
  if (!isHost) {
    if (kickList) kickList.innerHTML = "";
    return;
  }

  const currentPlayer = state.players.find((player) => player.id === state.currentPlayerId);
  if (nowPlaying) nowPlaying.textContent = currentPlayer?.name || t("Ожидаем ход...");
  if (timerState) {
    const stageLabel = state.turnStage === "paused"
      ? t("пауза")
      : state.turnStage === "listening"
        ? t("слушаем")
        : t("ожидание");
    timerState.textContent = Number.isFinite(state.timeLeft) ? `${state.timeLeft} ${t("сек")} · ${stageLabel}` : stageLabel;
  }
  if (pauseBtn) {
    pauseBtn.textContent = state.turnStage === "paused" ? t("Продолжить") : t("Пауза");
    pauseBtn.disabled = !["listening", "paused"].includes(state.turnStage);
  }

  if (kickList) kickList.innerHTML = state.players.map((player) => {
    const isMe = player.id === socket.id;
    const isCurrent = player.id === state.currentPlayerId;
    return `
      <div class="kick-row host-player-row">
        <span>${escapeHtml(player.name)} ${isMe ? `(${t("ты")})` : ""}</span>
        <div class="host-player-actions">
          <button class="mini-action" ${isCurrent ? "disabled" : ""} onclick="hostSetTurn('${escapeAttribute(player.id)}')">${isCurrent ? t("ходит") : t("передать")}</button>
          <button class="mini-action danger" ${isMe ? "disabled" : ""} onclick="hostKickPlayer('${escapeAttribute(player.id)}')">${isMe ? t("хост") : t("кик")}</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderReactions() {
  const buttons = $("reactionButtons");
  const summary = $("reactionSummary");
  if (!buttons || !summary) return;

  const isOwnTrack = state.currentPlayerId === socket.id && ["listening", "paused"].includes(state.turnStage);
  buttons.innerHTML = ALLOWED_REACTIONS.map((reaction) => `
    <button class="reaction-btn ${state.selectedReaction === reaction ? "selected" : ""}" ${isOwnTrack ? "disabled" : ""} onclick="sendReaction('${escapeAttribute(reaction)}')">
      <span>${reaction}</span>
      <strong>${state.reactionCounts[reaction] || 0}</strong>
    </button>
  `).join("");

  const activeCounts = ALLOWED_REACTIONS
    .filter((reaction) => state.reactionCounts[reaction])
    .map((reaction) => `${reaction} ${state.reactionCounts[reaction]}`);
  summary.textContent = isOwnTrack ? t("На свой трек реакции ставить нельзя") : (activeCounts.length ? activeCounts.join(" · ") : t("Пока реакций нет"));
}

function formatReactions(reactions = {}) {
  const activeCounts = ALLOWED_REACTIONS
    .filter((reaction) => reactions[reaction])
    .map((reaction) => `${reaction} ${reactions[reaction]}`);
  return activeCounts.length ? activeCounts.join(" · ") : t("без реакций");
}

function renderTrackHistory(targetId = "trackHistory", history = state.trackHistory) {
  const el = $(targetId);
  if (!el) return;

  if (!history?.length) {
    el.classList.add("empty");
    el.textContent = t("Пока треков нет");
    return;
  }

  el.classList.remove("empty");
  el.innerHTML = history.map((track) => {
    const trackUrl = String(track.url || "").trim();
    const safeUrl = escapeHtml(trackUrl);
    const link = trackUrl
      ? `<a class="history-track-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${t("Открыть трек")}</a>`
      : `<em>${t("ссылка на трек")}: —</em>`;

    return `
      <div class="history-row">
        <span>${t(`Раунд ${track.round}, ход ${track.turnNumber || "?"}`)}</span>
        <strong>${escapeHtml(track.playerName || t("Игрок"))}</strong>
        <small>${formatReactions(track.reactions)}</small>
        <div class="history-row-link">${link}</div>
      </div>
    `;
  }).join("");
}


function formatChatTime(createdAt) {
  const date = new Date(Number(createdAt) || Date.now());
  return date.toLocaleTimeString(currentLanguage() === "en" ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function initChatScrollbarFeedback() {
  for (const scrollArea of document.querySelectorAll("[data-chat-scroll]")) {
    let scrollFeedbackTimer = null;
    scrollArea.addEventListener("scroll", () => {
      scrollArea.classList.add("is-scrolling");
      window.clearTimeout(scrollFeedbackTimer);
      scrollFeedbackTimer = window.setTimeout(() => {
        scrollArea.classList.remove("is-scrolling");
      }, 700);
    }, { passive: true });
  }
}

function renderChat(messages = state.chatMessages) {
  const boxes = [...document.querySelectorAll("[data-chat-messages]")];
  if (!boxes.length) return;
  const list = Array.isArray(messages) ? messages : [];
  state.chatMessages = list;
  const markup = list.map((message) => {
    const isMine = message.playerId === socket.id;
    return `
      <div class="chat-message ${isMine ? "mine" : ""}">
        <div class="chat-message-meta">
          <strong>${escapeHtml(message.playerName || t("Игрок"))}</strong>
          <span>${escapeHtml(formatChatTime(message.createdAt))}</span>
        </div>
        <p>${escapeHtml(message.text || "")}</p>
      </div>
    `;
  }).join("");

  for (const box of boxes) {
    const scrollArea = box.closest("[data-chat-scroll]") || box;
    if (!list.length) {
      box.classList.add("empty");
      box.textContent = t("Пока сообщений нет");
      scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: "auto" });
      continue;
    }
    const hadMessages = box.children.length > 0;
    box.classList.remove("empty");
    box.innerHTML = markup;
    scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: hadMessages ? "smooth" : "auto" });
  }
}

function handleChatKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  sendChatMessage();
}

function activeChatElements() {
  const root = document.querySelector(`.screen:not(.hidden)`) || document;
  return {
    input: root.querySelector("[data-chat-input]"),
    status: root.querySelector("[data-chat-status]")
  };
}

function setChatStatus(message = "", isError = false) {
  for (const status of document.querySelectorAll("[data-chat-status]")) {
    status.textContent = t(message);
    status.classList.toggle("error", isError);
  }
}

function sendChatMessage() {
  const { input } = activeChatElements();
  const text = input?.value.trim() || "";
  if (!text) return setChatStatus("Напиши сообщение", true);

  for (const chatInput of document.querySelectorAll("[data-chat-input]")) chatInput.value = "";
  input?.focus({ preventScroll: true });

  socket.emit("chat:send", { code: state.currentCode, text }, (res) => {
    if (res?.error) {
      if (input && !input.value) input.value = text;
      input?.focus({ preventScroll: true });
      return setChatStatus(res.error, true);
    }
    input?.focus({ preventScroll: true });
    setChatStatus("Сообщение отправлено");
  });
}

function updateTurn({ playerId, name, round, turnNumber, turnsInRound, stage }) {
  state.currentPlayerId = playerId;
  state.round = round;
  state.turnStage = stage || "waiting";
  state.timeLeft = null;
  const isMine = playerId === socket.id;
  if (isMine && navigator.vibrate) navigator.vibrate([80, 35, 80]);
  const currentPlayer = state.players.find((player) => player.id === playerId) || { id: playerId, name };
  $("turn").innerHTML = `
    <span>${isMine ? t("Твой ход") : t("Сейчас ходит")}</span>
    ${playerNameMarkup(currentPlayer)}
    <small>${t(`ход ${turnNumber}/${turnsInRound}`)}</small>
  `;
  clearPlayer();
  state.reactionCounts = {};
  state.selectedReaction = null;
  renderReactions();
  updateTimer({ timeLeft: null, stage: "waiting", listenTime: state.settings.listenTime || DEFAULT_LISTEN_TIME });
  const turnStatus = isMine ? "Очередь ждет тебя: вставь ссылку на трек." : "Ждем, пока игрок поставит трек. Таймер пока не идет.";
  setStatus("gameStatus", turnStatus);
  updateMobileTurnBanner(isMine ? "Твой ход — вставь трек" : `Ждем трек от ${name || t("Игрок")}`);
  renderOrder();
  renderHostControls();
  updateSendButton(false);
}

function updateSendButton(submitted = false) {
  const isMine = state.currentPlayerId === socket.id;
  const listening = state.turnStage === "listening";
  $("sendBtn").disabled = !isMine || submitted || listening;
  $("url").disabled = !isMine || submitted || listening;
  $("sendBtn").textContent = submitted || listening ? t("Трек играет") : isMine ? t("Отправить трек") : t("Ждем ход");
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
  circle.closest(".timer-ring")?.classList.toggle("timer-critical", !waiting && timeLeft <= 5);
  document.body.classList.toggle("music-playing", stage === "listening");
  if (!waiting && timeLeft > 0 && timeLeft <= 5) {
    playMetronomeTick();
  }

  updateMobileTurnBanner();
  renderHostControls();
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
  embed.innerHTML = `<span>${t("Ждем трек от текущего игрока")}</span>`;
  document.body.classList.remove("music-playing");
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
  const incomingTrackId = typeof track === "string" ? state.currentTrackId : (track.id || state.currentTrackId);
  if (incomingTrackId && incomingTrackId === state.currentTrackId && $("trackFrame")) {
    applySiteVolume();
    return;
  }
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
  document.body.classList.add("music-playing");
  if (youtubeId) {
    const origin = encodeURIComponent(window.location.origin);
    embed.innerHTML = `<iframe id="trackFrame" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}" title="YouTube player" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  } else if (soundCloud) {
    embed.innerHTML = `<iframe id="trackFrame" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&visual=true&show_teaser=false" title="SoundCloud player" allow="autoplay"></iframe>`;
    if (window.SC?.Widget) {
      const widget = window.SC.Widget($("trackFrame"));
      widget.bind(window.SC.Widget.Events.READY, () => applySiteVolume());
    }
  } else {
    embed.innerHTML = `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${t("Открыть трек")}</a>`;
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
  state.voteCounts = votes || {};
  const voteCounts = state.voteCounts;
  const candidates = state.voteCandidates.length ? state.voteCandidates : state.players.map((player) => player.id);
  $("voteList").innerHTML = state.players.filter((player) => candidates.includes(player.id)).map((player) => {
    const isMe = player.id === socket.id;
    const countMarkup = state.anonymousVoting ? "<strong>?</strong>" : `<strong>${voteCounts[player.id] || 0}</strong>`;
    return `
      <button class="vote-row ${state.votedTarget === player.id ? "selected" : ""}" ${isMe ? "disabled" : ""} onclick="vote('${player.id}')">
        <span>${escapeHtml(player.name)} ${isMe ? `(${t("ты")})` : ""}</span>
        ${countMarkup}
      </button>
    `;
  }).join("");
}

function resultBestTrack(data) {
  return data?.breakdown?.mostReactedTrack || data?.trackHistory?.[0] || state.trackHistory?.[0] || null;
}

function resultFunnyNomination(data) {
  const suspicious = data?.breakdown?.mostSuspiciousTrack;
  const reacted = data?.breakdown?.mostReactedTrack;
  if (suspicious?.playerName) return `Красная метка вечера: ${suspicious.playerName}`;
  if (reacted?.playerName) return `Разорвал реакции: ${reacted.playerName}`;
  return data?.civiliansWin ? "Детективы танцпола" : "Шпион на бис";
}

function resultSnapshot(data = state.latestResult) {
  const spyNames = data?.spyNames?.length ? data.spyNames.join(", ") : (data?.spyName || "—");
  const winners = data?.civiliansWin ? "Мирные" : "Шпион";
  const bestTrack = resultBestTrack(data);
  return {
    code: state.currentCode || data?.code || "-----",
    winners,
    spies: spyNames,
    theme: data?.theme || "—",
    bestTrack: bestTrack?.playerName ? `${bestTrack.playerName}${bestTrack.reactionCount ? ` · ${bestTrack.reactionCount} реакций` : ""}` : "—",
    nomination: resultFunnyNomination(data)
  };
}

function renderSharePreview(data = state.latestResult) {
  const box = $("resultSharePreview");
  if (!box) return;
  const snap = resultSnapshot(data);
  box.innerHTML = `
    <div class="share-card-mini">
      <span>Music Spy · ${escapeHtml(snap.code)}</span>
      <strong>${escapeHtml(snap.winners)} победили</strong>
      <small>Шпион: ${escapeHtml(snap.spies)} · Тема: «${escapeHtml(translateTheme(snap.theme))}»</small>
      <small>Лучший трек: ${escapeHtml(snap.bestTrack)}</small>
      <em>${escapeHtml(snap.nomination)}</em>
    </div>
  `;
}

function renderFinalComments(comments = state.finalComments) {
  const box = $("finalComments");
  if (!box) return;
  state.finalComments = comments || [];
  box.classList.toggle("empty", !state.finalComments.length);
  box.innerHTML = state.finalComments.length ? state.finalComments.map((comment) => `
    <div class="final-comment"><strong>${escapeHtml(comment.playerName || t("Игрок"))}</strong><span>${escapeHtml(comment.text || "")}</span></div>
  `).join("") : t("Комментариев пока нет");
}

function sendFinalComment() {
  const input = $("finalCommentInput");
  const text = input?.value.trim() || "";
  if (!text) return;
  socket.emit("finalComment:send", { code: state.currentCode, text }, (res) => {
    if (res?.error) return setStatus("gameStatus", res.error, true);
    input.value = "";
    renderFinalComments(res.comments || state.finalComments);
  });
}

function drawShareCard(data = state.latestResult) {
  const canvas = $("shareCanvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const snap = resultSnapshot(data);
  const w = canvas.width;
  const h = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, data?.civiliansWin ? "#141b63" : "#250406");
  gradient.addColorStop(0.55, "#07040f");
  gradient.addColorStop(1, data?.civiliansWin ? "#8b5cf6" : "#e50914");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 36; i += 1) {
    const x = (i * 97) % w;
    const barH = 120 + ((i * 53) % 360);
    ctx.fillRect(x, h - barH - 80, 34, barH);
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(930, 310, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(930, 310, 105, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "900 62px Inter, sans-serif";
  ctx.fillText("MUSIC SPY", 90, 140);
  ctx.font = "800 34px Inter, sans-serif";
  ctx.fillText(`Комната ${snap.code}`, 90, 205);
  ctx.font = "900 86px Inter, sans-serif";
  ctx.fillText(`${snap.winners} победили`, 90, 360);
  const rows = [
    ["Победители", snap.winners],
    ["Шпион", snap.spies],
    ["Тема", `«${translateTheme(snap.theme)}»`],
    ["Лучший трек", snap.bestTrack],
    ["Смешная номинация", snap.nomination]
  ];
  let y = 520;
  for (const [label, value] of rows) {
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "800 30px Inter, sans-serif";
    ctx.fillText(label.toUpperCase(), 90, y);
    ctx.fillStyle = "#fff";
    ctx.font = "800 46px Inter, sans-serif";
    wrapCanvasText(ctx, String(value), 90, y + 58, 970, 56);
    y += label === "Смешная номинация" ? 170 : 155;
  }
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "800 30px Inter, sans-serif";
  ctx.fillText("Открой итог игры на весь экран и сделай скриншот", 90, h - 105);
  return canvas;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

function showResultShotModal() {
  const canvas = drawShareCard();
  const modal = $("resultShotModal");
  const image = $("resultShotImage");
  if (!canvas || !modal || !image) return;
  image.src = canvas.toDataURL("image/png");
  modal.classList.remove("hidden");
  document.body.classList.add("result-shot-open");
}

function hideResultShotModal() {
  const modal = $("resultShotModal");
  modal?.classList.add("hidden");
  document.body.classList.remove("result-shot-open");
}

function showTrackHistoryModal() {
  renderTrackHistory("resultTrackHistory", state.trackHistory);
  const modal = $("trackHistoryModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("result-shot-open");
}

function hideTrackHistoryModal() {
  const modal = $("trackHistoryModal");
  modal?.classList.add("hidden");
  document.body.classList.remove("result-shot-open");
}

function saveResultCard() {
  const canvas = drawShareCard();
  if (!canvas) return;
  const link = document.createElement("a");
  link.download = `music-spy-${state.currentCode || "result"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function shareResultCard() {
  const canvas = drawShareCard();
  if (!canvas) return saveResultCard();
  canvas.toBlob(async (blob) => {
    const file = new File([blob], `music-spy-${state.currentCode || "result"}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title: "Music Spy итог", text: "Финальный отчёт партии Music Spy", files: [file] });
    } else {
      saveResultCard();
    }
  }, "image/png");
}

function renderResults(data) {
  state.latestResult = data;
  state.finalComments = data.finalComments || [];
  renderSharePreview(data);
  renderFinalComments(state.finalComments);
  const suspectedNames = (data.breakdown?.suspectedNames?.length ? data.breakdown.suspectedNames : data.suspected.map((id) => state.players.find((player) => player.id === id)?.name || t("Игрок"))).join(", ");
  const spyNames = data.spyNames?.length ? data.spyNames.join(", ") : data.spyName;
  const guessText = data.spyGuess?.skipped
    ? t("шпион не называл тему")
    : `${escapeHtml(data.spyGuess?.playerName || t("Шпион"))}: «${escapeHtml(translateTheme(data.spyGuess?.text || "—"))}»`;
  $("resultTitle").textContent = data.civiliansWin ? t("Мирные победили") : t("Шпион победил");
  $("resultText").textContent = t(`Шпионы: ${spyNames}. Тема: «${data.theme}». Зачервили: ${suspectedNames || t("никто")}.`);

  renderResultBreakdown(data, guessText);
  renderVoteDetails(data.breakdown?.voteDetails || []);

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

function renderResultBreakdown(data, guessText) {
  const breakdown = data.breakdown || {};
  const mostReacted = breakdown.mostReactedTrack;
  const suspicious = breakdown.mostSuspiciousTrack;
  const topVoted = breakdown.topVoted?.length ? breakdown.topVoted.join(", ") : t("никто");
  const reactionTotals = formatReactions(breakdown.reactionTotals || {});
  const guessResult = data.spyGuess?.correct ? t("угадал тему") : data.caughtSpy ? t("не угадал тему") : t("не потребовалось");

  $("resultBreakdown").innerHTML = `
    <div class="breakdown-card">
      <span>${t("Итог")}</span>
      <strong>${data.civiliansWin ? t("Мирные вычислили шпиона") : data.spyGuess?.correct ? t("Шпион угадал тему") : t("Шпион не попал под подозрение")}</strong>
      <small>${guessText} · ${guessResult}</small>
    </div>
    <div class="breakdown-card">
      <span>${t("Главный подозреваемый")}</span>
      <strong>${escapeHtml(topVoted)}</strong>
      <small>${t(`голосов: ${breakdown.topVoteCount || 0}`)}</small>
    </div>
    <div class="breakdown-card">
      <span>${t("Реакции вечера")}</span>
      <strong>${escapeHtml(reactionTotals)}</strong>
      <small>${mostReacted ? `${escapeHtml(mostReacted.playerName || t("Игрок"))}: ${mostReacted.reactionCount}` : t("без реакций")}</small>
    </div>
    <div class="breakdown-card">
      <span>${t("Самый подозрительный трек")}</span>
      <strong>${suspicious ? escapeHtml(suspicious.playerName || t("Игрок")) : t("не найден")}</strong>
      <small>${suspicious ? t(`подозрительных реакций: ${suspicious.suspicionCount}`) : t("без реакций")}</small>
    </div>
  `;
}

function renderVoteDetails(details = []) {
  const el = $("resultVoteDetails");
  if (!el) return;
  if (!details.length) {
    el.innerHTML = `<div class="vote-row static"><span>${t("Голосов не было")}</span><strong>—</strong></div>`;
    return;
  }

  el.innerHTML = details.map((item) => `
    <div class="vote-row static ${item.hitSpy ? "hit-spy" : ""}">
      <span>${escapeHtml(item.voterName)} → ${escapeHtml(item.targetName)}</span>
      <strong>${item.hitSpy ? "🎯" : "•"}</strong>
    </div>
  `).join("");
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
  state.authResolved = false;
  consumeOAuthRedirectParams();
  authenticateWithStoredToken();
});

socket.on("lobbyUpdate", (lobby) => {
  renderLobby(lobby);
  if (lobby.phase === "lobby" && state.phase !== "menu") {
    closeTransientOverlays();
    clearPlayer();
    showScreen("lobby");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  restoreLanguagePreference();
  restoreSiteVolume();
  renderReactions();
  initChatScrollbarFeedback();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    addButtonRipple(button, event);
    unlockAudio();
    playButtonSound(button);
  });
  const presetCode = normalizeRoomCodeInput(new URL(window.location.href).searchParams.get("room"));
  if (presetCode) {
    state.pendingInviteCode = presetCode;
    $("code").value = presetCode;
    setStatus("menuError", "Подключаем к лобби по ссылке-приглашению...");
    attemptAutoJoinFromInvite();
  }
});

socket.on("gameStarted", (data) => {
  state.role = data.role;
  state.theme = data.theme;
  state.spyIds = data.spyIds || [];
  state.hostId = data.host || state.hostId;
  state.players = data.players;
  state.order = data.order;
  state.totalRounds = data.totalRounds;
  state.settings = data.settings || state.settings;
  state.currentCode = data.code;
  storeReconnectState(state.currentCode);
  state.votedTarget = null;
  state.voteCounts = {};
  state.reactionCounts = {};
  state.selectedReaction = null;
  state.currentTrackId = null;
  state.trackHistory = data.trackHistory || [];
  state.chatMessages = data.chatMessages || [];
  state.finalComments = data.finalComments || [];
  applyRoomTheme(state.settings.roomTheme || "neon");
  state.turnStage = "waiting";
  state.timeLeft = null;
  syncAudioVolume({ fadeTime: 0.32 });
  applyRoleTheme(data.role);

  $("roleTitle").textContent = data.role === "spy" ? t("Ты шпион") : t("Ты мирный");
  $("theme").textContent = data.role === "spy"
    ? t(`Твоя задача — понять тему по чужим трекам и не выдать себя. Шпионов в игре: ${data.spyCount || 1}.`)
    : t(`Тема: «${data.theme}»`);
  $("embed").className = "embed empty";
  $("embed").innerHTML = `<span>${t("Здесь появится YouTube/SoundCloud плеер")}</span>`;

  showScreen("game");
  showRoleReveal(data);
  renderOrder();
  renderHostControls();
  renderReactions();
  renderTrackHistory();
  renderChat();
});

socket.on("gameState", renderGameState);
socket.on("chat:update", ({ messages }) => renderChat(messages || []));
socket.on("finalComments:update", ({ comments }) => renderFinalComments(comments || []));
socket.on("profile:updated", ({ profile }) => {
  applyProfile(profile);
});
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
  state.voteCounts = votes || {};
  clearPlayer();
  showScreen("voting");
  renderVoteList(votes);
  renderTrackHistory("voteTrackHistory", state.trackHistory);
  updateVoteTimer(votingTime > 0 ? votingTime : null);
  $("voteDescription").textContent = voteRound > 1
    ? t("Ничья! Голосуем во втором туре только между кандидатами.")
    : anonymous
      ? t("Анонимное голосование: счет голосов откроется только в конце.")
      : t("Выбери игрока, который хуже всех попадал в тему. Менять голос можно до конца голосования.");
  setStatus("voteStatus", voteRound > 1 ? "Второй тур начался" : "Голосование началось");
});

socket.on("voteUpdate", ({ votes, votedCount, total, anonymous }) => {
  state.anonymousVoting = Boolean(anonymous);
  state.voteCounts = votes || {};
  renderVoteList(votes);
  setStatus("voteStatus", `Проголосовало ${votedCount}/${total}`);
});

socket.on("spyGuessStarted", ({ spies, guesserId, guesserRole, accusedNames, prefillTheme, guessOptions, votes, trackHistory, timeLeft }) => {
  playSoundCue("danger");
  state.spyGuessActive = true;
  state.pendingSpyGuess = null;
  state.voteCounts = votes || state.voteCounts;
  state.trackHistory = trackHistory || state.trackHistory;
  const isGuesser = guesserId === socket.id || spies?.includes(socket.id);
  const isDecoy = guesserRole === "decoy";
  const accused = accusedNames?.length ? accusedNames.join(", ") : t("подозреваемый игрок");
  showScreen("spyGuess");
  $("spyGuessForm").classList.toggle("hidden", !isGuesser);
  $("spyGuessText").textContent = isGuesser
    ? (isDecoy
      ? t("Игроки решили, что ты шпион. Тема выбрана автоматически, менять ее нельзя.")
      : t("Тебя подозревают. Выбери настоящую тему из четырех близких вариантов."))
    : t(`Голоса сошлись на игроке: ${accused}. Ждем финальный выбор темы.`);
  $("spyGuessInput").value = "";
  $("spyGuessInput").disabled = isDecoy;
  renderSpyGuessOptions(isGuesser && !isDecoy ? (guessOptions || []) : []);
  const submitBtn = $("spyGuessSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled = isDecoy;
    submitBtn.textContent = isDecoy ? t("Тема выбрана автоматически") : t("Выбрать тему");
  }
  const waitingText = isDecoy ? t("Тема выбрана автоматически") : t("Ждем выбор подозреваемого");
  setStatus("spyGuessStatus", isGuesser && !isDecoy ? `Последний шанс: выбери тему (${timeLeft || 60}с)` : `${waitingText} (${timeLeft || 60}с)`);
  renderTrackHistory("spyGuessTrackHistory", state.trackHistory);
});

socket.on("decoyGuessAutoSubmitted", ({ guess }) => {
  state.pendingSpyGuess = guess || null;
  setStatus("spyGuessStatus", "Тема выбрана автоматически. Готовим финальное раскрытие...");
});

socket.on("spyGuessTimer", ({ timeLeft }) => {
  if (state.phase !== "spyGuess") return;
  const input = $("spyGuessInput");
  const isEditableGuesser = !$("spyGuessForm")?.classList.contains("hidden") && !input?.disabled;
  setStatus("spyGuessStatus", isEditableGuesser ? `Последний шанс: выбери тему (${timeLeft}с)` : `Ждем финальный выбор (${timeLeft}с)`);
});

socket.on("runoffStarted", () => {
  setStatus("voteStatus", "Ничья — запускаем второй тур");
});

socket.on("gameEnd", (data) => {
  state.spyGuessActive = false;
  state.pendingSpyGuess = null;
  closeSpyReviewModal();
  clearPlayer();
  updateVoteTimer(null);
  showSpyRevealCountdown(data, () => {
    showScreen("results");
    renderResults(data);
  });
});

socket.on("stopTrack", () => {
  clearPlayer();
});

socket.on("spyGuessPending", ({ guess }) => {
  state.pendingSpyGuess = guess || null;
  setStatus("spyGuessStatus", guess ? `Выбрана тема: «${guess.text}»` : "Ждем финальный выбор");
});

socket.on("spyGuessSubmitted", ({ guess, decoy }) => {
  state.pendingSpyGuess = guess || null;
  if (decoy || guess?.decoy) {
    setStatus("spyGuessStatus", "Тема выбрана автоматически. Готовим финальное раскрытие...");
    playSoundCue("confirm");
    return;
  }
  const text = $("spyReviewText");
  if (text) text.textContent = `${guess?.playerName || "Шпион"}: «${guess?.text || "—"}»`;
  setStatus("spyReviewStatus");
  const modal = $("spyReviewModal");
  if (modal) modal.classList.remove("hidden");
  playSoundCue("danger");
});

socket.on("hostAction", ({ message }) => {
  if (message) setStatus("gameStatus", message);
});

socket.on("kicked", ({ reason }) => {
  resetRoomState();
  clearPlayer();
  hideCinematicOverlay({ runOnClose: false });
  showScreen("menu");
  setStatus("menuError", reason || "Тебя удалили из комнаты", true);
});

socket.on("gameCancelled", ({ reason }) => {
  clearPlayer();
  closeTransientOverlays();
  showScreen("lobby");
  setStatus("lobbyStatus", reason, true);
});
