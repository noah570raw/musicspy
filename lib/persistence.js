const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const RENDER_PERSISTENT_DIR = "/var/data";
const EMPTY_USERS_STORE = Object.freeze({
  users: [],
  friendships: [],
  friendRequests: [],
  directMessages: [],
  lobbyHistory: [],
  matchHistory: [],
  playerProgression: []
});

function resolveDataDir(env = process.env, fsImpl = fs) {
  const explicitDataDir = String(env.MUSICSPY_DATA_DIR || env.DATA_DIR || "").trim();
  if (explicitDataDir) return path.resolve(explicitDataDir);

  const renderDiskMount = String(env.RENDER_DISK_MOUNT_PATH || "").trim();
  const persistentCandidates = [renderDiskMount, RENDER_PERSISTENT_DIR].filter(Boolean);
  const persistentRoot = persistentCandidates.find((candidate) => fsImpl.existsSync(candidate));
  if (persistentRoot) return path.join(persistentRoot, "musicspy");

  return DEFAULT_DATA_DIR;
}

function resolveDatabaseUrl(env = process.env) {
  return String(env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRESQL_URL || "").trim();
}

function shouldRequireDatabase(env = process.env) {
  const runtime = String(env.NODE_ENV || "").toLowerCase();
  const render = String(env.RENDER || env.RENDER_SERVICE_ID || "").trim();
  return runtime === "production" || Boolean(render);
}

