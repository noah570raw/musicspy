const crypto = require("crypto");

const PASSWORD_ITERATIONS = 120000;
const AVATAR_MAX_BYTES = 64 * 1024;
const MAX_SESSIONS_PER_USER = 10;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 72;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
  return { salt, hash };
}

function timingSafeHexEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const { hash } = hashPassword(password, user.salt);
  return timingSafeHexEqual(hash, user.passwordHash);
}

function tokenExpiry(ttlMs, now = Date.now()) {
  return new Date(now + ttlMs).toISOString();
}

function createSession(user, { save, now = Date.now() } = {}) {
  const accessToken = crypto.randomBytes(32).toString("hex");
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const session = {
    id: crypto.randomUUID(),
    accessTokenHash: hashSessionToken(accessToken),
    refreshTokenHash: hashSessionToken(refreshToken),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    accessExpiresAt: tokenExpiry(ACCESS_TOKEN_TTL_MS, now),
    refreshExpiresAt: tokenExpiry(REFRESH_TOKEN_TTL_MS, now)
  };
  user.sessions = [session, ...(user.sessions || []).filter((item) => !sessionIsExpired(item, "refresh", now)).slice(0, MAX_SESSIONS_PER_USER - 1)];
  user.updatedAt = session.updatedAt;
  save?.();
  return { accessToken, refreshToken, accessExpiresAt: session.accessExpiresAt, refreshExpiresAt: session.refreshExpiresAt };
}

function refreshSession(users, refreshToken, { save, now = Date.now() } = {}) {
  const found = findSessionByRefreshToken(users, refreshToken, now);
  if (!found) return null;
  const { user, session } = found;
  const accessToken = crypto.randomBytes(32).toString("hex");
  const nextRefreshToken = crypto.randomBytes(48).toString("hex");
  session.accessTokenHash = hashSessionToken(accessToken);
  session.refreshTokenHash = hashSessionToken(nextRefreshToken);
  session.updatedAt = new Date(now).toISOString();
  session.accessExpiresAt = tokenExpiry(ACCESS_TOKEN_TTL_MS, now);
  session.refreshExpiresAt = tokenExpiry(REFRESH_TOKEN_TTL_MS, now);
  user.sessions = (user.sessions || []).filter((item) => !sessionIsExpired(item, "refresh", now));
  user.updatedAt = session.updatedAt;
  save?.();
  return { user, tokens: { accessToken, refreshToken: nextRefreshToken, accessExpiresAt: session.accessExpiresAt, refreshExpiresAt: session.refreshExpiresAt } };
}

function revokeRefreshToken(user, refreshToken, { save } = {}) {
  if (!user || !refreshToken) return false;
  const refreshTokenHash = hashSessionToken(refreshToken);
  const before = (user.sessions || []).length;
  user.sessions = (user.sessions || []).filter((session) => session.refreshTokenHash !== refreshTokenHash && session.tokenHash !== refreshTokenHash);
  const changed = user.sessions.length !== before;
  if (changed) {
    user.updatedAt = new Date().toISOString();
    save?.();
  }
  return changed;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function sessionIsExpired(session, type = "access", now = Date.now()) {
  const expiresAt = type === "refresh" ? session.refreshExpiresAt : session.accessExpiresAt;
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= now;
}

function findUserByToken(users, token, { now = Date.now() } = {}) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  return (users || []).find((user) => (user.sessions || []).some((session) => {
    if (session.accessTokenHash === tokenHash) return !sessionIsExpired(session, "access", now);
    return session.tokenHash === tokenHash && !sessionIsExpired(session, "refresh", now);
  })) || null;
}

function findSessionByRefreshToken(users, refreshToken, now = Date.now()) {
  if (!refreshToken) return null;
  const tokenHash = hashSessionToken(refreshToken);
  for (const user of users || []) {
    const session = (user.sessions || []).find((item) => (item.refreshTokenHash === tokenHash || item.tokenHash === tokenHash) && !sessionIsExpired(item, "refresh", now));
    if (session) return { user, session };
  }
  return null;
}

function buildOAuthTokenRequest(config, code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: config.redirectUri
  });
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

  if (config.tokenAuthStyle === "basic") {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }

  return { method: "POST", headers, body };
}

async function parseOAuthResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return { raw: await response.text() };
}

function normalizeOAuthProfile(provider, rawProfile = {}) {
  if (provider === "google") {
    return {
      providerId: rawProfile.sub,
      email: rawProfile.email || "",
      username: rawProfile.email ? String(rawProfile.email).split("@")[0] : rawProfile.name,
      displayName: rawProfile.name || rawProfile.email || "Google player",
      avatar: rawProfile.picture || ""
    };
  }

  const avatar = rawProfile.avatar
    ? `https://cdn.discordapp.com/avatars/${rawProfile.id}/${rawProfile.avatar}.png?size=128`
    : "";
  return {
    providerId: rawProfile.id,
    email: rawProfile.email || "",
    username: rawProfile.username || rawProfile.global_name,
    displayName: rawProfile.global_name || rawProfile.username || "Discord player",
    avatar
  };
}

function normalizeAvatar(avatar) {
  const value = String(avatar || "");
  if (!value) return "";
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value)) {
    throw new Error("Поддерживаются только PNG, JPG, WEBP или GIF");
  }
  const size = Buffer.byteLength(value, "utf8");
  if (size > AVATAR_MAX_BYTES) {
    throw new Error("Аватарка слишком большая. Максимум 64 КБ после сжатия");
  }
  return value;
}

function buildOAuthErrorRedirect(returnTo = "/", message = "OAuth login failed") {
  const url = new URL(returnTo, "http://musicspy.local");
  url.searchParams.set("auth_error", message);
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildOAuthSuccessRedirect(returnTo = "/", sessionOrToken) {
  const url = new URL(returnTo, "http://musicspy.local");
  if (typeof sessionOrToken === "string") {
    url.searchParams.set("auth_token", sessionOrToken);
  } else {
    url.searchParams.set("auth_access_token", sessionOrToken.accessToken);
    url.searchParams.set("auth_refresh_token", sessionOrToken.refreshToken);
    url.searchParams.set("auth_token", sessionOrToken.accessToken);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

module.exports = {
  ACCESS_TOKEN_TTL_MS,
  AVATAR_MAX_BYTES,
  PASSWORD_ITERATIONS,
  REFRESH_TOKEN_TTL_MS,
  buildOAuthErrorRedirect,
  buildOAuthSuccessRedirect,
  buildOAuthTokenRequest,
  createSession,
  findUserByToken,
  hashPassword,
  hashSessionToken,
  normalizeAvatar,
  normalizeOAuthProfile,
  normalizeUsername,
  parseOAuthResponse,
  refreshSession,
  revokeRefreshToken,
  validatePassword,
  verifyPassword
};
