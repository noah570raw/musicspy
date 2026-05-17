/* Shared client constants loaded before client.js. */
const DEFAULT_LISTEN_TIME = 30;
const ALLOWED_REACTIONS = ["🔥", "❤️", "😂", "😮", "🕵️", "🤔"];
const DEFAULT_SITE_VOLUME = 100;
const BACKGROUND_MUSIC_VOLUME = 0.3;
const AUTH_TOKEN_KEY = "musicspy_auth_token";
const RECONNECT_STATE_KEY = "musicspy_reconnect_state";
const RECONNECT_TOKEN_KEY = "musicspy_reconnect_token";
const AVATAR_MAX_BYTES = 64 * 1024;
const GAME_MODE_PRESETS = {
  classic: {
    label: "Классика",
    hint: "сбалансированные правила для обычной партии",
    rounds: 3,
    listenTime: 30,
    spyMode: "auto",
    anonymousVoting: false,
    votingTime: 60,
    runoffOnTie: true,
    roomTheme: "neon",
    maxPlayers: 9
  },
  blitz: {
    label: "Блиц",
    hint: "анонимное голосование, автошпионы, 1 раунд, 15 секунд и без второго тура",
    rounds: 1,
    listenTime: 15,
    spyMode: "auto",
    anonymousVoting: true,
    votingTime: 30,
    runoffOnTie: false,
    roomTheme: "cyber",
    maxPlayers: 9
  }
};
