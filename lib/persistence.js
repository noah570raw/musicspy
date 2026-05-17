const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const RENDER_PERSISTENT_DIR = "/var/data";
const EMPTY_USERS_STORE = Object.freeze({ users: [], friendRequests: [], directMessages: [] });

function resolveDataDir(env = process.env, fsImpl = fs) {
  const explicitDataDir = String(env.MUSICSPY_DATA_DIR || env.DATA_DIR || "").trim();
  if (explicitDataDir) return path.resolve(explicitDataDir);

  const renderDiskMount = String(env.RENDER_DISK_MOUNT_PATH || "").trim();
  const persistentCandidates = [renderDiskMount, RENDER_PERSISTENT_DIR].filter(Boolean);
  const persistentRoot = persistentCandidates.find((candidate) => fsImpl.existsSync(candidate));
  if (persistentRoot) return path.join(persistentRoot, "musicspy");

  return DEFAULT_DATA_DIR;
}

function normalizeUserStore(parsed = {}) {
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
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

  function write(store) {
    ensureDataDir();
    const tmpFile = `${usersFile}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmpFile, JSON.stringify(normalizeUserStore(store), null, 2));
    fsImpl.renameSync(tmpFile, usersFile);
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
  normalizeUserStore,
  readJsonStore,
  resolveDataDir
};
