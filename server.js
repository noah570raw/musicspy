const express = require("express");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { registerSocialAssetRoutes } = require("./lib/social-assets");
const {
  EMPTY_USERS_STORE,
  friendshipKey,
  getOrCreateUser,
  getUser,
  initializeDatabase,
  loadUserStore,
  pool,
  resolveDataDir,
  saveUserStore,
  updateUser
} = require("./lib/persistence");
const {
  buildOAuthErrorRedirect,
  buildOAuthSuccessRedirect,
  buildOAuthTokenRequest,
  createSession: createAuthSession,
  findUserByToken: findUserBySessionToken,
  hashPassword,
  normalizeAvatar,
  normalizeOAuthProfile,
  normalizeUsername,
  parseOAuthResponse,
  refreshSession: refreshAuthSession,
  revokeRefreshToken,
  revokeSessionToken,
  validatePassword,
  verifyPassword
} = require("./lib/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", 1);
registerSocialAssetRoutes(app);

const sessionMiddleware = session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "fallback-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static("public"));
const SPY_GUESS_SECONDS = 60;
const DECOY_GUESS_SECONDS = 3;
const HOST_TIMER_STEP_SECONDS = 15;
const HOST_MIN_TIMER_SECONDS = 5;
const HOST_MAX_TIMER_SECONDS = 300;
const MAX_CHAT_MESSAGES = 60;
const MAX_GLOBAL_CHAT_MESSAGES = 80;
const MAX_CHAT_MESSAGE_LENGTH = 240;
const MAX_FINAL_COMMENTS = 24;
const MAX_FINAL_COMMENT_LENGTH = 90;
const MAX_DIRECT_MESSAGES = 5000;
const MAX_DIRECT_MESSAGE_LENGTH = 600;
const MAX_LOBBY_NAME_LENGTH = 32;
const MIN_LOBBY_PLAYERS = 3;
const DEFAULT_MAX_PLAYERS = 9;
const ALLOWED_MAX_PLAYERS = [3, 4, 5, 6, 7, 8, 9];
const RECONNECT_GRACE_MS = 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEV_USERNAMES = new Set(["noah570raw"]);
const DEV_ROLE = "dev";
const DEV_VINYL_BALANCE = 999_999_999;
const DAILY_REWARD_STREAK_AMOUNTS = [300, 350, 400, 450, 500, 650, 700];
const DAILY_REWARD_AMOUNT = DAILY_REWARD_STREAK_AMOUNTS[0];
const DAILY_REWARD_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAILY_REWARD_STREAK_RESET_MS = DAILY_REWARD_INTERVAL_MS * 2;
const XP_BOOSTER_DURATION_MS = 60 * 60 * 1000;
const XP_BOOSTER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const XP_BOOSTER_MULTIPLIER = 2;
const MATCH_XP_REWARDS = Object.freeze({
  WIN: 100,
  LOSS: 50,
  CORRECT_SPY_VOTE: 25
});


const lobbies = {};
let globalChatMessages = [];
const timers = {};
const oauthStates = new Map();
const userSockets = new Map();

const ALLOWED_REACTIONS = ["🔥", "❤️", "😂", "😮", "🕵️", "🤔"];

const COSMETIC_RARITIES = {
  common: { label: "Common", glow: 1 },
  rare: { label: "Rare", glow: 2 },
  epic: { label: "Epic", glow: 3 },
  legendary: { label: "Legendary", glow: 4 },
  mythic: { label: "Mythic", glow: 5 },
  developer: { label: "Developer", glow: 6 }
};

const SHOP_CATEGORIES = [
  { id: "nicknameColor", label: "Nickname Colors", equipSlot: "nicknameColor" },
  { id: "avatarFrame", label: "Avatar Frames", equipSlot: "avatarFrame" },
  { id: "profileBanner", label: "Profile Banners", equipSlot: "profileBanner" },
  { id: "chatEffect", label: "Chat Effects", equipSlot: "chatEffect" },
  { id: "lobbyEffect", label: "Lobby Effects", equipSlot: "lobbyEffect" }
];