function friendshipKey(userAId, userBId) {
  return [String(userAId || ""), String(userBId || "")].sort().join(":");
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

function normalizeStoreArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUserStore(parsed = {}) {
  const users = normalizeStoreArray(parsed.users);
  return {
    users,
    friendships: normalizeFriendships(parsed, users),
    friendRequests: normalizeStoreArray(parsed.friendRequests),
    directMessages: normalizeStoreArray(parsed.directMessages),
    lobbyHistory: normalizeStoreArray(parsed.lobbyHistory),
    matchHistory: normalizeStoreArray(parsed.matchHistory),
    playerProgression: normalizeStoreArray(parsed.playerProgression)
  };
}

function readJsonStore(file, fsImpl = fs) {
  return normalizeUserStore(JSON.parse(fsImpl.readFileSync(file, "utf8")));
}

function createFileUserStorePersistence({ env = process.env, fsImpl = fs, logger = console } = {}) {
  const dataDir = resolveDataDir(env, fsImpl);
  const usersFile = path.join(dataDir, "users.json");
  const legacyUsersFile = path.join(DEFAULT_DATA_DIR, "users.json");

  function ensureDataDir() {
    fsImpl.mkdirSync(dataDir, { recursive: true });
  }

  function read() {
    try {
      ensureDataDir();
      if (fsImpl.existsSync(usersFile)) return readJsonStore(usersFile, fsImpl);

      if (usersFile !== legacyUsersFile && fsImpl.existsSync(legacyUsersFile)) {
        const legacyStore = readJsonStore(legacyUsersFile, fsImpl);
        fsImpl.writeFileSync(usersFile, JSON.stringify(legacyStore, null, 2));
        logger.log?.(`Migrated users store from ${legacyUsersFile} to ${usersFile}`);
        return legacyStore;
      }

      return normalizeUserStore(EMPTY_USERS_STORE);
    } catch (error) {
      logger.error?.("Failed to read users store", error);
      return normalizeUserStore(EMPTY_USERS_STORE);
    }
  }

  function fsyncPath(file) {
    if (typeof fsImpl.openSync !== "function" || typeof fsImpl.fsyncSync !== "function" || typeof fsImpl.closeSync !== "function") return;
    const fd = fsImpl.openSync(file, "r");
    try {
      fsImpl.fsyncSync(fd);
    } finally {
      fsImpl.closeSync(fd);
    }
  }

  function write(store) {
    ensureDataDir();
    const normalized = normalizeUserStore(store);
    const tmpFile = `${usersFile}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2));
    fsyncPath(tmpFile);
    fsImpl.renameSync(tmpFile, usersFile);
    fsyncPath(dataDir);
    logger.log?.(`[db:file] users store write confirmed users=${normalized.users.length} friendships=${normalized.friendships.length} requests=${normalized.friendRequests.length} directMessages=${normalized.directMessages.length}`);
  }

  return {
    kind: "file",
    dataDir,
    usersFile,
    legacyUsersFile,
    ensureDataDir,
    init: () => undefined,
    read,
    write,
    close: () => undefined
  };
}

function loadPg(env = process.env) {
  const canResolvePg = module.paths.some((modulePath) => fs.existsSync(path.join(modulePath, "pg", "package.json")));
  if (canResolvePg) return require("pg");
  const installHint = "Install the pg package and set DATABASE_URL to a managed PostgreSQL database.";
  if (resolveDatabaseUrl(env) || shouldRequireDatabase(env)) throw new Error(installHint);
  return null;
}

function json(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value;
}

function createPostgresUserStorePersistence({ env = process.env, fsImpl = fs, logger = console, pgModule } = {}) {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) return null;
  const resolvedPgModule = pgModule || loadPg(env);
  if (!resolvedPgModule) return null;
  const { Pool } = resolvedPgModule;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: String(env.PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false }
  });
  const dataDir = resolveDataDir(env, fsImpl);
  const legacyUsersFile = path.join(DEFAULT_DATA_DIR, "users.json");

  async function query(text, params = []) {
    return pool.query(text, params);
  }

  async function init() {
    await query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '',
        salt TEXT,
        password_hash TEXT,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS oauth_identities (
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, provider_id)
      );
      CREATE INDEX IF NOT EXISTS oauth_identities_user_id_idx ON oauth_identities(user_id);
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        token_hash TEXT,
        access_token_hash TEXT,
        refresh_token_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        access_expires_at TIMESTAMPTZ,
        refresh_expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_access_hash_idx ON auth_sessions(access_token_hash);
      CREATE INDEX IF NOT EXISTS auth_sessions_refresh_hash_idx ON auth_sessions(refresh_token_hash);
      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        user_a_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        user_b_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (user_a_id <> user_b_id)
      );
      CREATE INDEX IF NOT EXISTS friendships_user_a_idx ON friendships(user_a_id);
      CREATE INDEX IF NOT EXISTS friendships_user_b_idx ON friendships(user_b_id);
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        receiver_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        responded_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS friend_requests_sender_idx ON friend_requests(sender_id);
      CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON friend_requests(receiver_id);
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        receiver_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS direct_messages_receiver_idx ON direct_messages(receiver_id, status);
      CREATE TABLE IF NOT EXISTS lobby_history (
        id TEXT PRIMARY KEY,
        lobby_code TEXT NOT NULL,
        lobby_name TEXT NOT NULL DEFAULT '',
        host_user_id TEXT,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS lobby_history_lobby_code_idx ON lobby_history(lobby_code);
      CREATE TABLE IF NOT EXISTS match_history (
        id TEXT PRIMARY KEY,
        lobby_history_id TEXT REFERENCES lobby_history(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        lobby_code TEXT NOT NULL,
        role TEXT NOT NULL,
        won BOOLEAN NOT NULL DEFAULT false,
        stats_after JSONB NOT NULL DEFAULT '{}'::jsonb,
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS match_history_user_id_idx ON match_history(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS player_progression (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS player_progression_user_id_idx ON player_progression(user_id, created_at DESC);
    `);

    await query(`
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS salt TEXT,
        ADD COLUMN IF NOT EXISTS password_hash TEXT,
        ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE auth_sessions
        ADD COLUMN IF NOT EXISTS token_hash TEXT,
        ADD COLUMN IF NOT EXISTS access_token_hash TEXT,
        ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
        ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;
      ALTER TABLE direct_messages
        ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
      ALTER TABLE lobby_history
        ADD COLUMN IF NOT EXISTS lobby_name TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE match_history
        ADD COLUMN IF NOT EXISTS lobby_history_id TEXT REFERENCES lobby_history(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS stats_after JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    await query("DELETE FROM auth_sessions WHERE refresh_expires_at IS NOT NULL AND refresh_expires_at <= now()");

    if (fsImpl.existsSync(legacyUsersFile)) {
      const count = await query("SELECT COUNT(*)::int AS count FROM accounts");
      if (count.rows[0]?.count === 0) {
        logger.log?.(`[db:postgres] importing legacy user store from ${legacyUsersFile}`);
        await write(readJsonStore(legacyUsersFile, fsImpl));
      }
    }
  }

  async function read() {
    const [accounts, oauth, sessions, friendships, requests, messages, lobbies, matches, progression] = await Promise.all([
      query("SELECT * FROM accounts ORDER BY created_at ASC"),
      query("SELECT * FROM oauth_identities ORDER BY linked_at ASC"),
      query("SELECT * FROM auth_sessions ORDER BY created_at ASC"),
      query("SELECT * FROM friendships ORDER BY created_at ASC"),
      query("SELECT * FROM friend_requests ORDER BY created_at ASC"),
      query("SELECT * FROM direct_messages ORDER BY created_at ASC"),
      query("SELECT * FROM lobby_history ORDER BY ended_at DESC LIMIT 500"),
      query("SELECT * FROM match_history ORDER BY created_at DESC LIMIT 5000"),
      query("SELECT * FROM player_progression ORDER BY created_at DESC LIMIT 5000")
    ]);

    const oauthByUser = new Map();
    for (const row of oauth.rows) {
      if (!oauthByUser.has(row.user_id)) oauthByUser.set(row.user_id, []);
      oauthByUser.get(row.user_id).push({ provider: row.provider, providerId: row.provider_id, email: row.email || "", linkedAt: row.linked_at?.toISOString?.() || row.linked_at });
    }
    const sessionsByUser = new Map();
    for (const row of sessions.rows) {
      if (!sessionsByUser.has(row.user_id)) sessionsByUser.set(row.user_id, []);
      sessionsByUser.get(row.user_id).push({
        id: row.id,
        tokenHash: row.token_hash || undefined,
        accessTokenHash: row.access_token_hash || undefined,
        refreshTokenHash: row.refresh_token_hash || undefined,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
        accessExpiresAt: row.access_expires_at?.toISOString?.() || row.access_expires_at,
        refreshExpiresAt: row.refresh_expires_at?.toISOString?.() || row.refresh_expires_at
      });
    }

    return normalizeUserStore({
      users: accounts.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar || "",
        stats: json(row.stats, {}),
        settings: json(row.settings, {}),
        salt: row.salt || undefined,
        passwordHash: row.password_hash || undefined,
        oauth: oauthByUser.get(row.id) || [],
        sessions: sessionsByUser.get(row.id) || [],
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      })),
      friendships: friendships.rows.map((row) => ({ id: row.id, userAId: row.user_a_id, userBId: row.user_b_id, createdAt: row.created_at?.toISOString?.() || row.created_at })),
      friendRequests: requests.rows.map((row) => ({ id: row.id, senderId: row.sender_id, receiverId: row.receiver_id, status: row.status, createdAt: row.created_at?.toISOString?.() || row.created_at, respondedAt: row.responded_at?.toISOString?.() || row.responded_at })),
      directMessages: messages.rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, receiverId: row.receiver_id, text: row.text, status: row.status, createdAt: row.created_at?.toISOString?.() || row.created_at, readAt: row.read_at?.toISOString?.() || row.read_at })),
      lobbyHistory: lobbies.rows.map((row) => ({ id: row.id, lobbyCode: row.lobby_code, lobbyName: row.lobby_name, hostUserId: row.host_user_id, settings: json(row.settings, {}), result: json(row.result, {}), createdAt: row.created_at?.toISOString?.() || row.created_at, endedAt: row.ended_at?.toISOString?.() || row.ended_at })),
      matchHistory: matches.rows.map((row) => ({ id: row.id, lobbyHistoryId: row.lobby_history_id, userId: row.user_id, lobbyCode: row.lobby_code, role: row.role, won: row.won, statsAfter: json(row.stats_after, {}), result: json(row.result, {}), createdAt: row.created_at?.toISOString?.() || row.created_at })),
      playerProgression: progression.rows.map((row) => ({ id: row.id, userId: row.user_id, type: row.type, payload: json(row.payload, {}), createdAt: row.created_at?.toISOString?.() || row.created_at }))
    });
  }

  async function write(store) {
    const normalized = normalizeUserStore(store);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("TRUNCATE player_progression, match_history, lobby_history, direct_messages, friend_requests, friendships, auth_sessions, oauth_identities, accounts RESTART IDENTITY CASCADE");
      for (const user of normalized.users) {
        await client.query(
          `INSERT INTO accounts (id, username, display_name, avatar, salt, password_hash, stats, settings, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [user.id, user.username, user.displayName || user.username, user.avatar || "", user.salt || null, user.passwordHash || null, user.stats || {}, user.settings || {}, user.createdAt || new Date().toISOString(), user.updatedAt || user.createdAt || new Date().toISOString()]
        );
        for (const identity of user.oauth || []) {
          await client.query(
            `INSERT INTO oauth_identities (user_id, provider, provider_id, email, linked_at) VALUES ($1,$2,$3,$4,$5)`,
            [user.id, identity.provider, identity.providerId, identity.email || "", identity.linkedAt || new Date().toISOString()]
          );
        }
        for (const session of user.sessions || []) {
          await client.query(
            `INSERT INTO auth_sessions (id, user_id, token_hash, access_token_hash, refresh_token_hash, created_at, updated_at, access_expires_at, refresh_expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [session.id || `${user.id}:${session.refreshTokenHash || session.accessTokenHash || cryptoSafeId()}`, user.id, session.tokenHash || null, session.accessTokenHash || null, session.refreshTokenHash || null, session.createdAt || new Date().toISOString(), session.updatedAt || new Date().toISOString(), session.accessExpiresAt || null, session.refreshExpiresAt || null]
          );
        }
      }
      for (const friendship of normalized.friendships) {
        await client.query(`INSERT INTO friendships (id, user_a_id, user_b_id, created_at) VALUES ($1,$2,$3,$4)`, [friendship.id, friendship.userAId, friendship.userBId, friendship.createdAt || new Date().toISOString()]);
      }
      for (const request of normalized.friendRequests) {
        await client.query(`INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at, responded_at) VALUES ($1,$2,$3,$4,$5,$6)`, [request.id, request.senderId, request.receiverId, request.status || "pending", request.createdAt || new Date().toISOString(), request.respondedAt || null]);
      }
      for (const message of normalized.directMessages) {
        await client.query(`INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, text, status, created_at, read_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [message.id, message.conversationId, message.senderId, message.receiverId, message.text, message.status || "pending", message.createdAt || new Date().toISOString(), message.readAt || null]);
      }
      for (const lobby of normalized.lobbyHistory) {
        await client.query(`INSERT INTO lobby_history (id, lobby_code, lobby_name, host_user_id, settings, result, created_at, ended_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [lobby.id, lobby.lobbyCode, lobby.lobbyName || "", lobby.hostUserId || null, lobby.settings || {}, lobby.result || {}, lobby.createdAt || new Date().toISOString(), lobby.endedAt || new Date().toISOString()]);
      }
      for (const match of normalized.matchHistory) {
        await client.query(`INSERT INTO match_history (id, lobby_history_id, user_id, lobby_code, role, won, stats_after, result, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [match.id, match.lobbyHistoryId || null, match.userId, match.lobbyCode, match.role || "civilian", Boolean(match.won), match.statsAfter || {}, match.result || {}, match.createdAt || new Date().toISOString()]);
      }
      for (const item of normalized.playerProgression) {
        await client.query(`INSERT INTO player_progression (id, user_id, type, payload, created_at) VALUES ($1,$2,$3,$4,$5)`, [item.id, item.userId, item.type || "progress", item.payload || {}, item.createdAt || new Date().toISOString()]);
      }
      await client.query("COMMIT");
      logger.log?.(`[db:postgres] write confirmed users=${normalized.users.length} friendships=${normalized.friendships.length} requests=${normalized.friendRequests.length} directMessages=${normalized.directMessages.length} matches=${normalized.matchHistory.length}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    kind: "postgres",
    dataDir,
    usersFile: "postgresql://DATABASE_URL/musicspy",
    legacyUsersFile,
    init,
    read,
    write,
    close: () => pool.end()
  };
}

function cryptoSafeId() {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createUserStorePersistence(options = {}) {
  const env = options.env || process.env;
  const postgres = createPostgresUserStorePersistence(options);
  if (postgres) return postgres;

  if (shouldRequireDatabase(env) && !String(env.MUSICSPY_ALLOW_FILE_STORE || "").trim()) {
    throw new Error("Persistent DATABASE_URL is required in production/Render. Refusing to use an ephemeral JSON file store for user data.");
  }

  options.logger?.warn?.("[db:file] DATABASE_URL is not configured; using local file persistence for development/test only.");
  return createFileUserStorePersistence(options);
}

module.exports = {
  DEFAULT_DATA_DIR,
  EMPTY_USERS_STORE,
  RENDER_PERSISTENT_DIR,
  createFileUserStorePersistence,
  createPostgresUserStorePersistence,
  createUserStorePersistence,
  friendshipKey,
  normalizeFriendships,
  normalizeUserStore,
  readJsonStore,
  resolveDataDir,
  resolveDatabaseUrl,
  shouldRequireDatabase
};
