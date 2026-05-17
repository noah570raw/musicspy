const crypto = require("crypto");
const net = require("net");
const tls = require("tls");

const POSTGRES_SSL_REQUEST_CODE = 80877103;
const POSTGRES_PROTOCOL_VERSION = 196608;
function friendshipKey(userAId, userBId) {
  return [String(userAId || ""), String(userBId || "")].sort().join(":");
}

function normalizeUserStore(parsed = {}) {
  const users = Array.isArray(parsed.users) ? parsed.users : [];
  const seen = new Set();
  const friendships = [];
  const addFriendship = (userAId, userBId, createdAt = new Date(0).toISOString()) => {
    if (!userAId || !userBId || userAId === userBId) return;
    const id = friendshipKey(userAId, userBId);
    if (seen.has(id)) return;
    const [firstUserId, secondUserId] = id.split(":");
    friendships.push({ id, userAId: firstUserId, userBId: secondUserId, createdAt });
    seen.add(id);
  };
  for (const friendship of Array.isArray(parsed.friendships) ? parsed.friendships : []) addFriendship(friendship.userAId, friendship.userBId, friendship.createdAt);
  for (const user of users) for (const friendId of Array.isArray(user.friends) ? user.friends : []) addFriendship(user.id, friendId, user.updatedAt || user.createdAt);
  return {
    users,
    friendships,
    friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
    directMessages: Array.isArray(parsed.directMessages) ? parsed.directMessages : []
  };
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_QUERY_TIMEOUT_MS = 30000;

function shouldUsePostgres(env = process.env) {
  const url = String(env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRESQL_URL || "").trim();
  if (!url) return false;
  if (String(env.MUSICSPY_STORAGE || "").toLowerCase() === "file") return false;
  return true;
}

function isRenderEnvironment(env = process.env) {
  return Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_HOSTNAME || env.RENDER_INSTANCE_ID);
}

function databaseUrl(env = process.env) {
  return String(env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRESQL_URL || "").trim();
}

function dollarQuote(value) {
  const tag = `musicspy_${crypto.randomBytes(8).toString("hex")}`;
  return `$${tag}$${String(value)}$${tag}$`;
}

function recordsFor(items, idSelector) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => ({ id: String(idSelector(item) || item.id || crypto.randomUUID()), data: item }));
}

function buildPgUrl(env = process.env) {
  const raw = databaseUrl(env);
  if (!raw) return null;
  const parsed = new URL(raw);
  const sslMode = parsed.searchParams.get("sslmode");
  return {
    raw,
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: decodeURIComponent((parsed.pathname || "/").slice(1) || parsed.username || "postgres"),
    ssl: sslMode === "disable" ? false : (sslMode === "require" || parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1")
  };
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function cstring(value) {
  return Buffer.from(`${String(value)}\0`, "utf8");
}

function message(type, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload]);
}

function startupMessage(params) {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") pairs.push(cstring(key), cstring(value));
  }
  const payload = Buffer.concat([int32(POSTGRES_PROTOCOL_VERSION), ...pairs, Buffer.from([0])]);
  return Buffer.concat([int32(payload.length + 4), payload]);
}

function saslName(value) {
  return String(value).replace(/=/g, "=3D").replace(/,/g, "=2C");
}