const SHOP_CATALOG = [
  { id: "nick_solar_flare", category: "nicknameColor", name: "Solar Flare", rarity: "common", price: 650, preview: "linear-gradient(90deg,#fde047,#fb7185,#f97316)" },
  { id: "nick_glacier_hype", category: "nicknameColor", name: "Glacier Hype", rarity: "rare", price: 980, preview: "linear-gradient(90deg,#67e8f9,#60a5fa,#818cf8)" },
  { id: "nick_synthwave_blaze", category: "nicknameColor", name: "Synthwave Blaze", rarity: "rare", price: 1080, preview: "linear-gradient(90deg,#fb7185,#a855f7,#22d3ee)" },
  { id: "nick_blacklight_pulse", category: "nicknameColor", name: "Blacklight Pulse", rarity: "epic", price: 1550, preview: "linear-gradient(90deg,#020617,#7c3aed,#22d3ee)" },
  { id: "nick_vinyl_prism", category: "nicknameColor", name: "Vinyl Prism", rarity: "epic", price: 1680, preview: "linear-gradient(90deg,#f59e0b,#f43f5e,#8b5cf6,#06b6d4)" },
  { id: "nick_chrome_wave", category: "nicknameColor", name: "Chrome Wave", rarity: "legendary", price: 2400, preview: "linear-gradient(90deg,#f8fafc,#94a3b8,#e2e8f0)" },
  { id: "nick_quantum_pop", category: "nicknameColor", name: "Quantum Pop", rarity: "legendary", price: 2550, preview: "linear-gradient(90deg,#22d3ee,#ec4899,#fde047)" },
  { id: "nick_hyperion_aura", category: "nicknameColor", name: "Hyperion Aura", rarity: "mythic", price: 3400, preview: "linear-gradient(90deg,#38bdf8,#a78bfa,#f472b6,#fde68a)" },

  { id: "frame_neon_hex", category: "avatarFrame", name: "Neon Hex", rarity: "common", price: 700, preview: "repeating-linear-gradient(135deg,#22d3ee 0 8px,#0f172a 8px 16px)" },
  { id: "frame_crystal_ring", category: "avatarFrame", name: "Crystal Ring", rarity: "rare", price: 1100, preview: "radial-gradient(circle,#ecfeff,#67e8f9,#1e293b)" },
  { id: "frame_orbit_shards", category: "avatarFrame", name: "Orbit Shards", rarity: "rare", price: 1220, preview: "conic-gradient(#38bdf8,#a855f7,#f472b6,#38bdf8)" },
  { id: "frame_reactor_core", category: "avatarFrame", name: "Reactor Core", rarity: "epic", price: 1720, preview: "radial-gradient(circle,#facc15,#f97316,#7c2d12)" },
  { id: "frame_aurora_circuit", category: "avatarFrame", name: "Aurora Circuit", rarity: "epic", price: 1880, preview: "linear-gradient(135deg,#14b8a6,#06b6d4,#8b5cf6)" },
  { id: "frame_velvet_void", category: "avatarFrame", name: "Velvet Void", rarity: "legendary", price: 2550, preview: "linear-gradient(135deg,#020617,#312e81,#0f172a)" },
  { id: "frame_solaris_crown", category: "avatarFrame", name: "Solaris Crown", rarity: "legendary", price: 2780, preview: "conic-gradient(#fde68a,#f59e0b,#fb7185,#fde68a)" },
  { id: "frame_infinity_halo", category: "avatarFrame", name: "Infinity Halo", rarity: "mythic", price: 3600, preview: "conic-gradient(#22d3ee,#8b5cf6,#ec4899,#22d3ee)" },

  { id: "banner_city_afterglow", category: "profileBanner", name: "City Afterglow", rarity: "common", price: 760, preview: "linear-gradient(135deg,#111827,#334155,#f97316)" },
  { id: "banner_cosmic_studio", category: "profileBanner", name: "Cosmic Studio", rarity: "rare", price: 1240, preview: "linear-gradient(135deg,#0f172a,#7c3aed,#22d3ee)" },
  { id: "banner_aurora_drift", category: "profileBanner", name: "Aurora Drift", rarity: "rare", price: 1360, preview: "linear-gradient(135deg,#14b8a6,#8b5cf6,#f0abfc)" },
  { id: "banner_luxe_signal", category: "profileBanner", name: "Luxe Signal", rarity: "epic", price: 1880, preview: "linear-gradient(135deg,#f59e0b,#ec4899,#7c3aed)" },
  { id: "banner_quantum_lounge", category: "profileBanner", name: "Quantum Lounge", rarity: "epic", price: 1990, preview: "radial-gradient(circle at 15% 20%,#67e8f9,transparent 34%),linear-gradient(135deg,#111827,#1d4ed8)" },
  { id: "banner_ultraviolet_core", category: "profileBanner", name: "Ultraviolet Core", rarity: "legendary", price: 2640, preview: "linear-gradient(135deg,#020617,#7c3aed,#f43f5e)" },
  { id: "banner_golden_stage", category: "profileBanner", name: "Golden Stage", rarity: "legendary", price: 2780, preview: "linear-gradient(135deg,#fef3c7,#f59e0b,#b45309)" },
  { id: "banner_hologram_royale", category: "profileBanner", name: "Hologram Royale", rarity: "mythic", price: 3700, preview: "linear-gradient(135deg,#22d3ee,#a78bfa,#f472b6,#fde68a)" },

  { id: "chat_neon_mist", category: "chatEffect", name: "Neon Mist", rarity: "common", price: 820, preview: "linear-gradient(90deg,#22d3ee,#6366f1)" },
  { id: "chat_emoji_rain", category: "chatEffect", name: "Emoji Rain", rarity: "rare", price: 1180, preview: "linear-gradient(90deg,#f59e0b,#f43f5e,#8b5cf6)" },
  { id: "chat_pixel_pop", category: "chatEffect", name: "Pixel Pop", rarity: "rare", price: 1260, preview: "repeating-linear-gradient(90deg,#22d3ee 0 10px,#0ea5e9 10px 20px,#a855f7 20px 30px)" },
  { id: "chat_waveform_glow", category: "chatEffect", name: "Waveform Glow", rarity: "epic", price: 1760, preview: "linear-gradient(90deg,#22c55e,#06b6d4,#8b5cf6)" },
  { id: "chat_starlight_box", category: "chatEffect", name: "Starlight Box", rarity: "epic", price: 1890, preview: "radial-gradient(circle,#f8fafc,#6366f1,#020617)" },
  { id: "chat_laser_tape", category: "chatEffect", name: "Laser Tape", rarity: "legendary", price: 2480, preview: "linear-gradient(90deg,#f43f5e,#22d3ee,#f43f5e)" },
  { id: "chat_midnight_frost", category: "chatEffect", name: "Midnight Frost", rarity: "legendary", price: 2620, preview: "linear-gradient(90deg,#1e293b,#0ea5e9,#e2e8f0)" },
  { id: "chat_hypernova", category: "chatEffect", name: "Hypernova", rarity: "mythic", price: 3500, preview: "conic-gradient(#22d3ee,#ec4899,#fde047,#22d3ee)" },

  { id: "lobby_glass_flux", category: "lobbyEffect", name: "Glass Flux", rarity: "common", price: 980, preview: "linear-gradient(135deg,#38bdf8,#0f172a)" },
  { id: "lobby_plasma_mesh", category: "lobbyEffect", name: "Plasma Mesh", rarity: "rare", price: 1320, preview: "linear-gradient(135deg,#06b6d4,#8b5cf6,#111827)" },
  { id: "lobby_night_radar", category: "lobbyEffect", name: "Night Radar", rarity: "rare", price: 1450, preview: "radial-gradient(circle,#22d3ee,transparent 65%),#020617" },
  { id: "lobby_firefly_lane", category: "lobbyEffect", name: "Firefly Lane", rarity: "epic", price: 1980, preview: "linear-gradient(135deg,#f59e0b,#f43f5e,#1d4ed8)" },
  { id: "lobby_quantum_glow", category: "lobbyEffect", name: "Quantum Glow", rarity: "epic", price: 2140, preview: "conic-gradient(#22d3ee,#6366f1,#22d3ee)" },
  { id: "lobby_royal_chamber", category: "lobbyEffect", name: "Royal Chamber", rarity: "legendary", price: 2800, preview: "linear-gradient(135deg,#7c3aed,#111827,#ec4899)" },
  { id: "lobby_sunrise_core", category: "lobbyEffect", name: "Sunrise Core", rarity: "legendary", price: 2980, preview: "linear-gradient(135deg,#fde68a,#fb7185,#7c3aed)" },
  { id: "lobby_horizon_mirage", category: "lobbyEffect", name: "Horizon Mirage", rarity: "mythic", price: 3900, preview: "linear-gradient(135deg,#22d3ee,#a78bfa,#f472b6,#fde68a)" },

  { id: "dev_nick_emerald_sovereign", category: "nicknameColor", name: "DEV Emerald Sovereign", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(90deg,#34d399,#10b981,#6ee7b7,#34d399)" },
  { id: "dev_nick_jade_flux", category: "nicknameColor", name: "DEV Jade Flux", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(90deg,#22c55e,#86efac,#15803d)" },
  { id: "dev_nick_mint_quantum", category: "nicknameColor", name: "DEV Mint Quantum", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(90deg,#99f6e4,#14b8a6,#34d399)" },
  { id: "dev_nick_viridian_crown", category: "nicknameColor", name: "DEV Viridian Crown", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(90deg,#16a34a,#22c55e,#4ade80)" },

  { id: "dev_frame_emerald_matrix", category: "avatarFrame", name: "DEV Emerald Matrix", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "conic-gradient(#34d399,#10b981,#6ee7b7,#34d399)" },
  { id: "dev_frame_jade_reactor", category: "avatarFrame", name: "DEV Jade Reactor", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "radial-gradient(circle,#bbf7d0,#22c55e,#14532d)" },
  { id: "dev_frame_mint_halo", category: "avatarFrame", name: "DEV Mint Halo", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#99f6e4,#34d399,#065f46)" },
  { id: "dev_frame_viridian_pulse", category: "avatarFrame", name: "DEV Viridian Pulse", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "conic-gradient(#22c55e,#15803d,#4ade80,#22c55e)" },

  { id: "dev_banner_emerald_throne", category: "profileBanner", name: "DEV Emerald Throne", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#052e16,#10b981,#34d399)" },
  { id: "dev_banner_jade_nebula", category: "profileBanner", name: "DEV Jade Nebula", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#14532d,#22c55e,#6ee7b7)" },
  { id: "dev_banner_mint_core", category: "profileBanner", name: "DEV Mint Core", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "radial-gradient(circle,#99f6e4,#34d399,#064e3b)" },
  { id: "dev_banner_viridian_infinite", category: "profileBanner", name: "DEV Viridian Infinite", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#16a34a,#15803d,#34d399,#86efac)" },

  { id: "dev_chat_emerald_mist", category: "chatEffect", name: "DEV Emerald Mist", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(90deg,#34d399,#10b981,#064e3b)" },
  { id: "dev_chat_jade_symbols", category: "chatEffect", name: "DEV Jade Symbols", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "repeating-linear-gradient(90deg,#22c55e 0 10px,#15803d 10px 20px,#4ade80 20px 30px)" },
  { id: "dev_chat_mint_echo", category: "chatEffect", name: "DEV Mint Echo", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "radial-gradient(circle,#bbf7d0,#34d399,#065f46)" },
  { id: "dev_chat_viridian_lux", category: "chatEffect", name: "DEV Viridian Lux", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "conic-gradient(#22c55e,#86efac,#10b981,#22c55e)" },

  { id: "dev_lobby_emerald_grid", category: "lobbyEffect", name: "DEV Emerald Grid", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#052e16,#10b981,#6ee7b7)" },
  { id: "dev_lobby_jade_hall", category: "lobbyEffect", name: "DEV Jade Hall", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "linear-gradient(135deg,#14532d,#22c55e,#bbf7d0)" },
  { id: "dev_lobby_mint_realm", category: "lobbyEffect", name: "DEV Mint Realm", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "radial-gradient(circle,#99f6e4,#34d399,#064e3b)" },
  { id: "dev_lobby_viridian_prestige", category: "lobbyEffect", name: "DEV Viridian Prestige", rarity: "developer", price: 5000, devOnly: true, limited: true, preview: "conic-gradient(#16a34a,#22c55e,#86efac,#16a34a)" },
  { id: "title_perfect_manipulator", category: "playerTitle", name: "Perfect Manipulator", rarity: "mythic", price: 0, achievementOnly: true, hidden: true, preview: "linear-gradient(90deg,#facc15,#ef4444,#020617)" },
];

const ACHIEVEMENTS = [
  { id: "wins_100", label: "100 wins", target: 100, stat: "wins", vinyls: 1000, unlock: "banner_hologram_royale" },
  { id: "perfect_spy_10", label: "10 perfect spy games", target: 10, stat: "perfectSpyGames", vinyls: 1500, unlock: "dev_banner_emerald_throne" },
  { id: "correct_accusations_50", label: "50 correct accusations", target: 50, stat: "correctAccusations", vinyls: 900, unlock: "chat_waveform_glow" },
  { id: "friend_matches_25", label: "25 friend matches", target: 25, stat: "friendMatches", vinyls: 750, unlock: "lobby_quantum_glow" },
  { id: "vinyls_1000", label: "1000 Vinyls earned", target: 1000, stat: "vinylsEarned", vinyls: 300, unlock: "nick_solar_flare" }
];


const THEMES = [
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
  "худший трек в истории мира"
];

const SIMILAR_THEME_GROUPS = [
  ["ру андер ск", "англ андер ск", "ру реп новая школа", "дрилл", "трепахолик"],
  ["бразил фонк тайп", "мемфис фонк тайп", "дрилл", "трепахолик", "едм электронщина"],
  ["ру хайперпоп", "англ хайперпоп", "дрейн", "тикток музло", "едм электронщина"],
  ["классика рока 90-х", "олдскул хип хоп", "ностальгия", "легендарные треки", "хиты 2021"],
  ["ремиксы", "едм электронщина", "тикток музло", "мемы/музыка из мемов", "хит прошлого лета"],
  ["кринж", "мемы/музыка из мемов", "дотерский трек", "худший трек в истории мира", "тикток музло"],
  ["хит прошлого лета", "хиты 2021", "тикток музло", "легендарные треки", "ностальгия"],
  ["чилловый приятный тречок", "ностальгия", "дрейн", "англ хайперпоп", "легендарные треки"],
  ["молодой исполнитель >18", "умерший исполнитель", "легендарные треки", "ру реп новая школа", "олдскул хип хоп"]
];


let usersStore = {
  users: [...EMPTY_USERS_STORE.users],
  friendships: [...EMPTY_USERS_STORE.friendships],
  friendRequests: [...EMPTY_USERS_STORE.friendRequests],
  directMessages: [...EMPTY_USERS_STORE.directMessages]
};

async function initializePersistentState() {
  await initializeDatabase();
  usersStore = await loadUserStore();
  ensureSocialCollections();
  if ((usersStore.users || []).some((user) => applyRoleEntitlements(user))) await saveUsersStore();
}

let userStoreSaveChain = Promise.resolve();

function saveUsersStore() {
  userStoreSaveChain = userStoreSaveChain
    .catch(() => {})
    .then(() => saveUserStore(usersStore));
  userStoreSaveChain.catch((error) => console.error("[db] failed to save users store", error));
  return userStoreSaveChain;
}

function createSession(user) {
  const session = createAuthSession(user, { save: saveUsersStore });
  console.info(`[auth] created persistent session for user=${user.id} accessExpiresAt=${session.accessExpiresAt} refreshExpiresAt=${session.refreshExpiresAt}`);
  return session;
}

function refreshSession(refreshToken) {
  const refreshed = refreshAuthSession(usersStore.users, refreshToken, { save: saveUsersStore });
  if (refreshed) console.info(`[auth] refreshed session for user=${refreshed.user.id} accessExpiresAt=${refreshed.tokens.accessExpiresAt}`);
  else console.warn("[auth] refresh failed: token missing, expired, or revoked");
  return refreshed;
}

function findUserByToken(token) {
  return findUserBySessionToken(usersStore.users, token);
}

async function refreshUserFromDatabase(user) {
  if (!user?.id) return user || null;
  const freshUser = await getUser(user.id);
  if (!freshUser) return user;
  const existingIndex = usersStore.users.findIndex((item) => item.id === freshUser.id);
  const existingUser = existingIndex === -1 ? user : usersStore.users[existingIndex];
  const mergedUser = { ...freshUser, sessions: existingUser.sessions || freshUser.sessions || [] };
  ensureUserProgress(mergedUser);
  if (existingIndex === -1) usersStore.users.push(mergedUser);
  else usersStore.users[existingIndex] = mergedUser;
  return mergedUser;
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
    bestWinStreak: 0,
    correctAccusations: 0,
    friendMatches: 0,
    perfectSpyGames: 0,
    mvpAwards: 0,
    vinylsEarned: 0
  };
}

function defaultEconomy() {
  return {
    vinyls: 0,
    level: 1,
    xp: 0,
    ownedCosmetics: [],
    equipped: {},
    achievements: {},
    transactions: [],
    lastDailyRewardAt: null,
    dailyRewardStreak: 0,
    xpBoosterActiveUntil: null,
    xpBoosterCooldownUntil: null
  };
}

function isDevShopItem(item = {}) {
  const itemId = String(item?.id || "").toLowerCase();
  return item.devOnly === true || itemId.startsWith("dev_");
}

function catalogItemById(itemId) {
  return SHOP_CATALOG.find((item) => item.id === itemId) || null;
}

function isDeveloperUser(user) {
  return Boolean(user && DEV_USERNAMES.has(String(user.username || "").trim().toLowerCase()));
}

function normalizeRoles(user) {
  const roles = new Set(Array.isArray(user?.roles) ? user.roles.map((role) => String(role).toLowerCase()) : []);
  if (isDeveloperUser(user)) roles.add(DEV_ROLE);
  return Array.from(roles);
}

function hasRole(user, role) {
  return normalizeRoles(user).includes(String(role || "").toLowerCase());
}

function applyRoleEntitlements(user) {
  if (!user) return false;
  user.roles = normalizeRoles(user);
  if (!hasRole(user, DEV_ROLE)) return false;
  const economy = normalizeEconomy(user.economy || {});
  const allCosmetics = SHOP_CATALOG.map((item) => item.id);
  const owned = new Set([...(economy.ownedCosmetics || []), ...allCosmetics]);
  economy.ownedCosmetics = Array.from(owned);
  economy.vinyls = Math.max(Number(economy.vinyls || 0), DEV_VINYL_BALANCE);
  user.economy = economy;
  return true;
}

function clearSocketPassportSession(socket) {
  socket.request.logout?.(() => {});
  const socketSession = socket.request.session;
  if (!socketSession) return Promise.resolve();
  socketSession.passport = null;
  socketSession.user = null;
  socketSession.oauthReturnTo = null;
  if (typeof socketSession.save !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    socketSession.save((error) => {
      if (error) console.error("[auth] failed to clear passport session", error);
      resolve();
    });
  });
}

function publicRoles(user) {
  return normalizeRoles(user);
}

function normalizeEconomy(economy = {}) {
  const owned = new Set(Array.isArray(economy.ownedCosmetics) ? economy.ownedCosmetics.map(String) : []);
  for (const item of SHOP_CATALOG.filter((entry) => entry.price === 0 && entry.achievementOnly !== true)) owned.add(item.id);
  const safeEquipped = {};
  if (economy.equipped && typeof economy.equipped === "object") {
    for (const category of SHOP_CATEGORIES) {
      const itemId = String(economy.equipped[category.equipSlot] || "");
      const item = catalogItemById(itemId);
      if (item && owned.has(itemId) && item.category === category.id) safeEquipped[category.equipSlot] = itemId;
    }
  }
  return {
    vinyls: Math.max(0, Math.floor(Number(economy.vinyls || 0))),
    level: Math.max(1, Math.floor(Number(economy.level || 1))),
    xp: Math.max(0, Math.floor(Number(economy.xp || 0))),
    ownedCosmetics: Array.from(owned),
    equipped: safeEquipped,
    achievements: economy.achievements && typeof economy.achievements === "object" ? economy.achievements : {},
    transactions: Array.isArray(economy.transactions) ? economy.transactions.slice(-80) : [],
    lastDailyRewardAt: economy.lastDailyRewardAt && !Number.isNaN(Date.parse(economy.lastDailyRewardAt)) ? economy.lastDailyRewardAt : null,
    dailyRewardStreak: Math.max(0, Math.min(DAILY_REWARD_STREAK_AMOUNTS.length, Math.floor(Number(economy.dailyRewardStreak || 0)))),
    xpBoosterActiveUntil: economy.xpBoosterActiveUntil && !Number.isNaN(Date.parse(economy.xpBoosterActiveUntil)) ? economy.xpBoosterActiveUntil : null,
    xpBoosterCooldownUntil: economy.xpBoosterCooldownUntil && !Number.isNaN(Date.parse(economy.xpBoosterCooldownUntil)) ? economy.xpBoosterCooldownUntil : null
  };
}

function ensureUserProgress(user) {
  if (!user) return null;
  user.stats = { ...defaultStats(), ...(user.stats || {}) };
  user.economy = normalizeEconomy(user.economy || {});
  applyRoleEntitlements(user);
  return user.economy;
}

function publicEconomy(user) {
  const economy = normalizeEconomy(user?.economy || {});
  return {
    vinyls: economy.vinyls,
    level: economy.level,
    xp: economy.xp,
    ownedCosmetics: economy.ownedCosmetics,
    equipped: economy.equipped,
    achievements: economy.achievements,
    lastDailyRewardAt: economy.lastDailyRewardAt || null,
    dailyRewardStreak: economy.dailyRewardStreak || 0,
    xpBooster: xpBoosterState(user)
  };
}

function xpBoosterState(user, now = Date.now()) {
  const economy = ensureUserProgress(user);
  const activeUntilTime = economy?.xpBoosterActiveUntil ? Date.parse(economy.xpBoosterActiveUntil) : 0;
  const cooldownUntilTime = economy?.xpBoosterCooldownUntil ? Date.parse(economy.xpBoosterCooldownUntil) : 0;
  const isActive = activeUntilTime > now;
  const isCoolingDown = cooldownUntilTime > now;
  return {
    canActivate: Boolean(economy && !isCoolingDown),
    active: isActive,
    multiplier: isActive ? XP_BOOSTER_MULTIPLIER : 1,
    displayMultiplier: XP_BOOSTER_MULTIPLIER,
    durationMs: XP_BOOSTER_DURATION_MS,
    cooldownMs: XP_BOOSTER_COOLDOWN_MS,
    activeUntil: isActive ? new Date(activeUntilTime).toISOString() : null,
    cooldownUntil: isCoolingDown ? new Date(cooldownUntilTime).toISOString() : null,
    remainingActiveMs: isActive ? activeUntilTime - now : 0,
    remainingCooldownMs: isCoolingDown ? cooldownUntilTime - now : 0
  };
}

function dailyRewardState(user, now = Date.now()) {
  const economy = ensureUserProgress(user);
  const lastClaimAt = economy?.lastDailyRewardAt || null;
  const lastClaimTime = lastClaimAt ? Date.parse(lastClaimAt) : 0;
  const nextClaimTime = lastClaimTime ? lastClaimTime + DAILY_REWARD_INTERVAL_MS : now;
  const canClaim = !lastClaimTime || now >= nextClaimTime;
  const streakBroken = Boolean(lastClaimTime && now - lastClaimTime > DAILY_REWARD_STREAK_RESET_MS);
  const currentStreak = streakBroken ? 0 : Math.max(0, Math.min(DAILY_REWARD_STREAK_AMOUNTS.length, Number(economy?.dailyRewardStreak || 0)));
  const nextRewardDay = canClaim ? ((currentStreak % DAILY_REWARD_STREAK_AMOUNTS.length) + 1) : Math.max(1, currentStreak || 1);
  const claimedDays = canClaim ? (nextRewardDay === 1 ? 0 : currentStreak) : nextRewardDay;
  return {
    canClaim,
    rewardAmount: DAILY_REWARD_STREAK_AMOUNTS[nextRewardDay - 1] || DAILY_REWARD_AMOUNT,
    rewardSchedule: DAILY_REWARD_STREAK_AMOUNTS,
    cycleDay: nextRewardDay,
    claimedDays,
    streak: currentStreak,
    lastClaimAt,
    nextClaimAt: new Date(canClaim ? now : nextClaimTime).toISOString(),
    remainingMs: canClaim ? 0 : nextClaimTime - now
  };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || "",
    providerName: user.providerName || "",
    hasCustomAvatar: Boolean(user.hasCustomAvatar),
    authProviders: Array.from(new Set((user.oauth || []).map((identity) => identity.provider).filter(Boolean))),
    createdAt: user.createdAt,
    stats: { ...defaultStats(), ...(user.stats || {}) },
    economy: publicEconomy(user),
    roles: publicRoles(user),
    permissions: { dev: hasRole(user, DEV_ROLE) },
    settings: { ...(user.settings || {}) }
  };
}


function ensureSocialCollections() {
  if (!Array.isArray(usersStore.friendships)) usersStore.friendships = [];
  if (!Array.isArray(usersStore.friendRequests)) usersStore.friendRequests = [];
  if (!Array.isArray(usersStore.directMessages)) usersStore.directMessages = [];
  for (const user of usersStore.users) {
    user.friends = friendIdsForUser(user.id);
    ensureUserProgress(user);
    if (!user.settings) user.settings = {};
  }
}

function findUserById(userId) {
  return usersStore.users.find((user) => user.id === userId) || null;
}

function findUserByNicknameOrUsername(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalizedUsername = normalizeUsername(raw);
  const normalizedName = raw.toLowerCase();
  return usersStore.users.find((user) => user.username === normalizedUsername)
    || usersStore.users.find((user) => String(user.displayName || "").trim().toLowerCase() === normalizedName)
    || null;
}

function grantShopItemToUser(user, item) {
  if (!user.economy.ownedCosmetics.includes(item.id)) user.economy.ownedCosmetics.push(item.id);
  const category = SHOP_CATEGORIES.find((entry) => entry.id === item.category);
  if (category?.equipSlot) user.economy.equipped[category.equipSlot] = item.id;
}

function parseDevCommandInput(raw) {
  const input = String(raw || "").trim();
  if (!input) return { error: "Команда пустая. Напиши -help для списка." };
  if (input === "-help" || input.toLowerCase() === "help") return { type: "help" };
  let match = input.match(/^-level\s+up\s+@?([a-z0-9_-]{3,24})\s+to\s+(\d{1,4})$/i);
  if (match) return { type: "setLevel", username: match[1], level: Number(match[2]) };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+nickname\s+color\s+"([^"]+)"$/i);
  if (match) return { type: "giveNicknameColor", username: match[1], colorName: match[2] };
  match = input.match(/^-vinyls\s+add\s+@?([a-z0-9_-]{3,24})\s+(\d{1,9})$/i);
  if (match) return { type: "addVinyls", username: match[1], amount: Number(match[2]) };
  match = input.match(/^-xp\s+set\s+@?([a-z0-9_-]{3,24})\s+(\d{1,9})$/i);
  if (match) return { type: "setXp", username: match[1], xp: Number(match[2]) };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+vinyls\s+(\d{1,9})$/i);
  if (match) return { type: "giveVinyls", username: match[1], amount: Number(match[2]) };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+xp\s+(\d{1,9})$/i);
  if (match) return { type: "giveXp", username: match[1], xp: Number(match[2]) };
  if (input.toLowerCase() === "-list nickname colors") return { type: "listNicknameColors" };
  if (input.toLowerCase() === "-list avatar frames") return { type: "listAvatarFrames" };
  if (input.toLowerCase() === "-list profile banners") return { type: "listProfileBanners" };
  if (input.toLowerCase() === "-list all shop items") return { type: "listAllShopItems" };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+avatar\s+frame\s+"([^"]+)"$/i);
  if (match) return { type: "giveAvatarFrame", username: match[1], itemName: match[2] };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+profile\s+banner\s+"([^"]+)"$/i);
  if (match) return { type: "giveProfileBanner", username: match[1], itemName: match[2] };
  match = input.match(/^-give\s+@?([a-z0-9_-]{3,24})\s+shop\s+item\s+"([^"]+)"$/i);
  if (match) return { type: "giveShopItem", username: match[1], itemName: match[2] };
  match = input.match(/^-rainbow\s+@?([a-z0-9_-]{3,24})$/i);
  if (match) return { type: "rainbowNicknameColor", username: match[1] };
  match = input.match(/^-create\s+promocode\s+"([^"]+)"\s+reward:([a-z]+):([a-z0-9_]+)\s+limit:(\d+)\s+enddate:(\d{2}\.\d{2}\.\d{2})$/i);
  if (match) return { type: "createPromoCode", code: match[1], rewardType: match[2], rewardValue: match[3], limit: Number(match[4]), endDate: match[5] };
  if (input.toLowerCase().startsWith("-create promocode")) return { error: "Missing required arguments" };
  return { error: "Неизвестная команда. Напиши -help." };
}

function parsePromoDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yy] = match;
  const date = new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), 23, 59, 59, 999));
  if (date.getUTCDate() !== Number(dd) || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCFullYear() !== 2000 + Number(yy)) return null;
  return date.toISOString();
}

