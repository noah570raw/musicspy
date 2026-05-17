const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const RENDER_PERSISTENT_DIR = "/var/data";
const EMPTY_USERS_STORE = Object.freeze({ users: [], friendships: [], friendRequests: [], directMessages: [] });
let postgresStore = null;
try {
  postgresStore = require("./postgres-store");
} catch {
  postgresStore = null;
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
  const renderEnvironment = Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_HOSTNAME);
  const configuredDatabaseUrl = String(env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRESQL_URL || "").trim();
  const requireDatabase = String(env.MUSICSPY_REQUIRE_DATABASE || "").toLowerCase() === "true";
  if (!configuredDatabaseUrl && requireDatabase) {
    throw new Error("Persistent database is required because MUSICSPY_REQUIRE_DATABASE=true, but DATABASE_URL / POSTGRES_URL is missing");
  }

  if (postgresStore?.shouldUsePostgres(env)) {
    if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_HOSTNAME) {
      logger.log?.("[db] Render environment detected; using external PostgreSQL persistence from DATABASE_URL");
    } else {
      logger.log?.("[db] DATABASE_URL detected; using PostgreSQL persistence");
    }
    return new postgresStore.PostgresUserStorePersistence({ env, logger });
  }

  const dataDir = resolveDataDir(env, fsImpl);
  const usersFile = path.join(dataDir, "users.json");
  const legacyUsersFile = path.join(DEFAULT_DATA_DIR, "users.json");
  if (renderEnvironment && !configuredDatabaseUrl) {
    logger.warn?.(`[db] Render detected without DATABASE_URL; starting with file storage at ${usersFile}. Attach Render PostgreSQL and set DATABASE_URL for deploy-proof persistence.`);
  }

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
    logger.log?.(`[db] users store write confirmed users=${normalized.users.length} friendships=${normalized.friendships.length} requests=${normalized.friendRequests.length} directMessages=${normalized.directMessages.length}`);
  }

  return {
    dataDir,
    usersFile,
    legacyUsersFile,
    ensureDataDir,
    read,
    write
  };
}

module.exports = {
  DEFAULT_DATA_DIR,
  RENDER_PERSISTENT_DIR,
  createUserStorePersistence,
  isRenderEnvironment: postgresStore?.isRenderEnvironment || (() => false),
  shouldUsePostgres: postgresStore?.shouldUsePostgres || (() => false),
  friendshipKey,
  normalizeFriendships,
  normalizeUserStore,
  readJsonStore,
  resolveDataDir
};
