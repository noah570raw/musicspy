const crypto = require("crypto");

const PASSWORD_ITERATIONS = 120000;
const AVATAR_MAX_BYTES = 64 * 1024;
const MAX_SESSIONS_PER_USER = 5;

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

function createSession(user, { save } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  user.sessions = [
    { tokenHash, createdAt: new Date().toISOString() },
    ...(user.sessions || []).slice(0, MAX_SESSIONS_PER_USER - 1)
  ];
  user.updatedAt = new Date().toISOString();
  save?.();
  return token;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function findUserByToken(users, token) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  return (users || []).find((user) => (user.sessions || []).some((session) => session.tokenHash === tokenHash)) || null;
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

function buildOAuthSuccessRedirect(returnTo = "/", token) {
  const url = new URL(returnTo, "http://musicspy.local");
  url.searchParams.set("auth_token", token);
  return `${url.pathname}${url.search}${url.hash}`;
}

module.exports = {
  AVATAR_MAX_BYTES,
  PASSWORD_ITERATIONS,
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
  validatePassword,
  verifyPassword
};