function parseScramPairs(value) {
  return Object.fromEntries(String(value).split(",").map((part) => [part.slice(0, 1), part.slice(2)]));
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function xorBuffers(left, right) {
  const out = Buffer.alloc(left.length);
  for (let index = 0; index < left.length; index += 1) out[index] = left[index] ^ right[index];
  return out;
}

class SimplePgClient {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
  }

  async connect() {
    const plainSocket = await this.openTcpSocket();
    this.socket = this.config.ssl ? await this.upgradeToTls(plainSocket) : plainSocket;
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("error", (error) => this.failWaiters(error));
    this.socket.on("close", () => this.failWaiters(new Error("PostgreSQL connection closed")));
    this.socket.write(startupMessage({ user: this.config.user, database: this.config.database, client_encoding: "UTF8", application_name: "musicspy" }));
    await this.authenticate();
  }

  openTcpSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("PostgreSQL connection timeout"));
      }, DEFAULT_CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  upgradeToTls(socket) {
    return new Promise((resolve, reject) => {
      socket.write(Buffer.concat([int32(8), int32(POSTGRES_SSL_REQUEST_CODE)]));
      socket.once("data", (response) => {
        if (response.slice(0, 1).toString() !== "S") {
          socket.destroy();
          reject(new Error("PostgreSQL server refused SSL"));
          return;
        }
        const secureSocket = tls.connect({ socket, servername: this.config.host, rejectUnauthorized: false }, () => resolve(secureSocket));
        secureSocket.once("error", reject);
      });
      socket.once("error", reject);
    });
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) break;
      const packet = { type: this.buffer.slice(0, 1).toString(), payload: this.buffer.slice(5, length + 1) };
      this.buffer = this.buffer.slice(length + 1);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(packet);
    }
  }

  failWaiters(error) {
    while (this.waiters.length) this.waiters.shift().reject(error);
  }

  nextPacket(timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PostgreSQL query timeout")), timeoutMs);
      this.waiters.push({
        resolve: (packet) => {
          clearTimeout(timer);
          resolve(packet);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async authenticate() {
    let clientFirstBare = "";
    let serverFirst = "";
    let serverSignature = "";
    const nonce = crypto.randomBytes(18).toString("base64");

    while (true) {
      const packet = await this.nextPacket();
      if (packet.type === "R") {
        const code = packet.payload.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) {
          this.socket.write(message("p", cstring(this.config.password)));
          continue;
        }
        if (code === 5) {
          const salt = packet.payload.slice(4, 8);
          const hashed = crypto.createHash("md5").update(`${this.config.password}${this.config.user}`).digest("hex");
          const md5 = crypto.createHash("md5").update(Buffer.concat([Buffer.from(hashed), salt])).digest("hex");
          this.socket.write(message("p", cstring(`md5${md5}`)));
          continue;
        }
        if (code === 10) {
          clientFirstBare = `n=${saslName(this.config.user)},r=${nonce}`;
          const clientFirst = `n,,${clientFirstBare}`;
          const payload = Buffer.concat([cstring("SCRAM-SHA-256"), int32(Buffer.byteLength(clientFirst)), Buffer.from(clientFirst)]);
          this.socket.write(message("p", payload));
          continue;
        }
        if (code === 11) {
          serverFirst = packet.payload.slice(4).toString();
          const pairs = parseScramPairs(serverFirst);
          const clientFinalNoProof = `c=biws,r=${pairs.r}`;
          const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`;
          const salted = crypto.pbkdf2Sync(this.config.password, Buffer.from(pairs.s, "base64"), Number(pairs.i), 32, "sha256");
          const clientKey = hmac(salted, "Client Key");
          const storedKey = sha256(clientKey);
          const clientSignature = hmac(storedKey, authMessage);
          const proof = xorBuffers(clientKey, clientSignature).toString("base64");
          serverSignature = hmac(hmac(salted, "Server Key"), authMessage).toString("base64");
          this.socket.write(message("p", Buffer.from(`${clientFinalNoProof},p=${proof}`)));
          continue;
        }
        if (code === 12) {
          const finalPairs = parseScramPairs(packet.payload.slice(4).toString());
          if (finalPairs.v && finalPairs.v !== serverSignature) throw new Error("PostgreSQL SCRAM server signature mismatch");
          continue;
        }
        throw new Error(`Unsupported PostgreSQL authentication method: ${code}`);
      }
      if (packet.type === "S" || packet.type === "K") continue;
      if (packet.type === "Z") return;
      if (packet.type === "E") throw new Error(this.errorMessage(packet.payload));
    }
  }

  errorMessage(payload) {
    return payload.toString("utf8").split("\0").filter(Boolean).join(" ");
  }

  async query(sql) {
    this.socket.write(message("Q", cstring(sql)));
    const rows = [];
    let fields = [];
    while (true) {
      const packet = await this.nextPacket();
      if (packet.type === "T") {
        const count = packet.payload.readInt16BE(0);
        let offset = 2;
        fields = [];
        for (let index = 0; index < count; index += 1) {
          const end = packet.payload.indexOf(0, offset);
          fields.push(packet.payload.slice(offset, end).toString());
          offset = end + 19;
        }
      } else if (packet.type === "D") {
        const count = packet.payload.readInt16BE(0);
        let offset = 2;
        const row = {};
        for (let index = 0; index < count; index += 1) {
          const length = packet.payload.readInt32BE(offset);
          offset += 4;
          row[fields[index] || `column_${index}`] = length === -1 ? null : packet.payload.slice(offset, offset + length).toString();
          if (length !== -1) offset += length;
        }
        rows.push(row);
      } else if (packet.type === "C" || packet.type === "N") {
        continue;
      } else if (packet.type === "Z") {
        return { rows };
      } else if (packet.type === "E") {
        throw new Error(this.errorMessage(packet.payload));
      }
    }
  }

  close() {
    try {
      this.socket?.write(message("X"));
      this.socket?.end();
    } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withClient(config, logger, callback) {
  let lastError = null;
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new SimplePgClient(config, logger);
    try {
      await client.connect();
      return await callback(client);
    } catch (error) {
      lastError = error;
      client.close();
      if (attempt >= attempts) break;
      logger.warn?.(`[db] PostgreSQL operation failed; reconnecting attempt=${attempt + 1}/${attempts}: ${error.message}`);
      await sleep(150 * attempt);
      continue;
    } finally {
      client.close();
    }
  }
  throw lastError;
}

class PostgresUserStorePersistence {
  constructor({ env = process.env, logger = console } = {}) {
    this.env = env;
    this.logger = logger;
    this.config = buildPgUrl(env);
    this.cache = normalizeUserStore({});
    this.ready = false;
    this.writeQueue = Promise.resolve();
    this.usersFile = "postgres://musicspy/persistent-user-store";
    this.dataDir = "postgres";
    this.legacyUsersFile = null;
    this.mode = "postgres";
  }

  async init() {
    if (!this.config) throw new Error("DATABASE_URL is required for PostgreSQL persistence");
    await withClient(this.config, this.logger, async (client) => {
      await client.query(this.schemaSql());
      this.cache = normalizeUserStore(await this.readFromDatabase(client));
    });
    this.ready = true;
    this.logger.log?.(`[db] PostgreSQL persistence ready host=${this.config.host} database=${this.config.database}`);
    return this.cache;
  }

  ensureDataDir() {}

  read() {
    return this.cache;
  }

  write(store) {
    this.cache = normalizeUserStore(store);
    this.writeQueue = this.writeQueue
      .then(() => {
        if (!this.cache.users.length) {
          throw new Error("Refusing to persist an empty production user store; this protects Render redeploys from accidental full-account wipes");
        }
        return withClient(this.config, this.logger, (client) => client.query(this.writeSql(this.cache)));
      })
      .then(() => {
        this.logger.log?.(`[db] PostgreSQL write confirmed users=${this.cache.users.length} friendships=${this.cache.friendships.length} requests=${this.cache.friendRequests.length} directMessages=${this.cache.directMessages.length}`);
      })
      .catch((error) => {
        this.logger.error?.("[db] PostgreSQL write failed", error);
      });
    return this.writeQueue;
  }

  async flush() {
    return this.writeQueue;
  }

  schemaSql() {
    return `
CREATE TABLE IF NOT EXISTS musicspy_meta (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS user_accounts (id text PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE, data jsonb NOT NULL, access_expires_at timestamptz, refresh_expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS friendships (id text PRIMARY KEY, user_a_id text NOT NULL, user_b_id text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS friend_requests (id text PRIMARY KEY, sender_id text NOT NULL, receiver_id text NOT NULL, status text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz);
CREATE TABLE IF NOT EXISTS direct_messages (id text PRIMARY KEY, conversation_id text NOT NULL, sender_id text NOT NULL, receiver_id text NOT NULL, status text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_history (id text PRIMARY KEY, user_id text, lobby_id text, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS lobby_history (id text PRIMARY KEY, code text, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS player_progression (user_id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_google_id ON user_accounts ((data->>'googleId')) WHERE COALESCE(data->>'googleId', '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_discord_id ON user_accounts ((data->>'discordId')) WHERE COALESCE(data->>'discordId', '') <> '';
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_expiry ON auth_sessions(refresh_expires_at);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status ON friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(conversation_id, created_at);
`;
  }

  async readFromDatabase(client) {
    const result = await client.query(`
SELECT
  COALESCE((SELECT jsonb_agg(data ORDER BY COALESCE(data->>'createdAt', '')) FROM user_accounts), '[]'::jsonb)::text AS users,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'data', data) ORDER BY updated_at) FROM auth_sessions), '[]'::jsonb)::text AS sessions,
  COALESCE((SELECT jsonb_agg(data ORDER BY created_at) FROM friendships), '[]'::jsonb)::text AS friendships,
  COALESCE((SELECT jsonb_agg(data ORDER BY created_at) FROM friend_requests), '[]'::jsonb)::text AS friend_requests,
  COALESCE((SELECT jsonb_agg(data ORDER BY created_at) FROM direct_messages), '[]'::jsonb)::text AS direct_messages;
`);
    const row = result.rows[0] || {};
    const users = JSON.parse(row.users || "[]");
    const sessions = JSON.parse(row.sessions || "[]");
    const sessionsByUserId = new Map();
    for (const session of sessions) {
      if (!session.userId || !session.data) continue;
      const list = sessionsByUserId.get(session.userId) || [];
      list.push(session.data);
      sessionsByUserId.set(session.userId, list);
    }
    for (const user of users) {
      user.sessions = sessionsByUserId.get(user.id) || user.sessions || [];
    }
    return {
      users,
      friendships: JSON.parse(row.friendships || "[]"),
      friendRequests: JSON.parse(row.friend_requests || "[]"),
      directMessages: JSON.parse(row.direct_messages || "[]")
    };
  }

  writeSql(store) {
    const users = recordsFor(store.users, (item) => item.id);
    const sessions = [];
    for (const user of store.users || []) {
      for (const session of user.sessions || []) {
        sessions.push({ id: session.id || `${user.id}:${session.createdAt || session.updatedAt || crypto.randomUUID()}`, userId: user.id, data: session });
      }
    }
    const friendships = recordsFor(store.friendships, (item) => item.id);
    const friendRequests = recordsFor(store.friendRequests, (item) => item.id);
    const directMessages = recordsFor(store.directMessages, (item) => item.id);
    const matchHistory = [];
    const lobbyHistoryById = new Map();
    for (const user of store.users || []) {
      for (const match of Array.isArray(user.matchHistory) ? user.matchHistory : []) {
        matchHistory.push({ id: String(match.id || crypto.randomUUID()), userId: user.id, lobbyId: match.lobbyCode || match.lobbyId || "", data: match });
        if (match.lobbyCode && !lobbyHistoryById.has(match.lobbyCode)) {
          lobbyHistoryById.set(match.lobbyCode, { id: String(match.lobbyCode), code: match.lobbyCode, data: { code: match.lobbyCode, theme: match.theme, settings: match.settings, players: match.players, trackHistory: match.trackHistory, createdAt: match.createdAt } });
        }
      }
    }
    const lobbyHistory = [...lobbyHistoryById.values()];
    return `
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('musicspy_user_store_write'));
DELETE FROM auth_sessions;
DELETE FROM match_history;
DELETE FROM lobby_history;
DELETE FROM player_progression;
DELETE FROM direct_messages;
DELETE FROM friend_requests;
DELETE FROM friendships;
DELETE FROM user_accounts;
INSERT INTO user_accounts (id, data, created_at, updated_at)
SELECT id, data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now()), COALESCE(NULLIF(data->>'updatedAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(users))}::jsonb) AS x(id text, data jsonb);
INSERT INTO auth_sessions (id, user_id, data, access_expires_at, refresh_expires_at, updated_at)
SELECT id, user_id, data, NULLIF(data->>'accessExpiresAt', '')::timestamptz, NULLIF(data->>'refreshExpiresAt', '')::timestamptz, COALESCE(NULLIF(data->>'updatedAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(sessions))}::jsonb) AS x(id text, user_id text, data jsonb)
WHERE user_id IN (SELECT id FROM user_accounts);
INSERT INTO friendships (id, user_a_id, user_b_id, data, created_at)
SELECT id, data->>'userAId', data->>'userBId', data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(friendships))}::jsonb) AS x(id text, data jsonb);
INSERT INTO friend_requests (id, sender_id, receiver_id, status, data, created_at, responded_at)
SELECT id, data->>'senderId', data->>'receiverId', COALESCE(data->>'status', 'pending'), data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now()), NULLIF(data->>'respondedAt', '')::timestamptz
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(friendRequests))}::jsonb) AS x(id text, data jsonb);
INSERT INTO direct_messages (id, conversation_id, sender_id, receiver_id, status, data, created_at)
SELECT id, data->>'conversationId', data->>'senderId', data->>'receiverId', COALESCE(data->>'status', 'pending'), data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(directMessages))}::jsonb) AS x(id text, data jsonb);
INSERT INTO match_history (id, user_id, lobby_id, data, created_at)
SELECT id, user_id, lobby_id, data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(matchHistory))}::jsonb) AS x(id text, user_id text, lobby_id text, data jsonb);
INSERT INTO lobby_history (id, code, data, created_at)
SELECT id, code, data, COALESCE(NULLIF(data->>'createdAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(lobbyHistory))}::jsonb) AS x(id text, code text, data jsonb)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;
INSERT INTO player_progression (user_id, data, updated_at)
SELECT id, jsonb_build_object('stats', data->'stats', 'settings', data->'settings', 'futureProgression', COALESCE(data->'progression', '{}'::jsonb)), COALESCE(NULLIF(data->>'updatedAt', '')::timestamptz, now())
FROM jsonb_to_recordset(${dollarQuote(JSON.stringify(users))}::jsonb) AS x(id text, data jsonb);
INSERT INTO musicspy_meta (key, value, updated_at) VALUES ('last_full_store_write', ${dollarQuote(JSON.stringify({ users: users.length, friendships: friendships.length, friendRequests: friendRequests.length, directMessages: directMessages.length, matchHistory: matchHistory.length, lobbyHistory: lobbyHistory.length }))}::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
COMMIT;
`;
  }
}

module.exports = {
  PostgresUserStorePersistence,
  SimplePgClient,
  buildPgUrl,
  databaseUrl,
  isRenderEnvironment,
  shouldUsePostgres
};
