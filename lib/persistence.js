const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const RENDER_PERSISTENT_DIR = "/var/data";
const EMPTY_USERS_STORE = Object.freeze({ users: [], friendships: [], friendRequests: [], directMessages: [] });

let initialized = false;
let initPromise = null;

function defaultStats(row = {}) {
  return {
    games: Number(row.games_played || 0),
    wins: Number(row.wins || 0),
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
    vinylsEarned: 0,
    losses: Number(row.losses || 0)
  };
}

function defaultEconomy(row = {}) {
  return {
    vinyls: Number(row.coins || 0),
    level: 1,
    xp: 0,
    ownedCosmetics: [],
    equipped: {},
    achievements: {},
    transactions: [],
    lastDailyRewardAt: null,
    dailyRewardStreak: 0
  };
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstOAuthIdentity(user = {}) {
  const identity = asArray(user.oauth)[0];
  if (identity?.provider && identity?.providerId) return identity;
  if (user.provider && user.providerId) return { provider: user.provider, providerId: user.providerId };
  return { provider: "local", providerId: user.username || String(user.id || "") };
}

function profileUsername(profile = {}) {
  return String(profile.username || profile.displayName || profile.email || "").trim().slice(0, 100) || null;
}

function profileAvatar(profile = {}) {
  return String(profile.avatar || profile.photos?.[0]?.value || "").trim().slice(0, 256 * 1024) || null;
}

function providerDisplayName(profile = {}) {
  return String(profile.providerName || profile.displayName || profile.username || profile.email || "").trim().slice(0, 100) || null;
}

function normalizeOAuthIdentity(identity = {}, fallback = {}) {
  const provider = String(identity.provider || fallback.provider || "").trim();
  const providerId = String(identity.providerId || identity.provider_id || fallback.providerId || "").trim();
  if (!provider || !providerId) return null;
  return {
    provider,
    providerId,
    email: String(identity.email || fallback.email || "").trim().toLowerCase(),
    providerName: String(identity.providerName || fallback.providerName || "").trim(),
    linkedAt: identity.linkedAt || fallback.linkedAt || new Date().toISOString(),
    lastLoginAt: identity.lastLoginAt || fallback.lastLoginAt || null
  };
}

function mergeOAuthIdentities(existing = [], nextIdentity = null) {
  const merged = [];
  const indexByKey = new Map();
  for (const raw of asArray(existing)) {
    const identity = normalizeOAuthIdentity(raw);
    if (!identity) continue;
    const key = `${identity.provider}:${identity.providerId}`;
    indexByKey.set(key, merged.length);
    merged.push(identity);
  }
  if (nextIdentity) {
    const identity = normalizeOAuthIdentity(nextIdentity);
    if (identity) {
      const key = `${identity.provider}:${identity.providerId}`;
      const index = indexByKey.get(key);
      if (index === undefined) merged.push(identity);
      else merged[index] = { ...merged[index], ...identity, linkedAt: merged[index].linkedAt || identity.linkedAt };
    }
  }
  return merged;
}

function rowToUser(row, inventory = []) {
  const stats = { ...defaultStats(row), ...asObject(row.stats) };
  const economy = { ...defaultEconomy(row), ...asObject(row.economy) };
  const owned = new Set([...asArray(economy.ownedCosmetics).map(String), ...inventory.map(String)]);
  economy.ownedCosmetics = Array.from(owned);
  economy.vinyls = Number(economy.vinyls ?? row.coins ?? 0);

  const provider = row.provider || "local";
  const providerId = row.provider_id || String(row.id);
  const username = row.username || `${provider}_${providerId}`;
  const primaryIdentity = normalizeOAuthIdentity({
    provider,
    providerId,
    email: row.email || "",
    providerName: row.provider_name || "",
    linkedAt: row.created_at,
    lastLoginAt: row.last_login_at
  });
  const oauth = mergeOAuthIdentities(row.oauth, provider === "local" ? null : primaryIdentity);

  return {
    id: String(row.id),
    username,
    displayName: row.display_name || username,
    providerName: row.provider_name || primaryIdentity?.providerName || "",
    avatar: row.avatar || "",
    hasCustomAvatar: Boolean(row.has_custom_avatar),
    provider,
    providerId,
    roles: asArray(row.roles),
    stats,
    economy,
    settings: asObject(row.settings),
    salt: row.salt || "",
    passwordHash: row.password_hash || "",
    sessions: asArray(row.sessions),
    oauth,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at || row.created_at)
  };
}

function friendshipKey(userAId, userBId) {
  return [String(userAId || ""), String(userBId || "")].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).join(":");
}