function grantPromoReward(user, promo) {
  if (promo.reward_type === "vinyls") {
    addVinylTransaction(user, Math.max(1, Number(promo.reward_value)), "promo_code", { code: promo.code });
    return `+${Number(promo.reward_value)} Vinyls`;
  }
  if (promo.reward_type === "xp") {
    const delta = Math.max(1, Number(promo.reward_value));
    user.economy.xp = Math.max(0, user.economy.xp + delta);
    user.economy.level = Math.max(1, Math.floor(user.economy.xp / 1000) + 1);
    return `+${delta} XP`;
  }
  if (promo.reward_type === "item") {
    const item = catalogItemById(String(promo.reward_value || ""));
    if (!item) throw new Error("INVALID_PROMO_ITEM");
    grantShopItemToUser(user, item);
    return item.name;
  }
  throw new Error("INVALID_REWARD_TYPE");
}

function normalizeShopItemName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function validateAccountTag(value, currentUserId = "") {
  const username = normalizeUsername(value);
  if (username.length < 3) return { error: "Тег должен быть от 3 символов: латиница, цифры, _ или -" };
  const owner = usersStore.users.find((user) => user.username === username);
  if (owner && owner.id !== currentUserId) return { error: "Такой тег уже занят" };
  return { username };
}

function friendIdsForUser(userId) {
  const id = String(userId || "");
  return (usersStore.friendships || [])
    .filter((friendship) => friendship.userAId === id || friendship.userBId === id)
    .map((friendship) => friendship.userAId === id ? friendship.userBId : friendship.userAId);
}

function usersAreFriends(userAId, userBId) {
  const key = friendshipKey(userAId, userBId);
  return (usersStore.friendships || []).some((friendship) => friendship.id === key || friendshipKey(friendship.userAId, friendship.userBId) === key);
}

function getPendingFriendRequest(senderId, receiverId) {
  ensureSocialCollections();
  return usersStore.friendRequests.find((request) => request.status === "pending" && request.senderId === senderId && request.receiverId === receiverId) || null;
}

function publicSocialUser(user, viewerId = "") {
  const status = getUserPresence(user?.id);
  const nickname = user?.displayName || user?.username || "Игрок";
  return {
    id: user.id,
    username: user.username,
    nickname,
    displayName: user.displayName || user.username,
    avatar: user.avatar || "",
    online: status.online,
    activity: status.activity,
    lobby: status.lobby,
    unread: getUnreadDirectCount(viewerId, user.id),
    equippedCosmetics: { ...(user?.economy?.equipped || {}) },
    roles: publicRoles(user),
    permissions: { dev: hasRole(user, DEV_ROLE) }
  };
}

function getUserPresence(userId) {
  if (!userId || !userSockets.has(userId)) return { online: false, activity: "Не в сети", lobby: null };
  for (const lobby of Object.values(lobbies)) {
    const player = lobby.players.find((item) => item.accountId === userId && !item.disconnected);
    if (!player) continue;
    const lobbyInfo = {
      code: lobby.code,
      players: lobby.players.filter((item) => !item.disconnected).length,
      maxPlayers: lobby.settings?.maxPlayers || DEFAULT_MAX_PLAYERS,
      canJoin: lobby.isOpen !== false && lobby.phase === "lobby"
    };
    return lobby.phase === "playing" || lobby.phase === "voting" || lobby.phase === "spyGuess"
      ? { online: true, activity: "Играет", lobby: lobbyInfo }
      : { online: true, activity: "В лобби", lobby: lobbyInfo };
  }
  return { online: true, activity: "В меню", lobby: null };
}

function getSocialState(userId) {
  ensureSocialCollections();
  const user = findUserById(userId);
  if (!user) return { friends: [], incomingRequests: [], outgoingRequests: [] };
  const friends = friendIdsForUser(userId).map(findUserById).filter(Boolean).map((friend) => publicSocialUser(friend, userId));
  console.info(`[social] read state user=${userId} friends=${friends.length} incoming=${usersStore.friendRequests.filter((request) => request.status === "pending" && request.receiverId === userId).length}`);
  const incomingRequests = usersStore.friendRequests
    .filter((request) => request.status === "pending" && request.receiverId === userId)
    .map((request) => ({ request, user: findUserById(request.senderId) }))
    .filter(({ user }) => user)
    .map(({ request, user: requestUser }) => ({ ...request, user: publicSocialUser(requestUser, userId) }));
  const outgoingRequests = usersStore.friendRequests
    .filter((request) => request.status === "pending" && request.senderId === userId)
    .map((request) => ({ request, user: findUserById(request.receiverId) }))
    .filter(({ user }) => user)
    .map(({ request, user: requestUser }) => ({ ...request, user: publicSocialUser(requestUser, userId) }));
  return { friends, incomingRequests, outgoingRequests };
}

function emitSocialState(userId) {
  if (!userId) return;
  io.to(`user:${userId}`).emit("social:state", getSocialState(userId));
}

function emitSocialForUserAndFriends(userId) {
  emitSocialState(userId);
  for (const friendId of friendIdsForUser(userId)) emitSocialState(friendId);
}

function addFriendship(userAId, userBId) {
  const userA = findUserById(userAId);
  const userB = findUserById(userBId);
  if (!userA || !userB || userAId === userBId) return false;
  const key = friendshipKey(userAId, userBId);
  if (!(usersStore.friendships || []).some((friendship) => friendship.id === key || friendshipKey(friendship.userAId, friendship.userBId) === key)) {
    usersStore.friendships.push({ id: key, userAId: key.split(":")[0], userBId: key.split(":")[1], createdAt: new Date().toISOString() });
    console.info(`[db] friendship insert confirmed userA=${userAId} userB=${userBId}`);
  }
  userA.friends = friendIdsForUser(userAId);
  userB.friends = friendIdsForUser(userBId);
  userA.updatedAt = new Date().toISOString();
  userB.updatedAt = userA.updatedAt;
  return true;
}

function createFriendRequest(senderId, receiverId) {
  ensureSocialCollections();
  const sender = findUserById(senderId);
  const receiver = findUserById(receiverId);
  if (!sender || !receiver) return { error: "Пользователь не найден" };
  if (senderId === receiverId) return { error: "Нельзя добавить самого себя" };
  if (usersAreFriends(senderId, receiverId)) return { error: "Вы уже друзья" };
  if (getPendingFriendRequest(senderId, receiverId)) return { error: "Заявка уже отправлена" };
  const reverse = getPendingFriendRequest(receiverId, senderId);
  if (reverse) {
    reverse.status = "accepted";
    reverse.respondedAt = new Date().toISOString();
    addFriendship(senderId, receiverId);
    saveUsersStore();
    emitSocialForUserAndFriends(senderId);
    emitSocialForUserAndFriends(receiverId);
    io.to(`user:${receiverId}`).emit("social:notification", { type: "friend:accepted", message: `${sender.displayName || sender.username} принял заявку` });
    return { success: true, accepted: true };
  }
  const request = { id: crypto.randomUUID(), senderId, receiverId, status: "pending", createdAt: new Date().toISOString() };
  usersStore.friendRequests.push(request);
  saveUsersStore();
  console.info(`[db] friend request insert confirmed sender=${senderId} receiver=${receiverId}`);
  emitSocialState(senderId);
  emitSocialState(receiverId);
  io.to(`user:${receiverId}`).emit("social:notification", { type: "friend:request", message: `Новая заявка от ${sender.displayName || sender.username}` });
  return { success: true, request };
}

function acceptFriendRequest(receiverId, requestId) {
  ensureSocialCollections();
  const request = usersStore.friendRequests.find((item) => item.id === requestId && item.receiverId === receiverId && item.status === "pending");
  if (!request) return { error: "Заявка не найдена" };
  request.status = "accepted";
  request.respondedAt = new Date().toISOString();
  addFriendship(request.senderId, request.receiverId);
  saveUsersStore();
  console.info(`[db] friend request accepted id=${requestId}`);
  emitSocialForUserAndFriends(request.senderId);
  emitSocialForUserAndFriends(request.receiverId);
  const receiver = findUserById(receiverId);
  io.to(`user:${request.senderId}`).emit("social:notification", { type: "friend:accepted", message: `${receiver?.displayName || receiver?.username || "Игрок"} принял заявку` });
  return { success: true };
}

function declineFriendRequest(receiverId, requestId) {
  ensureSocialCollections();
  const request = usersStore.friendRequests.find((item) => item.id === requestId && item.receiverId === receiverId && item.status === "pending");
  if (!request) return { error: "Заявка не найдена" };
  request.status = "declined";
  request.respondedAt = new Date().toISOString();
  saveUsersStore();
  console.info(`[db] friend request declined id=${requestId}`);
  emitSocialState(request.senderId);
  emitSocialState(request.receiverId);
  return { success: true };
}

function removeFriend(userId, friendId) {
  const user = findUserById(userId);
  const friend = findUserById(friendId);
  if (!user || !friend || !usersAreFriends(userId, friendId)) return { error: "Друг не найден" };
  const key = friendshipKey(userId, friendId);
  usersStore.friendships = (usersStore.friendships || []).filter((friendship) => friendship.id !== key && friendshipKey(friendship.userAId, friendship.userBId) !== key);
  user.friends = friendIdsForUser(userId);
  friend.friends = friendIdsForUser(friendId);
  console.info(`[db] friendship delete confirmed user=${userId} friend=${friendId}`);
  user.updatedAt = new Date().toISOString();
  friend.updatedAt = user.updatedAt;
  saveUsersStore();
  emitSocialState(userId);
  emitSocialState(friendId);
  return { success: true };
}

function conversationIdFor(userAId, userBId) {
  return [userAId, userBId].sort().join(":");
}

function getDirectHistory(userId, friendId) {
  const conversationId = conversationIdFor(userId, friendId);
  return (usersStore.directMessages || [])
    .filter((message) => message.conversationId === conversationId)
    .slice(-120)
    .map((message) => ({ ...message, mine: message.senderId === userId }));
}

function getUnreadDirectCount(userId, friendId = "") {
  ensureSocialCollections();
  return usersStore.directMessages.filter((message) => message.receiverId === userId && (!friendId || message.senderId === friendId) && message.status !== "read").length;
}