function resolveDataDir(env = process.env, fsImpl = fs) {
  const explicitDataDir = String(env.MUSICSPY_DATA_DIR || env.DATA_DIR || "").trim();
  if (explicitDataDir) return path.resolve(explicitDataDir);

  const renderDiskMount = String(env.RENDER_DISK_MOUNT_PATH || "").trim();
  const persistentCandidates = [renderDiskMount, RENDER_PERSISTENT_DIR].filter(Boolean);
  const persistentRoot = persistentCandidates.find((candidate) => fsImpl.existsSync(candidate));
  if (persistentRoot) return path.join(persistentRoot, "musicspy");

  return DEFAULT_DATA_DIR;
}

function normalizeFriendships(parsed = {}, users = []) {
  const seen = new Set();
  const friendships = [];
  const add = (userAId, userBId, createdAt = new Date(0).toISOString()) => {
    if (!userAId || !userBId || userAId === userBId) return;
    const key = friendshipKey(userAId, userBId);
    if (seen.has(key)) return;
    const [firstUserId, secondUserId] = key.split(":");
    friendships.push({ id: key, userAId: firstUserId, userBId: secondUserId, createdAt });
    seen.add(key);
  };

  for (const friendship of Array.isArray(parsed.friendships) ? parsed.friendships : []) {
    add(friendship.userAId, friendship.userBId, friendship.createdAt);
  }
  for (const user of users) {
    for (const friendId of Array.isArray(user.friends) ? user.friends : []) add(user.id, friendId, user.updatedAt || user.createdAt);
  }

  return friendships;
}

function normalizeUserStore(parsed = {}) {
  const users = Array.isArray(parsed.users) ? parsed.users : [];
  return {
    users,
    friendships: normalizeFriendships(parsed, users),
    friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
    directMessages: Array.isArray(parsed.directMessages) ? parsed.directMessages : []
  };
}

function readJsonStore(file, fsImpl = fs) {
  return normalizeUserStore(JSON.parse(fsImpl.readFileSync(file, "utf8")));
}

function createUserStorePersistence({ env = process.env, fsImpl = fs, logger = console } = {}) {
  const dataDir = resolveDataDir(env, fsImpl);
  const usersFile = path.join(dataDir, "users.json");

  function ensureDataDir() {
    fsImpl.mkdirSync(dataDir, { recursive: true });
  }

  function read() {
    try {
      ensureDataDir();
      if (fsImpl.existsSync(usersFile)) return readJsonStore(usersFile, fsImpl);
      return normalizeUserStore(EMPTY_USERS_STORE);
    } catch (error) {
      logger.error?.("Failed to read users store", error);
      return normalizeUserStore(EMPTY_USERS_STORE);
    }
  }

  function write(store) {
    ensureDataDir();
    const normalized = normalizeUserStore(store);
    const tmpFile = `${usersFile}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2));
    fsImpl.renameSync(tmpFile, usersFile);
    logger.log?.(`[db] users store write confirmed users=${normalized.users.length}`);
  }

  return { dataDir, usersFile, ensureDataDir, read, write };
}

async function initializeDatabase() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        provider_id VARCHAR(100) NOT NULL,
        username VARCHAR(100),
        avatar TEXT,
        coins INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(provider, provider_id)
      );

      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER REFERENCES users(id),
        friend_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY(user_id, friend_id)
      );

      CREATE TABLE IF NOT EXISTS shop_inventory (
        user_id INTEGER REFERENCES users(id),
        item_id VARCHAR(100) NOT NULL,
        purchased_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY(user_id, item_id)
      );
    `);

    await pool.query(`
      ALTER TABLE users ALTER COLUMN avatar TYPE TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS has_custom_avatar BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS economy JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS salt VARCHAR(128);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(256);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS direct_messages (
        id VARCHAR(100) PRIMARY KEY,
        conversation_id VARCHAR(220) NOT NULL,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        text TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    initialized = true;
  })();

  return initPromise;
}

async function getInventory(userId) {
  await initializeDatabase();
  const { rows } = await pool.query("SELECT item_id FROM shop_inventory WHERE user_id = $1 ORDER BY purchased_at ASC", [userId]);
  return rows.map((row) => row.item_id);
}

async function getUser(id) {
  await initializeDatabase();
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  if (!rows[0]) return null;
  return rowToUser(rows[0], await getInventory(rows[0].id));
}

async function getOrCreateUser(provider, providerId, profile = {}) {
  await initializeDatabase();
  const providerKey = String(provider || "local");
  const providerUserId = String(providerId);
  const username = profileUsername(profile) || `${providerKey}_${providerUserId}`;
  const displayName = String(profile.displayName || username).trim().slice(0, 100) || username;
  const avatar = profileAvatar(profile);
  const email = String(profile.email || "").trim().toLowerCase() || null;
  const providerName = providerDisplayName(profile);
  const now = new Date().toISOString();

  const existing = await pool.query("SELECT * FROM users WHERE provider = $1 AND provider_id = $2", [providerKey, providerUserId]);
  if (existing.rows[0]) {
    const nextOAuth = mergeOAuthIdentities(existing.rows[0].oauth, {
      provider: providerKey,
      providerId: providerUserId,
      email,
      providerName,
      linkedAt: now,
      lastLoginAt: now
    });
    const { rows } = await pool.query(`
      UPDATE users
      SET email = COALESCE($3, email),
          provider_name = COALESCE($4, provider_name),
          oauth = $5::jsonb,
          last_login_at = NOW(),
          updated_at = NOW()
      WHERE provider = $1 AND provider_id = $2
      RETURNING *
    `, [providerKey, providerUserId, email, providerName, JSON.stringify(nextOAuth)]);
    return rowToUser(rows[0], await getInventory(rows[0].id));
  }

  const oauthIdentity = { provider: providerKey, providerId: providerUserId, email, providerName, linkedAt: now, lastLoginAt: now };
  const { rows } = await pool.query(`
    INSERT INTO users (provider, provider_id, username, display_name, provider_name, avatar, has_custom_avatar, email, oauth, last_login_at)
    VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8::jsonb, NOW())
    RETURNING *
  `, [providerKey, providerUserId, username, displayName, providerName, avatar, email, JSON.stringify([oauthIdentity])]);

  return rowToUser(rows[0], await getInventory(rows[0].id));
}

async function updateUser(id, fields = {}) {
  await initializeDatabase();
  const allowed = {
    username: "username",
    displayName: "display_name",
    avatar: "avatar",
    providerName: "provider_name",
    hasCustomAvatar: "has_custom_avatar",
    coins: "coins",
    gamesPlayed: "games_played",
    wins: "wins",
    losses: "losses",
    stats: "stats",
    economy: "economy",
    settings: "settings",
    roles: "roles",
    oauth: "oauth",
    sessions: "sessions",
    salt: "salt",
    passwordHash: "password_hash"
  };
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    const column = allowed[key];
    if (!column) continue;
    values.push(["stats", "economy", "settings", "roles", "oauth", "sessions"].includes(key) ? JSON.stringify(value) : value);
    sets.push(`${column} = $${values.length}${["stats", "economy", "settings", "roles", "oauth", "sessions"].includes(key) ? "::jsonb" : ""}`);
  }
  if (!sets.length) return getUser(id);
  values.push(id);
  const { rows } = await pool.query(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) return null;
  return rowToUser(rows[0], await getInventory(rows[0].id));
}

async function addFriend(userId, friendId) {
  await initializeDatabase();
  const first = Number(userId);
  const second = Number(friendId);
  if (!first || !second || first === second) return null;
  await pool.query(`
    INSERT INTO friends (user_id, friend_id, status)
    VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
    ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'
  `, [first, second]);
  return { userId: String(first), friendId: String(second), status: "accepted" };
}

async function getFriends(userId) {
  await initializeDatabase();
  const { rows } = await pool.query(`
    SELECT u.* FROM friends f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = $1 AND f.status = 'accepted'
    ORDER BY f.created_at ASC
  `, [userId]);
  const inventoryRows = await pool.query("SELECT user_id, item_id FROM shop_inventory WHERE user_id = ANY($1::int[])", [rows.map((row) => row.id)]);
  const inventoryByUser = new Map();
  for (const row of inventoryRows.rows) {
    if (!inventoryByUser.has(row.user_id)) inventoryByUser.set(row.user_id, []);
    inventoryByUser.get(row.user_id).push(row.item_id);
  }
  return rows.map((row) => rowToUser(row, inventoryByUser.get(row.id) || []));
}

async function addShopItem(userId, itemId) {
  await initializeDatabase();
  await pool.query(`
    INSERT INTO shop_inventory (user_id, item_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, item_id) DO NOTHING
  `, [userId, String(itemId)]);
  return { userId: String(userId), itemId: String(itemId) };
}

async function loadUserStore() {
  await initializeDatabase();
  const [{ rows: userRows }, { rows: inventoryRows }, { rows: friendRows }, { rows: messageRows }] = await Promise.all([
    pool.query("SELECT * FROM users ORDER BY id ASC"),
    pool.query("SELECT user_id, item_id FROM shop_inventory ORDER BY purchased_at ASC"),
    pool.query("SELECT * FROM friends ORDER BY created_at ASC"),
    pool.query("SELECT * FROM direct_messages ORDER BY created_at ASC")
  ]);

  const inventoryByUser = new Map();
  for (const row of inventoryRows) {
    const key = Number(row.user_id);
    if (!inventoryByUser.has(key)) inventoryByUser.set(key, []);
    inventoryByUser.get(key).push(row.item_id);
  }

  const users = userRows.map((row) => rowToUser(row, inventoryByUser.get(row.id) || []));
  const friendships = [];
  const seenAccepted = new Set();
  const friendRequests = [];

  for (const row of friendRows) {
    if (row.status === "accepted") {
      const key = friendshipKey(row.user_id, row.friend_id);
      if (!seenAccepted.has(key)) {
        const [userAId, userBId] = key.split(":");
        friendships.push({ id: key, userAId, userBId, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at });
        seenAccepted.add(key);
      }
    } else if (row.status === "pending") {
      friendRequests.push({
        id: `${row.user_id}:${row.friend_id}`,
        senderId: String(row.user_id),
        receiverId: String(row.friend_id),
        status: "pending",
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      });
    }
  }

  const directMessages = messageRows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: String(row.sender_id),
    receiverId: String(row.receiver_id),
    text: row.text,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  }));

  return { users, friendships, friendRequests, directMessages };
}

async function saveUserStore(store = EMPTY_USERS_STORE) {
  await initializeDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const user of asArray(store.users)) {
      const identity = firstOAuthIdentity(user);
      const stats = { ...defaultStats(), ...asObject(user.stats) };
      const economy = { ...defaultEconomy(), ...asObject(user.economy) };
      const values = [
        Number(user.id) || null,
        identity.provider,
        String(identity.providerId),
        user.username || String(identity.providerId),
        user.displayName || user.username || String(identity.providerId),
        user.providerName || "",
        user.avatar || "",
        Boolean(user.hasCustomAvatar),
        Number(economy.vinyls || 0),
        Number(stats.games || stats.games_played || 0),
        Number(stats.wins || 0),
        Number(stats.losses || 0),
        JSON.stringify(stats),
        JSON.stringify(economy),
        JSON.stringify(asObject(user.settings)),
        JSON.stringify(asArray(user.roles)),
        JSON.stringify(asArray(user.oauth)),
        JSON.stringify(asArray(user.sessions)),
        user.salt || null,
        user.passwordHash || null
      ];

      const { rows } = await client.query(`
        INSERT INTO users (id, provider, provider_id, username, display_name, provider_name, avatar, has_custom_avatar, coins, games_played, wins, losses, stats, economy, settings, roles, oauth, sessions, salt, password_hash)
        VALUES (COALESCE($1, nextval('users_id_seq')), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20)
        ON CONFLICT (provider, provider_id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          provider_name = EXCLUDED.provider_name,
          avatar = EXCLUDED.avatar,
          has_custom_avatar = EXCLUDED.has_custom_avatar,
          coins = EXCLUDED.coins,
          games_played = EXCLUDED.games_played,
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          stats = EXCLUDED.stats,
          economy = EXCLUDED.economy,
          settings = EXCLUDED.settings,
          roles = EXCLUDED.roles,
          oauth = EXCLUDED.oauth,
          sessions = EXCLUDED.sessions,
          salt = EXCLUDED.salt,
          password_hash = EXCLUDED.password_hash,
          updated_at = NOW()
        RETURNING id
      `, values);

      if (!Number(user.id)) user.id = String(rows[0].id);

      for (const itemId of asArray(economy.ownedCosmetics)) {
        await client.query("INSERT INTO shop_inventory (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, String(itemId)]);
      }
    }

    await client.query("DELETE FROM friends");
    for (const friendship of asArray(store.friendships)) {
      const a = Number(friendship.userAId);
      const b = Number(friendship.userBId);
      if (!a || !b || a === b) continue;
      await client.query("INSERT INTO friends (user_id, friend_id, status, created_at) VALUES ($1, $2, 'accepted', COALESCE($3, NOW())), ($2, $1, 'accepted', COALESCE($3, NOW())) ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'", [a, b, friendship.createdAt || null]);
    }
    for (const request of asArray(store.friendRequests).filter((item) => item.status === "pending")) {
      const sender = Number(request.senderId);
      const receiver = Number(request.receiverId);
      if (!sender || !receiver || sender === receiver) continue;
      await client.query("INSERT INTO friends (user_id, friend_id, status, created_at) VALUES ($1, $2, 'pending', COALESCE($3, NOW())) ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'pending'", [sender, receiver, request.createdAt || null]);
    }

    for (const message of asArray(store.directMessages)) {
      await client.query(`
        INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, text, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
      `, [message.id, message.conversationId, Number(message.senderId), Number(message.receiverId), message.text, message.status || "pending", message.createdAt || null]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DEFAULT_DATA_DIR,
  EMPTY_USERS_STORE,
  RENDER_PERSISTENT_DIR,
  addFriend,
  addShopItem,
  createUserStorePersistence,
  friendshipKey,
  getFriends,
  getInventory,
  getOrCreateUser,
  getUser,
  initializeDatabase,
  loadUserStore,
  normalizeFriendships,
  normalizeUserStore,
  pool,
  readJsonStore,
  resolveDataDir,
  saveUserStore,
  updateUser
};