function markDirectRead(userId, friendId) {
  ensureSocialCollections();
  let changed = false;
  for (const message of usersStore.directMessages) {
    if (message.senderId === friendId && message.receiverId === userId && message.status !== "read") {
      message.status = "read";
      message.readAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveUsersStore();
  return changed;
}

function registerAuthenticatedSocket(socket, user) {
  if (!user) return;
  ensureUserProgress(user);
  if (socket.data.user?.id && socket.data.user.id !== user.id) unregisterAuthenticatedSocket(socket);
  socket.data.user = user;
  socket.join(`user:${user.id}`);
  const sockets = userSockets.get(user.id) || new Set();
  sockets.add(socket.id);
  userSockets.set(user.id, sockets);
  let deliveredChanged = false;
  for (const message of usersStore.directMessages || []) {
    if (message.receiverId === user.id && message.status === "pending") {
      message.status = "delivered";
      deliveredChanged = true;
    }
  }
  if (deliveredChanged) saveUsersStore();
  emitSocialForUserAndFriends(user.id);
}

function unregisterAuthenticatedSocket(socket) {
  const userId = socket.data.user?.id;
  if (!userId) return;
  socket.leave(`user:${userId}`);
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(socket.id);
    if (!sockets.size) userSockets.delete(userId);
  }
  socket.data.user = null;
  emitSocialForUserAndFriends(userId);
}

function sanitizeDisplayName(value, fallback = "Игрок") {
  return normalizeName(String(value || fallback).replace(/[#@]/g, " "));
}

function makeUniqueUsername(base) {
  const normalizedBase = normalizeUsername(base) || `player_${crypto.randomBytes(3).toString("hex")}`;
  const root = normalizedBase.slice(0, 20) || "player";
  const occupied = new Set(usersStore.users.map((user) => user.username));
  if (!occupied.has(root)) return root;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${root.slice(0, 24 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }

  return `${root.slice(0, 17)}_${crypto.randomBytes(3).toString("hex")}`;
}

function oauthProviderLabel(provider) {
  return provider === "google" ? "Google" : "Discord";
}

function userHasOAuthIdentity(user, provider, providerId) {
  return (user.oauth || []).some((identity) => identity.provider === provider && identity.providerId === providerId);
}

async function upsertOAuthUser(provider, profile, tokenData = {}) {
  const providerId = String(profile.providerId || "").trim();
  if (!providerId) throw new Error("OAuth profile id is missing");

  const now = new Date().toISOString();
  const email = String(profile.email || "").trim().toLowerCase();
  const providerName = sanitizeDisplayName(profile.providerName || profile.displayName || profile.username || email.split("@")[0], oauthProviderLabel(provider));
  let user = usersStore.users.find((item) => userHasOAuthIdentity(item, provider, providerId));

  const oauthPatch = {
    provider,
    providerId,
    email,
    providerName,
    linkedAt: now,
    lastLoginAt: now
  };
  if (tokenData.access_token) oauthPatch.hasAccessToken = true;
  if (tokenData.refresh_token) oauthPatch.hasRefreshToken = true;

  if (!user) {
    const usernameBase = profile.username || email.split("@")[0] || `${provider}_${providerId}`;
    user = {
      id: crypto.randomUUID(),
      username: makeUniqueUsername(usernameBase),
      displayName: sanitizeDisplayName(profile.displayName || providerName, oauthProviderLabel(provider)),
      providerName,
      avatar: profile.avatar || "",
      hasCustomAvatar: false,
      stats: defaultStats(),
      economy: defaultEconomy(),
      oauth: [oauthPatch],
      sessions: [],
      createdAt: now,
      updatedAt: now
    };
    ensureUserProgress(user);
    usersStore.users.push(user);
  } else {
    user.oauth = Array.isArray(user.oauth) ? user.oauth : [];
    const identity = user.oauth.find((item) => item.provider === provider && item.providerId === providerId);
    if (identity) {
      identity.email = email || identity.email || "";
      identity.providerName = providerName || identity.providerName || "";
      identity.lastLoginAt = now;
      identity.linkedAt = identity.linkedAt || now;
      if (tokenData.access_token) identity.hasAccessToken = true;
      if (tokenData.refresh_token) identity.hasRefreshToken = true;
    } else {
      user.oauth.push(oauthPatch);
    }
    user.providerName = user.providerName || providerName;
    user.updatedAt = now;
  }

  await saveUsersStore();
  return user;
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_URL || process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function oauthRedirectUri(req, provider) {
  const envKey = provider === "google" ? "GOOGLE_REDIRECT_URI" : "DISCORD_REDIRECT_URI";
  return String(process.env[envKey] || "").trim() || `${String(process.env.PUBLIC_URL || getPublicBaseUrl(req)).replace(/\/$/, "")}/auth/${provider}/callback`;
}

function createOAuthState(provider, returnTo = "/") {
  const state = crypto.randomBytes(24).toString("hex");
  const safeReturnTo = String(returnTo || "/").startsWith("/") ? String(returnTo || "/") : "/";
  oauthStates.set(state, { provider, returnTo: safeReturnTo, createdAt: Date.now() });
  return state;
}

function consumeOAuthState(state, provider) {
  const entry = oauthStates.get(String(state || ""));
  oauthStates.delete(String(state || ""));
  if (!entry || entry.provider !== provider) return null;
  if (Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) return null;
  return entry;
}

function oauthConfig(provider, req) {
  if (provider === "google") {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: oauthRedirectUri(req, provider),
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: "openid email profile",
      prompt: "select_account",
      tokenAuthStyle: "body"
    };
  }

  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: oauthRedirectUri(req, provider),
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/v10/oauth2/token",
    userUrl: "https://discord.com/api/v10/users/@me",
    scope: "identify email",
    prompt: "consent",
    tokenAuthStyle: "basic"
  };
}

function oauthError(provider, step, response, payload) {
  const details = payload?.error_description || payload?.error || payload?.message || payload?.raw || "empty response";
  return new Error(`${oauthProviderLabel(provider)} ${step} failed with ${response.status}: ${details}`);
}

function appProfileFromPassport(provider, profile = {}) {
  if (provider === "google") {
    return {
      providerId: profile.id,
      email: profile.emails?.[0]?.value || "",
      username: profile.emails?.[0]?.value ? String(profile.emails[0].value).split("@")[0] : profile.displayName,
      displayName: profile.displayName || profile.emails?.[0]?.value || "Google player",
      providerName: profile.displayName || profile.emails?.[0]?.value || "Google player",
      avatar: profile.photos?.[0]?.value || ""
    };
  }

  return {
    providerId: profile.id,
    email: profile.email || profile.emails?.[0]?.value || "",
    username: profile.username || profile.global_name || profile.displayName,
    displayName: profile.global_name || profile.displayName || profile.username || "Discord player",
    providerName: profile.global_name || profile.displayName || profile.username || "Discord player",
    avatar: profile.avatar || profile.photos?.[0]?.value || ""
  };
}

function configurePassportStrategies() {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      done(null, await getUser(id));
    } catch (error) {
      done(error);
    }
  });

  const publicUrl = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");

  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    passport.use(new DiscordStrategy({
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: `${publicUrl}/auth/discord/callback`,
      scope: ["identify", "email"]
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const appProfile = appProfileFromPassport("discord", profile);
        done(null, await getOrCreateUser("discord", appProfile.providerId, appProfile));
      } catch (error) {
        done(error);
      }
    }));
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${publicUrl}/auth/google/callback`
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const appProfile = appProfileFromPassport("google", profile);
        done(null, await getOrCreateUser("google", appProfile.providerId, appProfile));
      } catch (error) {
        done(error);
      }
    }));
  }
}

configurePassportStrategies();

io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

function profileForSocket(socket) {
  const user = socket.data.user;
  if (user) return { user: publicUser(user), guest: false };
  return { user: null, guest: true };
}

function normalizeReconnectToken(token) {
  const value = String(token || "").trim();
  return /^[a-f0-9-]{24,80}$/i.test(value) ? value : crypto.randomUUID();
}

function playerFromSocket(socket, rawName, lobby = null, reconnectToken = "") {
  const user = socket.data.user;
  const baseName = user ? (user.displayName || user.username) : (rawName || "Гость");
  const name = lobby ? makeUniqueName(lobby, baseName) : normalizeName(baseName);
  const equippedCosmetics = user?.economy?.equipped && typeof user.economy.equipped === "object"
    ? { ...user.economy.equipped }
    : {};
  return {
    id: socket.id,
    accountId: user?.id || null,
    guest: !user,
    name,
    avatar: user?.avatar || "",
    equippedCosmetics,
    roles: publicRoles(user),
    permissions: { dev: hasRole(user, DEV_ROLE) },
    ready: false,
    reconnectToken: normalizeReconnectToken(reconnectToken),
    disconnected: false,
    disconnectedAt: null,
    reconnectTimer: null
  };
}

function globalChatIdentity(socket, rawName = "") {
  const player = playerFromSocket(socket, rawName);
  return {
    playerId: socket.id,
    accountId: player.accountId,
    playerName: player.name,
    avatar: player.avatar,
    roles: player.roles || [],
    permissions: player.permissions || {},
    equippedCosmetics: player.equippedCosmetics || {}
  };
}

function publicPlayer(player) {
  const { reconnectToken, reconnectTimer, disconnectedAt, ...safePlayer } = player;
  return safePlayer;
}

function publicPlayers(players = []) {
  return players.map(publicPlayer);
}

function logServerCosmetics(prefix, players = []) {
  const payload = (players || []).map((player) => ({ playerId: player?.id, equippedCosmetics: player?.equippedCosmetics || {} }));
  console.log(`[CS] player equipped:${JSON.stringify({ prefix, players: payload })}`);
}

function syncUserProfileInLobbies(user) {
  for (const lobby of Object.values(lobbies)) {
    let changed = false;
    for (const player of lobby.players) {
      if (player.accountId === user.id) {
        const nextName = makeUniqueName(lobby, user.displayName || user.username, player.id);
        if (player.name !== nextName) player.name = nextName;
        if (player.avatar !== (user.avatar || "")) player.avatar = user.avatar || "";
        player.equippedCosmetics = {
          ...(user?.economy?.equipped && typeof user.economy.equipped === "object" ? user.economy.equipped : {})
        };
        changed = true;
      }
    }
    if (changed) emitLobbyUpdate(lobby.code);
  }
}

function removeAccountFromActiveLobbies(userId) {
  for (const code of Object.keys(lobbies)) {
    const lobby = lobbies[code];
    const playersToRemove = lobby.players.filter((player) => player.accountId === userId);
    for (const player of playersToRemove) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) handlePlayerDeparture(lobby, playerSocket, { leaveRoom: true });
      else removePlayerFromLobby(lobby, player.id);
      if (!lobbies[code]) break;
    }
    if (lobbies[code]) emitLobbyUpdate(code);
  }
}

function deleteUserAccount(userId) {
  const before = usersStore.users.length;
  usersStore.users = usersStore.users.filter((user) => user.id !== userId);
  usersStore.friendships = (usersStore.friendships || []).filter((friendship) => friendship.userAId !== userId && friendship.userBId !== userId);
  usersStore.friendRequests = (usersStore.friendRequests || []).filter((request) => request.senderId !== userId && request.receiverId !== userId);
  usersStore.directMessages = (usersStore.directMessages || []).filter((message) => message.senderId !== userId && message.receiverId !== userId);
  return usersStore.users.length !== before;
}

const GAME_MODES = {
  classic: {
    label: "Классика",
    rounds: 3,
    listenTime: 30,
    spyMode: "auto",
    spyCount: 1,
    anonymousVoting: false,
    votingTime: 60,
    runoffOnTie: true,
    maxPlayers: DEFAULT_MAX_PLAYERS
  },
  blitz: {
    label: "Блиц",
    rounds: 1,
    listenTime: 15,
    spyMode: "auto",
    spyCount: 1,
    anonymousVoting: true,
    votingTime: 30,
    runoffOnTie: false,
    maxPlayers: DEFAULT_MAX_PLAYERS
  }
};

const DEFAULT_SETTINGS = {
  gameMode: "classic",
  rounds: GAME_MODES.classic.rounds,
  listenTime: GAME_MODES.classic.listenTime,
  spyMode: GAME_MODES.classic.spyMode,
  spyCount: GAME_MODES.classic.spyCount,
  anonymousVoting: GAME_MODES.classic.anonymousVoting,
  votingTime: GAME_MODES.classic.votingTime,
  runoffOnTie: GAME_MODES.classic.runoffOnTie,
  maxPlayers: GAME_MODES.classic.maxPlayers
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
  next.rounds = clampNumber(input.rounds, [1, 2, 3, 4, 5], next.rounds);
  next.listenTime = clampNumber(input.listenTime, [15, 30, 45, 60], next.listenTime);
  next.spyMode = input.spyMode === undefined ? next.spyMode : (input.spyMode === "manual" ? "manual" : "auto");
  next.spyCount = clampNumber(input.spyCount, [1, 2, 3], next.spyCount || DEFAULT_SETTINGS.spyCount);
  next.anonymousVoting = input.anonymousVoting === undefined ? next.anonymousVoting : Boolean(input.anonymousVoting);
  next.votingTime = clampNumber(input.votingTime, [0, 30, 60, 90], next.votingTime);
  next.runoffOnTie = input.runoffOnTie === undefined ? next.runoffOnTie : input.runoffOnTie !== false;
  next.maxPlayers = clampNumber(input.maxPlayers, ALLOWED_MAX_PLAYERS, next.maxPlayers || DEFAULT_MAX_PLAYERS);
  return next;
}

function defaultLobbyName(hostName) {
  return `Лобби ${normalizeName(hostName || "хоста")}`.slice(0, MAX_LOBBY_NAME_LENGTH);
}

function normalizeLobbyName(name, fallback = "Музыкальное лобби") {
  const normalized = String(name || "")
    .replace(/[#@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LOBBY_NAME_LENGTH);
  return normalized || String(fallback || "Музыкальное лобби").slice(0, MAX_LOBBY_NAME_LENGTH);
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

function resetSkipVotes(lobby) {
  lobby.skipVotes = {};
  lobby.skipCompleted = false;
}

function activePlayers(lobby) {
  return (lobby.players || []).filter((player) => !player.disconnected);
}

function getSkipVoteState(lobby) {
  if (!lobby || lobby.phase !== "playing" || !lobby.lastTrack || !["listening", "paused"].includes(lobby.turnStage)) {
    return {
      trackId: null,
      ownerId: lobby?.lastTrack?.playerId || null,
      requiredVotes: 0,
      voteCount: 0,
      voterIds: [],
      voters: [],
      completed: Boolean(lobby?.skipCompleted)
    };
  }

  const ownerId = lobby.lastTrack.playerId;
  const eligiblePlayers = activePlayers(lobby).filter((player) => player.id !== ownerId);
  const eligibleIds = new Set(eligiblePlayers.map((player) => player.id));
  const voterIds = Object.keys(lobby.skipVotes || {}).filter((playerId) => eligibleIds.has(playerId));

  return {
    trackId: lobby.lastTrack.id,
    ownerId,
    requiredVotes: eligiblePlayers.length,
    voteCount: voterIds.length,
    voterIds,
    voters: voterIds.map((playerId) => {
      const player = lobby.players.find((item) => item.id === playerId);
      return { id: playerId, name: player?.name || "Игрок", avatar: player?.avatar || "" };
    }),
    completed: Boolean(lobby.skipCompleted)
  };
}

function shouldCompleteSkip(lobby) {
  const skipState = getSkipVoteState(lobby);
  return Boolean(skipState.trackId && skipState.requiredVotes > 0 && skipState.voteCount >= skipState.requiredVotes);
}

function completeSkipVote(lobby) {
  if (!lobby || lobby.skipCompleted || !shouldCompleteSkip(lobby)) return false;
  lobby.skipCompleted = true;
  clearTimer(lobby.code);
  io.to(lobby.code).emit("skipVoteUpdate", getSkipVoteState(lobby));
  io.to(lobby.code).emit("trackSkipped", { message: "Все игроки пропустили трек" });
  io.to(lobby.code).emit("stopTrack", { skipped: true, message: "Все игроки пропустили трек" });
  advanceTurn(lobby.code);
  return true;
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


function buildThemeGuessOptions(theme) {
  const normalizedTheme = normalizeGuess(theme);
  const similar = SIMILAR_THEME_GROUPS
    .filter((group) => group.some((item) => normalizeGuess(item) === normalizedTheme))
    .flat()
    .filter((item) => normalizeGuess(item) !== normalizedTheme);
  const fallback = THEMES.filter((item) => normalizeGuess(item) !== normalizedTheme);
  const decoys = [];

  for (const candidate of shuffle([...similar, ...fallback])) {
    if (!decoys.some((item) => normalizeGuess(item) === normalizeGuess(candidate))) {
      decoys.push(candidate);
    }
    if (decoys.length >= 3) break;
  }

  return shuffle([theme, ...decoys]).map((text) => ({
    id: crypto.createHash("sha1").update(normalizeGuess(text)).digest("hex").slice(0, 10),
    text,
    correct: normalizeGuess(text) === normalizedTheme
  }));
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

function remapVoteTotals(votes = {}, replace) {
  const nextVotes = {};
  for (const [playerId, count] of Object.entries(votes || {})) {
    nextVotes[replace(playerId)] = count;
  }
  return nextVotes;
}

function remapVoteChoices(votes = {}, replace) {
  const nextVotes = {};
  for (const [voter, target] of Object.entries(votes || {})) {
    nextVotes[replace(voter)] = replace(target);
  }
  return nextVotes;
}

function remapFinalResultPlayerId(finalResult, oldId, newId) {
  if (!finalResult || oldId === newId) return finalResult;
  const replace = (value) => value === oldId ? newId : value;

  finalResult.host = replace(finalResult.host);
  finalResult.spy = replace(finalResult.spy);
  finalResult.spies = (finalResult.spies || []).map(replace);
  finalResult.suspected = (finalResult.suspected || []).map(replace);
  finalResult.votes = remapVoteTotals(finalResult.votes || {}, replace);
  finalResult.players = (finalResult.players || []).map((player) => (player?.id === oldId ? { ...player, id: newId } : player));
  finalResult.trackHistory = (finalResult.trackHistory || []).map((track) => (track?.playerId === oldId ? { ...track, playerId: newId } : track));
  finalResult.finalComments = (finalResult.finalComments || []).map((comment) => (comment?.playerId === oldId ? { ...comment, playerId: newId } : comment));

  if (finalResult.spyGuess?.playerId === oldId) finalResult.spyGuess = { ...finalResult.spyGuess, playerId: newId };
  if (finalResult.breakdown?.voteDetails) {
    finalResult.breakdown = {
      ...finalResult.breakdown,
      voteDetails: finalResult.breakdown.voteDetails.map((detail) => ({
        ...detail,
        voterId: replace(detail.voterId),
        targetId: replace(detail.targetId)
      }))
    };
  }
  if (Array.isArray(finalResult.economyRewards)) {
    finalResult.economyRewards = finalResult.economyRewards.map((reward) => (reward?.playerId === oldId ? { ...reward, playerId: newId } : reward));
  }
  if (Array.isArray(finalResult.expRewards)) {
    finalResult.expRewards = finalResult.expRewards.map((reward) => (reward?.playerId === oldId ? { ...reward, playerId: newId } : reward));
  }
  return finalResult;
}

function replacePlayerId(lobby, oldId, newId) {
  const replace = (value) => value === oldId ? newId : value;
  lobby.host = replace(lobby.host);
  lobby.spy = replace(lobby.spy);
  lobby.order = lobby.order.map(replace);
  lobby.baseOrder = lobby.baseOrder.map(replace);
  lobby.spies = lobby.spies.map(replace);
  lobby.voteCandidates = lobby.voteCandidates.map(replace);
  lobby.suspected = (lobby.suspected || []).map(replace);
  lobby.spyGuessTargetId = replace(lobby.spyGuessTargetId);

  lobby.votes = remapVoteChoices(lobby.votes || {}, replace);
  if (lobby.finalVotes) lobby.finalVotes = remapVoteTotals(lobby.finalVotes, replace);

  const nextReactions = {};
  for (const [playerId, reaction] of Object.entries(lobby.currentTrackReactions || {})) {
    nextReactions[replace(playerId)] = reaction;
  }
  lobby.currentTrackReactions = nextReactions;

  const nextSkipVotes = {};
  for (const [playerId, votedAt] of Object.entries(lobby.skipVotes || {})) {
    nextSkipVotes[replace(playerId)] = votedAt;
  }
  lobby.skipVotes = nextSkipVotes;

  if (lobby.lastTrack?.playerId === oldId) lobby.lastTrack.playerId = newId;
  for (const track of lobby.trackHistory || []) {
    if (track.playerId === oldId) track.playerId = newId;
  }
  for (const comment of lobby.finalComments || []) {
    if (comment.playerId === oldId) comment.playerId = newId;
  }
  if (lobby.pendingSpyGuess?.playerId === oldId) lobby.pendingSpyGuess.playerId = newId;
  if (lobby.spyGuess?.playerId === oldId) lobby.spyGuess.playerId = newId;
  remapFinalResultPlayerId(lobby.finalResult, oldId, newId);
}

function clearPlayerReconnectTimer(player) {
  if (player?.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
}

function hasActiveGameSession(lobby) {
  return Boolean(lobby?.started && lobby.phase !== "ended");
}

function schedulePlayerDeparture(lobby, socket) {
  const player = lobby.players.find((item) => item.id === socket.id);
  if (!player) return;
  player.disconnected = true;
  player.disconnectedAt = Date.now();
  clearPlayerReconnectTimer(player);
  player.reconnectTimer = setTimeout(() => {
    const currentLobby = lobbies[lobby.code];
    const currentPlayer = currentLobby?.players.find((item) => item.id === socket.id && item.disconnected);
    if (!currentLobby || !currentPlayer) return;
    clearPlayerReconnectTimer(currentPlayer);
    handlePlayerDeparture(currentLobby, socket, { leaveRoom: false });
  }, RECONNECT_GRACE_MS);
  emitLobbyUpdate(lobby.code);
  emitGameState(lobby.code);
  completeSkipVote(lobby);
}

function sendPrivateGameStart(lobby, socket) {
  const isSpy = lobby.spies.includes(socket.id);
  logServerCosmetics("gameStarted", lobby.players);
  socket.emit("gameStarted", {
    code: lobby.code,
    host: lobby.host,
    role: isSpy ? "spy" : "civilian",
    theme: isSpy ? null : lobby.theme,
    round: lobby.round,
    totalRounds: lobby.settings.rounds,
    order: lobby.order,
    players: publicPlayers(lobby.players),
    spyCount: lobby.spies.length,
    spyIds: isSpy ? lobby.spies : [],
    settings: lobby.settings,
    trackHistory: lobby.trackHistory,
    chatMessages: lobby.chatMessages,
    finalComments: lobby.finalComments || []
  });
}

function reconnectPlayerToGame(socket, { code, reconnectToken } = {}) {
  const lobby = lobbies[normalizeCode(code)];
  const canRestoreEndedResult = lobby?.phase === "ended" && lobby.finalResult;
  if (!lobby || (!hasActiveGameSession(lobby) && !canRestoreEndedResult)) return { error: "Активная игра не найдена" };
  const normalizedToken = normalizeReconnectToken(reconnectToken);
  const player = lobby.players.find((item) => item.reconnectToken === normalizedToken);
  if (!player) return { error: "Не удалось восстановить игрока" };

  const oldId = player.id;
  socket.join(lobby.code);
  if (oldId !== socket.id) {
    replacePlayerId(lobby, oldId, socket.id);
    player.id = socket.id;
  }
  if (socket.data.user && player.accountId === socket.data.user.id) {
    player.name = makeUniqueName(lobby, socket.data.user.displayName || socket.data.user.username, player.id);
    player.avatar = socket.data.user.avatar || "";
    player.guest = false;
  }
  player.disconnected = false;
  player.disconnectedAt = null;
  clearPlayerReconnectTimer(player);

  if (lobby.phase === "ended" && lobby.finalResult) {
    socket.emit("gameEnd", {
      ...lobby.finalResult,
      players: lobby.players.map(publicPlayer),
      finalComments: lobby.finalComments || lobby.finalResult.finalComments || []
    });
  } else {
    sendPrivateGameStart(lobby, socket);
    emitGameState(lobby.code);
  }
  emitLobbyUpdate(lobby.code);
  return { success: true, code: lobby.code, playerId: socket.id, phase: lobby.phase };
}

function removePlayerFromLobby(lobby, playerId) {
  const removedPlayer = lobby.players.find((player) => player.id === playerId);
  clearPlayerReconnectTimer(removedPlayer);
  const removedOrderIndex = lobby.order.indexOf(playerId);

  lobby.players = lobby.players.filter((player) => player.id !== playerId);
  lobby.order = lobby.order.filter((id) => id !== playerId);
  lobby.baseOrder = lobby.baseOrder.filter((id) => id !== playerId);
  lobby.spies = lobby.spies.filter((id) => id !== playerId);
  lobby.voteCandidates = lobby.voteCandidates.filter((id) => id !== playerId);
  delete lobby.votes[playerId];
  if (lobby.skipVotes) delete lobby.skipVotes[playerId];
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
    name: lobby.name || defaultLobbyName(lobby.players.find((player) => player.id === lobby.host)?.name),
    isOpen: lobby.isOpen !== false,
    host: lobby.host,
    players: publicPlayers(lobby.players),
    started: lobby.started,
    phase: lobby.phase,
    minPlayers: MIN_LOBBY_PLAYERS,
    maxPlayers: lobby.settings.maxPlayers || DEFAULT_SETTINGS.maxPlayers,
    totalRounds: lobby.settings.rounds,
    settings: lobby.settings,
    chatMessages: lobby.chatMessages || [],
    finalComments: lobby.finalComments || [],
    finalResult: lobby.phase === "ended" ? lobby.finalResult || null : null
  };
}


function redirectToOAuth(provider, req, res) {
  const config = oauthConfig(provider, req);
  const returnTo = req.query.returnTo || "/";
  if (!config.clientId || !config.clientSecret) {
    return res.redirect(buildOAuthErrorRedirect(returnTo, `Вход через ${oauthProviderLabel(provider)} не настроен`));
  }

  const state = createOAuthState(provider, returnTo);
  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  if (config.prompt) authUrl.searchParams.set("prompt", config.prompt);
  return res.redirect(authUrl.toString());
}

async function handleOAuthCallback(provider, req, res) {
  const stateEntry = consumeOAuthState(req.query.state, provider);
  const returnTo = stateEntry?.returnTo || "/";
  if (!stateEntry || !req.query.code) {
    return res.redirect(buildOAuthErrorRedirect(returnTo, "OAuth-сессия устарела. Попробуй еще раз."));
  }

  const config = oauthConfig(provider, req);
  if (!config.clientId || !config.clientSecret) {
    return res.redirect(buildOAuthErrorRedirect(returnTo, `Вход через ${oauthProviderLabel(provider)} не настроен`));
  }

  try {
    const tokenResponse = await fetch(config.tokenUrl, buildOAuthTokenRequest(config, req.query.code));
    const tokenData = await parseOAuthResponse(tokenResponse);
    if (!tokenResponse.ok) throw oauthError(provider, "token exchange", tokenResponse, tokenData);
    if (!tokenData.access_token) throw new Error("OAuth provider did not return an access token");

    const userResponse = await fetch(config.userUrl, {
      headers: { Authorization: `${tokenData.token_type || "Bearer"} ${tokenData.access_token}`, Accept: "application/json" }
    });
    const rawProfile = await parseOAuthResponse(userResponse);
    if (!userResponse.ok) throw oauthError(provider, "profile request", userResponse, rawProfile);
    const profile = normalizeOAuthProfile(provider, rawProfile);
    const user = await upsertOAuthUser(provider, profile, tokenData);
    const session = createSession(user);
    return res.redirect(buildOAuthSuccessRedirect(returnTo, session));
  } catch (error) {
    console.error(`${oauthProviderLabel(provider)} OAuth failed`, error);
    return res.redirect(buildOAuthErrorRedirect(returnTo, `Не удалось войти через ${oauthProviderLabel(provider)}`));
  }
}

function startPassportOAuth(provider, req, res, next) {
  const clientId = provider === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.DISCORD_CLIENT_ID;
  const clientSecret = provider === "google" ? process.env.GOOGLE_CLIENT_SECRET : process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.redirect(buildOAuthErrorRedirect(req.query.returnTo || "/", `Вход через ${oauthProviderLabel(provider)} не настроен`));
  }
  req.session.oauthReturnTo = String(req.query.returnTo || "/").startsWith("/") ? String(req.query.returnTo || "/") : "/";
  return passport.authenticate(provider, provider === "google" ? { scope: ["profile", "email"] } : undefined)(req, res, next);
}

function finishPassportOAuth(provider, req, res, next) {
  const returnTo = req.session?.oauthReturnTo || "/";
  return passport.authenticate(provider, (error, user) => {
    if (error || !user) {
      console.error(`${oauthProviderLabel(provider)} OAuth failed`, error);
      return res.redirect(buildOAuthErrorRedirect(returnTo, `Не удалось войти через ${oauthProviderLabel(provider)}`));
    }

    return req.logIn(user, (loginError) => {
      if (loginError) {
        console.error(`${oauthProviderLabel(provider)} session login failed`, loginError);
        return res.redirect(buildOAuthErrorRedirect(returnTo, `Не удалось войти через ${oauthProviderLabel(provider)}`));
      }

      const existingIndex = usersStore.users.findIndex((item) => item.id === user.id);
      if (existingIndex === -1) usersStore.users.push(user);
      else usersStore.users[existingIndex] = { ...user, sessions: usersStore.users[existingIndex].sessions || user.sessions || [] };
      ensureSocialCollections();
      return res.redirect(returnTo);
    });
  })(req, res, next);
}

app.get("/auth/google", (req, res, next) => startPassportOAuth("google", req, res, next));
app.get("/auth/google/callback", (req, res, next) => finishPassportOAuth("google", req, res, next));
app.get("/auth/discord", (req, res, next) => startPassportOAuth("discord", req, res, next));
app.get("/auth/discord/callback", (req, res, next) => finishPassportOAuth("discord", req, res, next));
// Internal bot API — генерация кода комнаты
app.post('/api/bot/create-room', (req, res) => {
  const secret = req.headers['x-bot-secret'];
  if (secret !== process.env.BOT_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  res.json({ code, url: `https://musicspy.online/?room=${code}` });
});
function emitLobbyUpdate(code) {
  const lobby = lobbies[code];
  if (!lobby) return;
  const payload = publicLobby(lobby);
  logServerCosmetics("lobbyUpdate", payload.players);
  io.to(code).emit("lobbyUpdate", payload);
  logServerCosmetics("players:update", payload.players);
  io.to(code).emit("players:update", { players: payload.players });
  for (const player of lobby.players || []) {
    if (player.accountId) emitSocialForUserAndFriends(player.accountId);
  }
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
    if (!completeSkipVote(lobby)) startTurn(code);
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

  logServerCosmetics("gameState", lobby.players);
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
    players: publicPlayers(lobby.players),
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
    skipVote: getSkipVoteState(lobby),
    trackHistory: lobby.trackHistory || [],
    pendingSpyGuess: lobby.pendingSpyGuess || null,
    chatMessages: lobby.chatMessages || [],
    finalComments: lobby.finalComments || []
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
  resetSkipVotes(lobby);
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
  resetSkipVotes(lobby);
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
    players: publicPlayers(lobby.players),
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

  finishGame(code, suspected, voteTotals, { text: "", correct: false, skipped: true });
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
  lobby.spyGuessOptions = caughtSpy ? buildThemeGuessOptions(lobby.theme) : [];
  lobby.spyGuessTimeLeft = caughtSpy ? SPY_GUESS_SECONDS : DECOY_GUESS_SECONDS;

  for (const player of lobby.players) {
    const isGuesser = player.id === guesserId;
    io.to(player.id).emit("spyGuessStarted", {
      spies: caughtSpy && isGuesser ? lobby.spies : [],
      guesserId: isGuesser ? guesserId : null,
      guesserRole: caughtSpy ? (isGuesser ? "spy" : "hidden") : (isGuesser ? "decoy" : "hidden"),
      accusedNames: suspected.map((id) => lobby.players.find((item) => item.id === id)?.name || "Игрок"),
      prefillTheme: !caughtSpy && isGuesser ? lobby.theme : "",
      guessOptions: caughtSpy && isGuesser ? lobby.spyGuessOptions.map(({ id, text }) => ({ id, text })) : [],
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
        currentLobby.spyGuess = pendingGuess;
        io.to(code).emit("decoyGuessAutoSubmitted", { guess: pendingGuess });
        timers[code] = setTimeout(() => {
          finishGame(code, currentLobby.suspected || [], currentLobby.finalVotes || null, pendingGuess);
        }, 1000);
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



function addVinylTransaction(user, amount, reason, meta = {}) {
  const economy = ensureUserProgress(user);
  if (!economy || !amount) return null;
  if (hasRole(user, DEV_ROLE) && amount < 0) return null;
  const transaction = {
    id: crypto.randomUUID(),
    amount: Math.floor(amount),
    reason,
    meta,
    createdAt: new Date().toISOString()
  };
  economy.vinyls = hasRole(user, DEV_ROLE) ? Math.max(DEV_VINYL_BALANCE, economy.vinyls) : Math.max(0, economy.vinyls + transaction.amount);
  economy.transactions = [...(economy.transactions || []), transaction].slice(-80);
  if (transaction.amount > 0) user.stats.vinylsEarned = Number(user.stats.vinylsEarned || 0) + transaction.amount;
  return transaction;
}

function unlockCosmetic(user, itemId, source = "achievement") {
  const item = catalogItemById(itemId);
  if (!item) return false;
  const economy = ensureUserProgress(user);
  if (economy.ownedCosmetics.includes(itemId)) return false;
  economy.ownedCosmetics.push(itemId);
  economy.transactions = [...(economy.transactions || []), {
    id: crypto.randomUUID(),
    amount: 0,
    reason: `unlock:${source}`,
    itemId,
    createdAt: new Date().toISOString()
  }].slice(-80);
  return true;
}

function evaluateAchievements(user) {
  ensureUserProgress(user);
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    const current = Math.floor(Number(user.stats?.[achievement.stat] || 0));
    const existing = user.economy.achievements[achievement.id] || {};
    const completed = current >= achievement.target;
    user.economy.achievements[achievement.id] = {
      progress: Math.min(current, achievement.target),
      target: achievement.target,
      completed,
      claimedAt: existing.claimedAt || (completed ? new Date().toISOString() : null)
    };
    if (completed && !existing.completed) {
      if (achievement.vinyls) addVinylTransaction(user, achievement.vinyls, `achievement:${achievement.id}`);
      if (achievement.unlock) unlockCosmetic(user, achievement.unlock, achievement.id);
      unlocked.push({ ...achievement, progress: current });
    }
  }
  return unlocked;
}

function hasFriendInLobby(userId, players = []) {
  return players.some((player) => player.accountId && player.accountId !== userId && usersAreFriends(userId, player.accountId));
}

function sameUtcDay(a, b) {
  if (!a || !b) return false;
  return String(a).slice(0, 10) === String(b).slice(0, 10);
}

function buildEconomyRewardsForGame(lobby, civiliansWin, finalVotes, suspected) {
  const now = new Date().toISOString();
  const rewards = [];
  const activePlayerIds = new Set(lobby.players.map((player) => player.id));
  const spyVoteCounts = Object.fromEntries(lobby.spies.map((spyId) => [spyId, Number(finalVotes?.[spyId] || 0)]));
  const perfectSpyIds = lobby.spies.filter((spyId) => !civiliansWin && (spyVoteCounts[spyId] || 0) === 0);
  const correctVoters = new Set(Object.entries(lobby.votes || {}).filter(([, targetId]) => lobby.spies.includes(targetId)).map(([voterId]) => voterId));
  const friendMatchAccountIds = new Set(lobby.players.filter((player) => player.accountId && hasFriendInLobby(player.accountId, lobby.players)).map((player) => player.accountId));
  const longMatch = (lobby.trackHistory || []).length >= Math.max(8, lobby.players.length * 2);

  for (const player of lobby.players) {
    if (!player.accountId) continue;
    const user = findUserById(player.accountId);
    if (!user) continue;
    ensureUserProgress(user);
    const isSpy = lobby.spies.includes(player.id);
    const won = isSpy ? !civiliansWin : civiliansWin;
    const lines = [];
    let total = 0;
    const add = (amount, label, code) => {
      total += amount;
      lines.push({ amount, label, code });
    };

    if (!isSpy && civiliansWin) add(100, "Победа мирных", "civilian_win");
    if (isSpy && !civiliansWin) add(perfectSpyIds.includes(player.id) ? 500 : 300, perfectSpyIds.includes(player.id) ? "Идеальная победа шпиона" : "Победа шпиона", perfectSpyIds.includes(player.id) ? "perfect_spy_win" : "spy_win");
    if (!isSpy && correctVoters.has(player.id)) add(75, "Верное обвинение", "correct_accusation");
    if (activePlayerIds.has(player.id)) add(50, "Выжил до финала", "survive_match");
    if (won && Number(user.stats.winStreak || 0) > 1) add(Math.min(150, Number(user.stats.winStreak || 0) * 25), "Серия побед", "win_streak");
    if (!isSpy && civiliansWin && lobby.spies.every((spyId) => Number(finalVotes?.[spyId] || 0) > 0)) add(50, "Чистая командная работа", "flawless_civilians");
    if (!sameUtcDay(user.economy.lastDailyMatchAt, now)) add(100, "Первый матч дня", "daily_first_match");
    if (longMatch) add(35, "Длинная партия", "long_match");
    if (friendMatchAccountIds.has(user.id)) add(25, "Игра с друзьями", "social_friend");

    rewards.push({ user, player, isSpy, won, total, lines });
  }

  const mvp = rewards.slice().sort((a, b) => b.total - a.total)[0];
  if (mvp && mvp.total > 0) {
    mvp.total += 100;
    mvp.lines.push({ amount: 100, label: "MVP партии", code: "mvp" });
    mvp.user.stats.mvpAwards = Number(mvp.user.stats.mvpAwards || 0) + 1;
  }

  for (const reward of rewards) {
    if (reward.total > 0) addVinylTransaction(reward.user, reward.total, "match_reward", { code: lobby.code, lines: reward.lines });
    reward.user.economy.lastDailyMatchAt = now;
    if (friendMatchAccountIds.has(reward.user.id)) reward.user.stats.friendMatches = Number(reward.user.stats.friendMatches || 0) + 1;
    if (!reward.isSpy && correctVoters.has(reward.player.id)) reward.user.stats.correctAccusations = Number(reward.user.stats.correctAccusations || 0) + 1;
    if (perfectSpyIds.includes(reward.player.id)) {
      reward.user.stats.perfectSpyGames = Number(reward.user.stats.perfectSpyGames || 0) + 1;
      unlockCosmetic(reward.user, "title_perfect_manipulator", "perfect_spy_game");
    }
    reward.achievements = evaluateAchievements(reward.user);
  }

  return rewards.map((reward) => ({
    playerId: reward.player.id,
    accountId: reward.user.id,
    total: reward.total,
    lines: reward.lines,
    balance: reward.user.economy.vinyls,
    achievements: reward.achievements || []
  }));
}

function awardMatchExpRewards(lobby, civiliansWin, finalVotes = {}) {
  if (!lobby?.matchId) return [];
  if (lobby.matchRewardsGranted) {
    console.info(`[xp] skip duplicate match reward grant matchId=${lobby.matchId} code=${lobby.code}`);
    return [];
  }

  const rewards = [];
  const correctVoters = new Set(Object.entries(lobby.votes || {})
    .filter(([, targetId]) => lobby.spies.includes(targetId))
    .map(([voterId]) => voterId));
  const now = Date.now();

  for (const player of lobby.players || []) {
    if (!player.accountId) continue;
    const user = findUserById(player.accountId);
    if (!user) continue;
    const economy = ensureUserProgress(user);
    if (!economy) continue;

    const isSpy = lobby.spies.includes(player.id);
    const won = isSpy ? !civiliansWin : civiliansWin;
    const booster = xpBoosterState(user, now);
    const multiplier = booster.active ? XP_BOOSTER_MULTIPLIER : 1;
    const lines = [];
    let base = 0;
    const add = (amount, label, code) => {
      base += amount;
      lines.push({ amount, label, code });
    };

    add(won ? MATCH_XP_REWARDS.WIN : MATCH_XP_REWARDS.LOSS, won ? "Победа в матче" : "Поражение в матче", won ? "match_win" : "match_loss");
    if (!isSpy && correctVoters.has(player.id)) add(MATCH_XP_REWARDS.CORRECT_SPY_VOTE, "Верный голос против шпиона", "correct_spy_vote");

    const total = base * multiplier;
    if (total <= 0) continue;

    economy.xp = Math.max(0, Math.floor(Number(economy.xp || 0))) + total;
    economy.level = Math.max(1, Math.floor(economy.xp / 1000) + 1);
    user.updatedAt = new Date().toISOString();
    rewards.push({
      playerId: player.id,
      accountId: user.id,
      total,
      base,
      multiplier,
      boosterActive: booster.active,
      matchId: lobby.matchId,
      lines,
      xp: economy.xp,
      level: economy.level
    });
    console.info(`[xp] granted matchId=${lobby.matchId} code=${lobby.code} userId=${user.id} playerId=${player.id} amount=${total} base=${base} multiplier=${multiplier} boosterActive=${booster.active}`);
  }

  lobby.matchRewardsGranted = true;
  return rewards;
}

function updateUserProgressForGame(lobby, civiliansWin, finalVotes = {}, suspected = []) {
  let changed = false;
  const playerByAccount = new Map(lobby.players.filter((player) => player.accountId).map((player) => [player.accountId, player]));
  for (const user of usersStore.users) {
    const player = playerByAccount.get(user.id);
    if (!player) continue;
    ensureUserProgress(user);
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
  const economyRewards = buildEconomyRewardsForGame(lobby, civiliansWin, finalVotes, suspected);
  const expRewards = awardMatchExpRewards(lobby, civiliansWin, finalVotes);
  if (changed || economyRewards.length || expRewards.length) saveUsersStore();
  return { economyRewards, expRewards };
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

  const { economyRewards, expRewards } = updateUserProgressForGame(lobby, civiliansWin, finalVotes, suspected);
  lobby.phase = "ended";
  lobby.started = false;
  clearTimer(code);

  for (const player of lobby.players) {
    const user = usersStore.users.find((item) => item.id === player.accountId);
    if (user) io.to(player.id).emit("profile:updated", { profile: { user: publicUser(user), guest: false } });
  }

  const finalResult = {
    code: lobby.code,
    host: lobby.host,
    players: lobby.players.map(publicPlayer),
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
    breakdown,
    finalComments: lobby.finalComments || [],
    economyRewards,
    expRewards,
    matchId: lobby.matchId,
    endedAt: new Date().toISOString()
  };
  lobby.finalResult = finalResult;
  io.to(code).emit("gameEnd", finalResult);
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
  resetSkipVotes(lobby);
  lobby.trackHistory = [];
  lobby.suspected = [];
  lobby.finalVotes = null;
  lobby.spyGuess = null;
  lobby.pendingSpyGuess = null;
  lobby.spyGuessTimeLeft = null;
  lobby.spyGuessOptions = [];
  lobby.submittedThisTurn = false;
  lobby.timeLeft = null;
  lobby.turnStage = "waiting";
  lobby.pausedTurnStage = null;
  lobby.finalComments = [];
  lobby.finalResult = null;
  lobby.matchId = null;
  lobby.matchRewardsGranted = false;
}

function markAllPlayersReady(lobby) {
  for (const player of lobby.players || []) {
    player.ready = true;
  }
}

function initializeGame(lobby) {
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
  resetSkipVotes(lobby);
  lobby.trackHistory = [];
  lobby.suspected = [];
  lobby.finalVotes = null;
  lobby.spyGuess = null;
  lobby.pendingSpyGuess = null;
  lobby.spyGuessTimeLeft = null;
  lobby.spyGuessOptions = [];
  lobby.spyGuessMode = null;
  lobby.spyGuessTargetId = null;
  lobby.submittedThisTurn = false;
  lobby.turnStage = "waiting";
  lobby.timeLeft = null;
  lobby.pausedTurnStage = null;
  lobby.chatMessages = [];
  lobby.finalComments = [];
  lobby.finalResult = null;
  lobby.matchId = crypto.randomUUID();
  lobby.matchRewardsGranted = false;
}

function startLobbyGame(lobby) {
  initializeGame(lobby);

  for (const player of lobby.players) {
    sendPrivateGameStart(lobby, io.sockets.sockets.get(player.id) || { id: player.id, emit: (event, payload) => io.to(player.id).emit(event, payload) });
  }

  emitLobbyUpdate(lobby.code);
  startTurn(lobby.code);
}


function publicOpenLobbies(allLobbies = lobbies) {
  return Object.values(allLobbies)
    .filter((lobby) => lobby && lobby.phase === "lobby" && !lobby.started && lobby.isOpen !== false)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .map((lobby) => {
      const hostPlayer = lobby.players.find((player) => player.id === lobby.host) || lobby.players[0];
      const settings = lobby.settings || DEFAULT_SETTINGS;
      const mode = GAME_MODES[settings.gameMode] || GAME_MODES.classic;
      return {
        code: lobby.code,
        name: lobby.name || defaultLobbyName(hostPlayer?.name),
        hostName: hostPlayer?.name || "Хост",
        playerCount: lobby.players.length,
        gameMode: settings.gameMode || "classic",
        modeLabel: mode.label,
        rounds: settings.rounds || DEFAULT_SETTINGS.rounds,
        listenTime: settings.listenTime || DEFAULT_SETTINGS.listenTime,
        maxPlayers: settings.maxPlayers || DEFAULT_SETTINGS.maxPlayers,
        createdAt: lobby.createdAt || ""
      };
    });
}

function createLobbyState(code, hostId, player, options = {}) {
  const fallbackName = defaultLobbyName(player?.name);

  return {
    code,
    name: normalizeLobbyName(options.name, fallbackName),
    isOpen: options.isOpen !== false,
    host: hostId,
    createdAt: new Date().toISOString(),
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
    skipVotes: {},
    skipCompleted: false,
    trackHistory: [],
    suspected: [],
    finalVotes: null,
    spyGuess: null,
    pendingSpyGuess: null,
    spyGuessTimeLeft: null,
    spyGuessOptions: [],
    spyGuessMode: null,
    spyGuessTargetId: null,
    chatMessages: [],
    finalComments: [],
    matchId: null,
    matchRewardsGranted: false,
    submittedThisTurn: false,
    timeLeft: null,
    turnStage: "waiting",
    pausedTurnStage: null,
    settings: normalizeSettings(options.settings || DEFAULT_SETTINGS)
  };
}

function currentSiteOnlineCount() {
  return io.of("/").sockets.size;
}

function emitSiteOnlineCount() {
  io.emit("siteOnline:update", { count: currentSiteOnlineCount() });
}

io.on("connection", (socket) => {
  socket.data.user = null;

  emitSiteOnlineCount();
  socket.emit("globalChat:update", { messages: globalChatMessages });
  socket.emit("siteOnline:update", { count: currentSiteOnlineCount() });

  socket.on("globalChat:get", (cb = () => {}) => {
    cb({ success: true, messages: globalChatMessages });
  });

  socket.on("globalChat:send", ({ name, text } = {}, cb = () => {}) => {
    const messageText = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
    if (!messageText) return cb({ error: "Напиши сообщение" });

    const identity = globalChatIdentity(socket, name);
    const message = {
      id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      ...identity,
      text: messageText,
      createdAt: Date.now()
    };
    globalChatMessages = [...globalChatMessages, message].slice(-MAX_GLOBAL_CHAT_MESSAGES);
    io.emit("globalChat:update", { messages: globalChatMessages });
    cb({ success: true, message });
  });

  socket.on("auth:session", async ({ token, accessToken } = {}, cb = () => {}) => {
    try {
      const sessionUser = findUserByToken(accessToken || token) || socket.request.user || null;
      if (!sessionUser) {
        console.warn("[auth] access restore failed: token missing or expired");
        return cb({ error: "Сессия не найдена" });
      }
      const user = await refreshUserFromDatabase(sessionUser);
      registerAuthenticatedSocket(socket, user);
      console.info(`[auth] restored access session for user=${user.id}`);
      cb({ success: true, profile: profileForSocket(socket), social: getSocialState(user.id) });
    } catch (error) {
      console.error("[auth] access restore failed", error);
      cb({ error: "Сессия не найдена" });
    }
  });

  socket.on("auth:refresh", async ({ refreshToken } = {}, cb = () => {}) => {
    try {
      const refreshed = refreshSession(refreshToken);
      if (!refreshed) return cb({ error: "Сессия истекла" });
      const user = await refreshUserFromDatabase(refreshed.user);
      registerAuthenticatedSocket(socket, user);
      cb({ success: true, ...refreshed.tokens, token: refreshed.tokens.accessToken, profile: profileForSocket(socket), social: getSocialState(user.id) });
    } catch (error) {
      console.error("[auth] refresh failed", error);
      cb({ error: "Сессия истекла" });
    }
  });

  socket.on("auth:guest", async ({ name } = {}, cb = () => {}) => {
    if (socket.request.user) {
      try {
        const user = await refreshUserFromDatabase(socket.request.user);
        registerAuthenticatedSocket(socket, user);
        return cb({ success: true, profile: profileForSocket(socket), social: getSocialState(user.id) });
      } catch (error) {
        console.error("[auth] guest session restore failed", error);
      }
    }
    unregisterAuthenticatedSocket(socket);
    cb({ success: true, profile: profileForSocket(socket), name: normalizeName(name || "Гость") });
  });

  socket.on("auth:register", async ({ username, password, displayName } = {}, cb = () => {}) => {
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
      roles: DEV_USERNAMES.has(normalizedUsername) ? [DEV_ROLE] : [],
      providerName: "",
      avatar: "",
      hasCustomAvatar: false,
      stats: defaultStats(),
      economy: defaultEconomy(),
      salt,
      passwordHash: hash,
      sessions: [],
      createdAt: now,
      updatedAt: now
    };
    usersStore.users.push(user);
    await saveUsersStore();
    registerAuthenticatedSocket(socket, user);
    const tokens = createSession(user);
    cb({ success: true, ...tokens, token: tokens.accessToken, profile: profileForSocket(socket) });
  });

  socket.on("auth:login", ({ username, password } = {}, cb = () => {}) => {
    const normalizedUsername = normalizeUsername(username);
    const user = usersStore.users.find((item) => item.username === normalizedUsername);
    if (!user || !verifyPassword(password, user)) return cb({ error: "Неверный логин или пароль" });
    registerAuthenticatedSocket(socket, user);
    const tokens = createSession(user);
    cb({ success: true, ...tokens, token: tokens.accessToken, profile: profileForSocket(socket) });
  });

  socket.on("auth:logout", async ({ refreshToken, accessToken, token } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (user) {
      const revokeOptions = { save: saveUsersStore };
      if (refreshToken) revokeRefreshToken(user, refreshToken, revokeOptions);
      if (accessToken || token) revokeSessionToken(user, accessToken || token, revokeOptions);
    }
    unregisterAuthenticatedSocket(socket);
    await clearSocketPassportSession(socket);
    cb({ success: true, profile: profileForSocket(socket) });
  });

  socket.on("profile:update", async ({ displayName, username, avatar } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы менять профиль" });
    try {
      const requestedUsername = String(username ?? (user.username || "")).trim();
      const tagResult = validateAccountTag(requestedUsername, user.id);
      if (tagResult.error) return cb({ error: tagResult.error });
      user.username = tagResult.username;
      user.displayName = normalizeName(displayName || user.displayName || user.username);
      if (avatar !== undefined) {
        user.avatar = normalizeAvatar(avatar);
        user.hasCustomAvatar = Boolean(user.avatar);
      }
      await updateUser(user.id, {
        username: user.username,
        displayName: user.displayName,
        ...(avatar !== undefined ? { avatar: user.avatar, hasCustomAvatar: user.hasCustomAvatar } : {})
      });
      user.updatedAt = new Date().toISOString();
      await saveUsersStore();
      syncUserProfileInLobbies(user);
      emitSocialForUserAndFriends(user.id);
      cb({ success: true, profile: profileForSocket(socket) });
    } catch (error) {
      cb({ error: error.message || "Не удалось обновить профиль" });
    }
  });

  socket.on("account:delete", ({ refreshToken } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы удалить его" });
    const userId = user.id;
    if (refreshToken) revokeRefreshToken(user, refreshToken, { save: saveUsersStore });
    const affectedFriendIds = friendIdsFor(userId);
    removeAccountFromActiveLobbies(userId);
    unregisterAuthenticatedSocket(socket);
    socket.request.logout?.(() => {});
    const deleted = deleteUserAccount(userId);
    if (deleted) saveUsersStore();
    for (const friendId of affectedFriendIds) emitSocialForUserAndFriends(friendId);
    cb({ success: true, profile: profileForSocket(socket) });
  });

  socket.on("settings:update", ({ settings } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы сохранять настройки" });
    const safeSettings = settings && typeof settings === "object" ? settings : {};
    user.settings = {
      ...(user.settings || {}),
      appearance: safeSettings.appearance && typeof safeSettings.appearance === "object" ? safeSettings.appearance : user.settings?.appearance,
      gamePreferences: safeSettings.gamePreferences && typeof safeSettings.gamePreferences === "object" ? safeSettings.gamePreferences : user.settings?.gamePreferences,
      lang: typeof safeSettings.lang === "string" ? safeSettings.lang.slice(0, 8) : user.settings?.lang
    };
    user.updatedAt = new Date().toISOString();
    saveUsersStore();
    console.info(`[db] settings write confirmed user=${user.id}`);
    cb({ success: true, profile: profileForSocket(socket) });
  });


  socket.on("economy:get", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы открыть магазин" });
    ensureUserProgress(user);
    const isDev = hasRole(user, DEV_ROLE);
    const catalog = SHOP_CATALOG.filter((item) => isDev || !isDevShopItem(item));
    cb({ success: true, catalog, categories: SHOP_CATEGORIES, rarities: COSMETIC_RARITIES, economy: publicEconomy(user), achievements: ACHIEVEMENTS });
  });

  socket.on("xpBooster:get", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы использовать XP Booster" });
    cb({ success: true, xpBooster: xpBoosterState(user), economy: publicEconomy(user) });
  });

  socket.on("xpBooster:activate", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы использовать XP Booster" });
    const currentState = xpBoosterState(user);
    if (!currentState.canActivate) return cb({ error: "XP Booster перезаряжается", xpBooster: currentState, economy: publicEconomy(user) });
    const now = Date.now();
    user.economy.xpBoosterActiveUntil = new Date(now + XP_BOOSTER_DURATION_MS).toISOString();
    user.economy.xpBoosterCooldownUntil = new Date(now + XP_BOOSTER_COOLDOWN_MS).toISOString();
    user.updatedAt = new Date(now).toISOString();
    saveUsersStore();
    const nextState = xpBoosterState(user, now);
    cb({ success: true, xpBooster: nextState, economy: publicEconomy(user), profile: profileForSocket(socket) });
    io.to(`user:${user.id}`).emit("profile:updated", { profile: profileForSocket(socket) });
  });

  socket.on("dailyReward:get", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы получать ежедневную награду" });
    cb({ success: true, ...dailyRewardState(user) });
  });

  socket.on("dailyReward:claim", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы получать ежедневную награду" });
    const currentState = dailyRewardState(user);
    if (!currentState.canClaim) return cb({ error: "Новая награда будет доступна позже", dailyReward: currentState });
    addVinylTransaction(user, currentState.rewardAmount, "daily_reward", { intervalHours: 24, cycleDay: currentState.cycleDay });
    user.economy.dailyRewardStreak = currentState.cycleDay;
    user.economy.lastDailyRewardAt = new Date().toISOString();
    user.updatedAt = user.economy.lastDailyRewardAt;
    saveUsersStore();
    const nextState = dailyRewardState(user);
    cb({ success: true, amount: currentState.rewardAmount, economy: publicEconomy(user), dailyReward: nextState, profile: profileForSocket(socket) });
    io.to(`user:${user.id}`).emit("profile:updated", { profile: profileForSocket(socket) });
  });

  socket.on("shop:purchase", ({ itemId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы покупать косметику" });
    ensureUserProgress(user);
    const item = catalogItemById(String(itemId || ""));
    if (!item) return cb({ error: "Предмет не найден" });
    if (item.achievementOnly) return cb({ error: "Этот предмет открывается достижением" });
    if (isDevShopItem(item)) return cb({ error: "DEV-предметы не продаются" });
    if (user.economy.ownedCosmetics.includes(item.id)) return cb({ error: "Уже в коллекции" });
    const isDev = hasRole(user, DEV_ROLE);
    if (!isDev && user.economy.vinyls < item.price) return cb({ error: "Недостаточно Vinyls" });
    if (!isDev) addVinylTransaction(user, -item.price, "shop_purchase", { itemId: item.id });
    user.economy.ownedCosmetics.push(item.id);
    user.updatedAt = new Date().toISOString();
    saveUsersStore();
    cb({ success: true, item, economy: publicEconomy(user), profile: profileForSocket(socket) });
    io.to(`user:${user.id}`).emit("profile:updated", { profile: profileForSocket(socket) });
  });

  socket.on("shop:equip", ({ itemId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы экипировать косметику" });
    ensureUserProgress(user);
    const item = catalogItemById(String(itemId || ""));
    if (!item) return cb({ error: "Предмет не найден" });
    if (!hasRole(user, DEV_ROLE) && !user.economy.ownedCosmetics.includes(item.id)) return cb({ error: "Сначала купи или открой предмет" });
    const category = SHOP_CATEGORIES.find((entry) => entry.id === item.category);
    if (!category) return cb({ error: "Категория недоступна" });
    user.economy.equipped[category.equipSlot] = item.id;
    user.updatedAt = new Date().toISOString();
    syncUserProfileInLobbies(user);
    for (const lobby of Object.values(lobbies)) {
      const player = lobby.players.find((entry) => entry.id === socket.id || (entry.accountId && entry.accountId === user.id));
      if (!player) continue;
      player.equippedCosmetics = { ...(user.economy.equipped || {}) };
      console.log(`[CS] player equipped:${JSON.stringify(player.equippedCosmetics || {})}`);
      io.to(lobby.code).emit("player:cosmetics:update", {
        playerId: player.id,
        equippedCosmetics: { ...(user.economy.equipped || {}) }
      });
    }
    saveUsersStore();
    cb({ success: true, item, economy: publicEconomy(user), profile: profileForSocket(socket) });
    io.to(`user:${user.id}`).emit("profile:updated", { profile: profileForSocket(socket) });
  });

  socket.on("dev:command", ({ command } = {}, cb = () => {}) => {
    const actor = socket.data.user;
    if (!actor || !hasRole(actor, DEV_ROLE)) return cb({ error: "Недостаточно прав" });
    const parsed = parseDevCommandInput(command);
    if (parsed.error) return cb({ error: parsed.error });
    if (parsed.type === "help") {
      return cb({
        success: true,
        output: [
          "-help",
          "-level up @username to 25",
          "-give @username nickname color \"white chrome\"",
          "-give @username avatar frame \"pulse ring\"",
          "-give @username profile banner \"sunset boulevard\"",
          "-give @username shop item \"any exact item name\"",
          "-vinyls add @username 5000",
          "-xp set @username 9000",
          "-give @username vinyls 5000",
          "-give @username xp 9000",
          "-list nickname colors",
          "-list avatar frames",
          "-list profile banners",
          "-list all shop items",
          "-rainbow @username"
          ,"-create promocode \"WELCOME\" reward:vinyls:500 limit:100 enddate:25.06.26"
        ]
      });
    }
    if (parsed.type === "createPromoCode") {
      const promoCode = String(parsed.code || "").trim().toUpperCase();
      if (!promoCode) return cb({ error: "Missing required arguments" });
      if (!["vinyls", "xp", "item"].includes(String(parsed.rewardType || "").toLowerCase())) return cb({ error: "Invalid reward format" });
      const rewardType = String(parsed.rewardType).toLowerCase();
      const rewardValue = String(parsed.rewardValue || "").trim();
      if ((rewardType === "vinyls" || rewardType === "xp") && !/^\d+$/.test(rewardValue)) return cb({ error: "Invalid reward format" });
      if (rewardType === "item" && !catalogItemById(rewardValue)) return cb({ error: "Invalid reward format" });
      const expiresAt = parsePromoDate(parsed.endDate);
      if (!expiresAt) return cb({ error: "Invalid date format" });
      if (!parsed.limit || parsed.limit < 1) return cb({ error: "Missing required arguments" });
      pool.query(
        `INSERT INTO promo_codes (code, reward_type, reward_value, usage_limit, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO NOTHING
         RETURNING *`,
        [promoCode, rewardType, rewardValue, Math.floor(parsed.limit), expiresAt, Number(actor.id)]
      ).then(({ rows }) => {
        if (!rows[0]) return cb({ error: "Promo code already exists" });
        const row = rows[0];
        cb({ success: true, output: ["✔ Promo created", "", `Code: ${row.code}`, `Reward: ${rewardType === "item" ? rewardValue : `+${rewardValue} ${rewardType === "xp" ? "XP" : "Vinyls"}`}`, `Limit: ${row.usage_limit}`, `Expires: ${parsed.endDate}`] });
      }).catch(() => cb({ error: "Promo create failed" }));
      return;
    }
    if (["listNicknameColors", "listAvatarFrames", "listProfileBanners", "listAllShopItems"].includes(parsed.type)) {
      const byCategory = {
        listNicknameColors: "nicknameColor",
        listAvatarFrames: "avatarFrame",
        listProfileBanners: "profileBanner"
      };
      if (parsed.type === "listAllShopItems") {
        const allItems = SHOP_CATALOG.map((entry) => `${entry.name} [${entry.category}]`).sort((a, b) => a.localeCompare(b));
        return cb({ success: true, output: [`Shop items (${allItems.length}):`, ...allItems] });
      }
      const categoryId = byCategory[parsed.type];
      const names = SHOP_CATALOG.filter((entry) => entry.category === categoryId).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
      return cb({ success: true, output: [`${categoryId} (${names.length}):`, ...names] });
    }
    const target = findUserByNicknameOrUsername(parsed.username);
    if (!target) return cb({ error: "Пользователь не найден" });
    ensureUserProgress(target);
    if (parsed.type === "setLevel") {
      target.economy.level = Math.max(1, Math.min(999, Math.floor(parsed.level)));
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: level => ${target.economy.level}`] });
    }
    if (parsed.type === "giveNicknameColor") {
      const wanted = normalizeShopItemName(parsed.colorName);
      const item = SHOP_CATALOG.find((entry) => entry.category === "nicknameColor" && normalizeShopItemName(entry.name) === wanted);
      if (!item) return cb({ error: "Цвет не найден в магазине" });
      grantShopItemToUser(target, item);
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: выдан и экипирован ${item.name}`] });
    }
    if (["giveAvatarFrame", "giveProfileBanner", "giveShopItem"].includes(parsed.type)) {
      const wanted = normalizeShopItemName(parsed.itemName);
      const categoryByType = { giveAvatarFrame: "avatarFrame", giveProfileBanner: "profileBanner" };
      const item = parsed.type === "giveShopItem"
        ? SHOP_CATALOG.find((entry) => normalizeShopItemName(entry.name) === wanted)
        : SHOP_CATALOG.find((entry) => entry.category === categoryByType[parsed.type] && normalizeShopItemName(entry.name) === wanted);
      if (!item) return cb({ error: "Предмет не найден в магазине" });
      grantShopItemToUser(target, item);
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: выдан и экипирован ${item.name}`] });
    }
    if (parsed.type === "addVinyls") {
      addVinylTransaction(target, Math.max(1, Math.floor(parsed.amount)), "dev_grant");
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: vinyls +${Math.floor(parsed.amount)}`] });
    }
    if (parsed.type === "setXp") {
      target.economy.xp = Math.max(0, Math.floor(parsed.xp));
      target.economy.level = Math.max(1, Math.floor(target.economy.xp / 1000) + 1);
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: xp => ${target.economy.xp}, level => ${target.economy.level}`] });
    }
    if (parsed.type === "giveVinyls") {
      addVinylTransaction(target, Math.max(1, Math.floor(parsed.amount)), "dev_grant");
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: vinyls +${Math.floor(parsed.amount)}`] });
    }
    if (parsed.type === "giveXp") {
      target.economy.xp = Math.max(0, target.economy.xp + Math.floor(parsed.xp));
      target.economy.level = Math.max(1, Math.floor(target.economy.xp / 1000) + 1);
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: xp +${Math.floor(parsed.xp)}, level => ${target.economy.level}`] });
    }
    if (parsed.type === "rainbowNicknameColor") {
      const available = SHOP_CATALOG.filter((entry) => entry.category === "nicknameColor");
      const item = available[Math.floor(Math.random() * available.length)];
      if (!item) return cb({ error: "Цвета не найдены" });
      if (!target.economy.ownedCosmetics.includes(item.id)) target.economy.ownedCosmetics.push(item.id);
      target.economy.equipped.nicknameColor = item.id;
      target.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${target.id}`).emit("profile:updated", { profile: { user: publicUser(target), guest: false } });
      return cb({ success: true, output: [`${target.username}: случайный цвет => ${item.name}`] });
    }
    return cb({ error: "Команда не выполнена" });
  });

  socket.on("social:get", (cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы открыть друзей" });
    cb({ success: true, ...getSocialState(user.id) });
  });

  socket.on("promo:redeem", async ({ code } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы активировать промокод" });
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode) return cb({ error: "Промокод не найден" });
    ensureUserProgress(user);
    try {
      const { rows } = await pool.query("SELECT * FROM promo_codes WHERE code = $1 LIMIT 1", [normalizedCode]);
      const promo = rows[0];
      if (!promo || !promo.active) return cb({ error: "Промокод не найден" });
      const now = Date.now();
      if (Date.parse(promo.expires_at) < now) return cb({ error: "Промокод истёк" });
      if (Number(promo.used_count || 0) >= Number(promo.usage_limit || 0)) return cb({ error: "Лимит использований исчерпан" });
      const already = await pool.query("SELECT id FROM promo_redemptions WHERE user_id = $1 AND promo_id = $2 LIMIT 1", [Number(user.id), Number(promo.id)]);
      if (already.rows[0]) return cb({ error: "Промокод уже использован" });
      const rewardLabel = grantPromoReward(user, promo);
      await pool.query("BEGIN");
      await pool.query("INSERT INTO promo_redemptions (user_id, promo_id) VALUES ($1, $2)", [Number(user.id), Number(promo.id)]);
      await pool.query("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1", [Number(promo.id)]);
      await pool.query("COMMIT");
      user.updatedAt = new Date().toISOString();
      saveUsersStore();
      io.to(`user:${user.id}`).emit("profile:updated", { profile: profileForSocket(socket) });
      cb({ success: true, message: `Промокод активирован: ${rewardLabel}`, economy: publicEconomy(user), profile: profileForSocket(socket) });
    } catch (error) {
      await pool.query("ROLLBACK").catch(() => {});
      cb({ error: error?.message === "INVALID_PROMO_ITEM" ? "Промокод не найден" : "Промокод не найден" });
    }
  });

  socket.on("profile:view", async ({ accountId } = {}, cb = () => {}) => {
    const userId = String(accountId || "").trim();
    if (!userId) return cb({ error: "Профиль игрока недоступен" });
    const user = findUserById(userId) || await getUser(userId);
    if (!user) return cb({ error: "Профиль игрока не найден" });
    cb({ success: true, user: publicUser(user) });
  });

  socket.on("friend:request", ({ nickname } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт, чтобы добавлять друзей" });
    const receiver = findUserByNicknameOrUsername(nickname);
    if (!receiver) return cb({ error: "Пользователь не найден" });
    const result = createFriendRequest(user.id, receiver.id);
    cb(result.success ? { success: true } : result);
  });

  socket.on("friend:accept", ({ requestId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт" });
    cb(acceptFriendRequest(user.id, String(requestId || "")));
  });

  socket.on("friend:decline", ({ requestId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт" });
    cb(declineFriendRequest(user.id, String(requestId || "")));
  });

  socket.on("friend:remove", ({ friendId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    if (!user) return cb({ error: "Войди в аккаунт" });
    cb(removeFriend(user.id, String(friendId || "")));
  });

  socket.on("friend:lobby:invite", ({ friendId, code } = {}, cb = () => {}) => {
    const user = socket.data.user;
    const targetId = String(friendId || "");
    if (!user) return cb({ error: "Войди в аккаунт" });
    if (!usersAreFriends(user.id, targetId)) return cb({ error: "Вы не друзья" });
    const lobbyCode = normalizeCode(code);
    if (!lobbyCode || !lobbies[lobbyCode] || !lobbies[lobbyCode].players.some((player) => player.accountId === user.id || player.id === socket.id)) {
      return cb({ error: "Ты не в лобби" });
    }
    io.to(`user:${targetId}`).emit("social:notification", { type: "lobby:invite", code: lobbyCode, message: `${user.displayName || user.username} зовет в лобби ${lobbyCode}` });
    cb({ success: true });
  });

  socket.on("dm:history", ({ friendId } = {}, cb = () => {}) => {
    const user = socket.data.user;
    const targetId = String(friendId || "");
    if (!user) return cb({ error: "Войди в аккаунт" });
    if (!usersAreFriends(user.id, targetId)) return cb({ error: "Вы не друзья" });
    const changed = markDirectRead(user.id, targetId);
    if (changed) {
      emitSocialState(user.id);
      io.to(`user:${targetId}`).emit("dm:read", { friendId: user.id });
    }
    cb({ success: true, friendId: targetId, messages: getDirectHistory(user.id, targetId) });
  });

  socket.on("dm:send", ({ friendId, text } = {}, cb = () => {}) => {
    const user = socket.data.user;
    const targetId = String(friendId || "");
    const body = String(text || "").trim().slice(0, MAX_DIRECT_MESSAGE_LENGTH);
    if (!user) return cb({ error: "Войди в аккаунт" });
    if (!body) return cb({ error: "Напиши сообщение" });
    if (!usersAreFriends(user.id, targetId)) return cb({ error: "Вы не друзья" });
    const receiverOnline = userSockets.has(targetId);
    const message = {
      id: crypto.randomUUID(),
      conversationId: conversationIdFor(user.id, targetId),
      senderId: user.id,
      receiverId: targetId,
      text: body,
      status: receiverOnline ? "delivered" : "pending",
      createdAt: new Date().toISOString()
    };
    usersStore.directMessages.push(message);
    if (usersStore.directMessages.length > MAX_DIRECT_MESSAGES) usersStore.directMessages = usersStore.directMessages.slice(-MAX_DIRECT_MESSAGES);
    saveUsersStore();
    console.info(`[db] direct message insert confirmed conversation=${message.conversationId} message=${message.id}`);
    const senderPayload = { ...message, mine: true };
    const receiverPayload = { ...message, mine: false };
    cb({ success: true, message: senderPayload });
    io.to(`user:${user.id}`).emit("dm:message", { friendId: targetId, message: senderPayload });
    io.to(`user:${targetId}`).emit("dm:message", { friendId: user.id, message: receiverPayload });
    io.to(`user:${targetId}`).emit("social:notification", { type: "dm:new", friendId: user.id, message: `Новое сообщение от ${user.displayName || user.username}` });
    emitSocialState(targetId);
  });

  socket.on("getOpenLobbies", (cb = () => {}) => {
    cb({ success: true, lobbies: publicOpenLobbies() });
  });

  socket.on("createLobby", ({ name, reconnectToken, settings, lobbyName, isOpen } = {}, cb = () => {}) => {
    const code = generateCode();
    const player = playerFromSocket(socket, name, null, reconnectToken);

    lobbies[code] = createLobbyState(code, socket.id, player, {
      name: lobbyName,
      isOpen,
      settings
    });

    socket.join(code);
    cb({ code, playerId: socket.id });
    emitLobbyUpdate(code);
  });

  socket.on("joinLobby", ({ code, name, reconnectToken }, cb = () => {}) => {
    const roomCode = normalizeCode(code);
    const lobby = lobbies[roomCode];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });
    if (lobby.players.some((player) => player.id === socket.id)) {
      return cb({ success: true, code: roomCode, playerId: socket.id });
    }
    if (lobby.players.length >= (lobby.settings.maxPlayers || DEFAULT_MAX_PLAYERS)) return cb({ error: "Комната заполнена" });

    socket.join(roomCode);
    lobby.players.push(playerFromSocket(socket, name, lobby, reconnectToken));

    cb({ success: true, code: roomCode, playerId: socket.id });
    emitLobbyUpdate(roomCode);
  });

  socket.on("leaveLobby", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (hasActiveGameSession(lobby)) return cb({ error: "Во время игры выйти можно только закрыв вкладку" });

    handlePlayerDeparture(lobby, socket);
    cb({ success: true });
  });

  socket.on("updateSettings", ({ code, settings }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Настройки может менять только хост" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });

    const nextSettings = normalizeSettings({ ...lobby.settings, ...settings });
    if (nextSettings.maxPlayers < lobby.players.length) {
      return cb({ error: `В лобби уже ${lobby.players.length} игроков — выбери лимит выше` });
    }

    lobby.settings = nextSettings;
    cb({ success: true, settings: lobby.settings });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("updateLobbyMeta", ({ code, name, isOpen }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "Название и открытость меняет только хост" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });

    if (name !== undefined) {
      lobby.name = normalizeLobbyName(name, defaultLobbyName(lobby.players.find((player) => player.id === lobby.host)?.name));
    }
    if (isOpen !== undefined) {
      lobby.isOpen = Boolean(isOpen);
    }

    cb({ success: true, name: lobby.name, isOpen: lobby.isOpen !== false });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("setReady", ({ code, ready }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });
    const player = lobby.players.find((item) => item.id === socket.id);
    if (!player) return cb({ error: "Ты не в этой комнате" });
    player.ready = Boolean(ready);
    cb({ success: true, ready: player.ready });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("updateName", ({ code, name }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });
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
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });
    if (lobby.players.length < MIN_LOBBY_PLAYERS) return cb({ error: "Нужно минимум 3 игрока" });
    if (lobby.players.some((player) => !player.ready)) {
      return cb({ error: "Все игроки должны нажать «Готов»" });
    }

    startLobbyGame(lobby);
    cb({ success: true });
  });

  socket.on("forceStartGame", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.host !== socket.id) return cb({ error: "FORCE START доступен только хосту" });
    if (lobby.started || lobby.phase !== "lobby") return cb({ error: "Игра уже началась" });
    if (lobby.players.length < MIN_LOBBY_PLAYERS) return cb({ error: "Нужно минимум 3 игрока" });

    markAllPlayersReady(lobby);
    startLobbyGame(lobby);
    cb({ success: true, forced: true });
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


  socket.on("chat:send", ({ code, text }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (!["lobby", "playing", "voting", "spyGuess"].includes(lobby.phase)) {
      return cb({ error: "Чат сейчас недоступен" });
    }
    const player = lobby.players.find((item) => item.id === socket.id);
    if (!player) return cb({ error: "Ты не в этой комнате" });

    const messageText = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
    if (!messageText) return cb({ error: "Напиши сообщение" });

    const message = {
      id: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      playerId: socket.id,
      playerName: player.name,
      roles: player.roles || [],
      permissions: player.permissions || {},
      equippedCosmetics: { ...(player.equippedCosmetics || {}) },
      text: messageText,
      createdAt: Date.now()
    };
    console.log(`[CS] player equipped:${JSON.stringify(player.equippedCosmetics || {})}`);
    lobby.chatMessages = [...(lobby.chatMessages || []), message].slice(-MAX_CHAT_MESSAGES);
    io.to(lobby.code).emit("chat:update", { messages: lobby.chatMessages });
    cb({ success: true, message });
  });


  socket.on("finalComment:send", ({ code, text }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby) return cb({ error: "Комната не найдена" });
    if (lobby.phase !== "ended") return cb({ error: "Комментарии доступны после игры" });
    const player = lobby.players.find((item) => item.id === socket.id);
    if (!player) return cb({ error: "Ты не в этой комнате" });

    const messageText = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_FINAL_COMMENT_LENGTH);
    if (!messageText) return cb({ error: "Напиши одну фразу" });

    const comment = {
      id: `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      playerId: socket.id,
      playerName: player.name,
      roles: player.roles || [],
      permissions: player.permissions || {},
      text: messageText,
      createdAt: Date.now()
    };
    lobby.finalComments = [
      ...(lobby.finalComments || []).filter((item) => item.playerId !== socket.id),
      comment
    ].slice(-MAX_FINAL_COMMENTS);
    io.to(lobby.code).emit("finalComments:update", { comments: lobby.finalComments });
    cb({ success: true, comment, comments: lobby.finalComments });
  });

  socket.on("playTrack", async ({ code, url }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    const submission = normalizeTrackSubmission(url);
    if (!lobby || lobby.phase !== "playing") return cb({ error: "Сейчас нельзя отправить трек" });
    if (lobby.order[lobby.currentTurnIndex] !== socket.id) return cb({ error: "Сейчас ход другого игрока" });
    if (lobby.submittedThisTurn) return cb({ error: "Трек уже отправлен" });
    if (!submission.valid) return cb({ error: "Вставь ссылку YouTube/SoundCloud или напиши исполнителя и трек" });

    lobby.submittedThisTurn = true;
    if (submission.source === "library" && submission.searchQuery) {
      const resolvedUrl = await resolveYouTubeSearchUrl(submission.searchQuery);
      if (resolvedUrl) submission.url = resolvedUrl;
    }
    const trackUrl = submission.url;

    const player = lobby.players.find((item) => item.id === socket.id);
    lobby.currentTrackReactions = {};
    resetSkipVotes(lobby);
    lobby.lastTrack = {
      id: `${lobby.round}-${lobby.currentTurnIndex + 1}-${Date.now()}`,
      url: trackUrl,
      searchQuery: submission.searchQuery || "",
      source: submission.source,
      playerId: socket.id,
      playerName: player?.name || "Игрок",
      round: lobby.round,
      turnNumber: lobby.currentTurnIndex + 1
    };
    lobby.trackHistory.push({ ...lobby.lastTrack, reactions: {} });

    io.to(lobby.code).emit("newTrack", { ...lobby.lastTrack, reactionCounts: {}, skipVote: getSkipVoteState(lobby) });
    cb({ success: true });
    startListeningTimer(lobby.code);
  });

  socket.on("skipTrackVote", ({ code }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "playing" || !lobby.lastTrack || !["listening", "paused"].includes(lobby.turnStage)) {
      return cb({ error: "Сейчас нельзя пропустить трек" });
    }
    if (!lobby.players.some((player) => player.id === socket.id && !player.disconnected)) {
      return cb({ error: "Ты не в этой комнате" });
    }
    if (lobby.lastTrack.playerId === socket.id) {
      return cb({ error: "Нельзя пропускать свой трек" });
    }
    if (lobby.skipCompleted) {
      return cb({ error: "Трек уже пропускается" });
    }

    lobby.skipVotes = lobby.skipVotes || {};
    if (!lobby.skipVotes[socket.id]) {
      lobby.skipVotes[socket.id] = Date.now();
    }

    const skipState = getSkipVoteState(lobby);
    io.to(lobby.code).emit("skipVoteUpdate", skipState);
    cb({ success: true, skipVote: skipState });
    completeSkipVote(lobby);
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

  socket.on("submitSpyGuess", ({ code, guess, optionId }, cb = () => {}) => {
    const lobby = lobbies[normalizeCode(code)];
    if (!lobby || lobby.phase !== "spyGuess") return cb({ error: "Сейчас нельзя угадывать тему" });
    if (!lobby.players.some((player) => player.id === socket.id)) return cb({ error: "Ты не в этой комнате" });
    if (!lobby.spies.includes(socket.id) || lobby.spyGuessTargetId !== socket.id) return cb({ error: "Тему угадывает только выбранный шпион" });
    if (lobby.spyGuessMode !== "spy") return cb({ error: "Тема уже выбрана автоматически" });

    const selectedOptionId = String(optionId || guess || "").trim();
    const selectedOption = (lobby.spyGuessOptions || []).find((option) => option.id === selectedOptionId);
    if (!selectedOption) return cb({ error: "Выбери один из вариантов темы" });
    if (lobby.spyGuess) return cb({ error: "Версия уже отправлена" });

    clearTimer(lobby.code);
    const player = lobby.players.find((item) => item.id === socket.id);
    const spyGuess = {
      text: selectedOption.text,
      playerId: socket.id,
      playerName: player?.name || "Шпион",
      skipped: false,
      correct: Boolean(selectedOption.correct),
      optionId: selectedOption.id
    };
    lobby.spyGuess = spyGuess;

    cb({ success: true, correct: spyGuess.correct });
    io.to(lobby.code).emit("spyGuessPending", { guess: { ...spyGuess, correct: undefined } });
    finishGame(lobby.code, lobby.suspected || [], lobby.finalVotes || null, spyGuess);
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
    const isPlayer = lobby.players.some((player) => player.id === socket.id);
    const canReturnAfterGame = lobby.phase === "ended" && isPlayer;
    if (lobby.host !== socket.id && !canReturnAfterGame) return cb({ error: "Вернуть игру в лобби может только хост" });

    if (lobby.phase === "ended" && isPlayer) {
      socket.emit("returnedToLobby", { lobby: publicLobby(lobby) });
      return cb({ success: true, localOnly: true, lobby: publicLobby(lobby) });
    }

    clearTimer(lobby.code);
    resetLobbyToWaiting(lobby);
    cb({ success: true });
    emitLobbyUpdate(lobby.code);
  });

  socket.on("reconnectGame", (payload = {}, cb = () => {}) => {
    cb(reconnectPlayerToGame(socket, payload));
  });

  socket.on("disconnect", () => {
    const disconnectedUserId = socket.data.user?.id || null;
    unregisterAuthenticatedSocket(socket);
    emitSiteOnlineCount();
    for (const code of Object.keys(lobbies)) {
      const lobby = lobbies[code];
      const wasInLobby = lobby.players.some((player) => player.id === socket.id);
      if (!wasInLobby) continue;

      if (hasActiveGameSession(lobby)) {
        schedulePlayerDeparture(lobby, socket);
      } else {
        handlePlayerDeparture(lobby, socket, { leaveRoom: false });
      }
    }
    if (disconnectedUserId) emitSocialForUserAndFriends(disconnectedUserId);
  });
});


const youtubeSearchCache = new Map();
const YOUTUBE_SEARCH_CACHE_TTL_MS = 1000 * 60 * 30;

function extractFirstYouTubeVideoId(html = "") {
  const rendererMatch = html.match(/"videoRenderer"\s*:\s*\{[\s\S]{0,2400}?"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
  if (rendererMatch) return rendererMatch[1];
  const watchMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  return watchMatch ? watchMatch[1] : "";
}

async function resolveYouTubeSearchUrl(query, { fetchImpl = globalThis.fetch } = {}) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (normalizedQuery.length < 2 || typeof fetchImpl !== "function") return "";
  const cached = youtubeSearchCache.get(normalizedQuery.toLowerCase());
  if (cached && Date.now() - cached.createdAt < YOUTUBE_SEARCH_CACHE_TTL_MS) return cached.url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetchImpl(`https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedQuery)}`, {
      signal: controller.signal,
      headers: {
        "accept-language": "ru,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; MusicSpyBot/1.0; +https://musicspy.online/)"
      }
    });
    if (!response.ok) return "";
    const html = await response.text();
    const videoId = extractFirstYouTubeVideoId(html);
    if (!videoId) return "";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    youtubeSearchCache.set(normalizedQuery.toLowerCase(), { url, createdAt: Date.now() });
    return url;
  } catch (error) {
    console.warn(`YouTube search failed for "${normalizedQuery}":`, error?.message || error);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTrackSubmission(input) {
  const raw = String(input || "").trim().replace(/\s+/g, " ");
  if (!raw) return { valid: false, url: "", searchQuery: "", source: "empty" };
  if (isSupportedTrackUrl(raw)) return { valid: true, url: raw, searchQuery: "", source: "url" };
  const looksLikeUnsupportedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (looksLikeUnsupportedUrl) return { valid: false, url: raw, searchQuery: "", source: "unsupported-url" };
  const query = raw.slice(0, 120);
  if (query.length < 2) return { valid: false, url: raw, searchQuery: "", source: "short-query" };
  return {
    valid: true,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    searchQuery: query,
    source: "library"
  };
}

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
  return THEMES[Math.floor(Math.random() * THEMES.length)];
}

if (require.main === module) {
  initializePersistentState()
    .then(() => {
      server.listen(process.env.PORT || 3000, () => {
        console.log("Music Spy server running; users store: PostgreSQL");
      });
    })
    .catch((error) => {
      console.error("Failed to initialize PostgreSQL persistence", error);
      process.exit(1);
    });
}

module.exports = {
  ALLOWED_REACTIONS,
  GAME_MODES,
  THEMES,
  buildFinalBreakdown,
  remapFinalResultPlayerId,
  buildThemeGuessOptions,
  normalizeGuess,
  normalizeSettings,
  markAllPlayersReady,
  initializeGame,
  countReactions,
  getSkipVoteState,
  shouldCompleteSkip,
  resetSkipVotes,
  getActiveTurnOrder,
  removePlayerFromLobby,
  handlePlayerDeparture,
  createLobbyState,
  resetLobbyToWaiting,
  hasActiveGameSession,
  playerFromSocket,
  normalizeAvatar,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  normalizeOAuthProfile,
  buildOAuthTokenRequest,
  buildOAuthSuccessRedirect,
  buildOAuthErrorRedirect,
  resolveDataDir,
  createFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getSocialState,
  pauseTurnTimer,
  resumeTurnTimer,
  adjustTurnTimer,
  publicOpenLobbies,
  validateAccountTag,
  COSMETIC_RARITIES,
  SHOP_CATEGORIES,
  SHOP_CATALOG,
  ACHIEVEMENTS,
  defaultEconomy,
  normalizeEconomy,
  ensureUserProgress,
  addVinylTransaction,
  xpBoosterState,
  buildEconomyRewardsForGame,
  normalizeTrackSubmission,
  extractFirstYouTubeVideoId,
  resolveYouTubeSearchUrl
};
