'use strict';
// Keep 5 Delete 5: rooms and game rules. Everything lives in process memory.
// Ported from the standalone Keep 5 Delete 5 server; transport-agnostic (onChange callback).
const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRACK_COUNTS = [4, 6, 8, 10, 12, 14, 16, 20];
const TIMERS = [10, 15, 20, 30, 0]; // 0 = no timer
const REVEAL_MODES = ['each', 'end'];
const SOURCE_TYPES = ['album', 'artist'];
const MAX_PLAYERS = 8;
const NAME_MAX = 20;

const START_DELAY_MS = 1800; // pause before a track starts so everyone can load it
const REVEAL_MS = 5500; // how long others' picks show after a track ("after each track" mode)
const LOCK_MS = 1600; // pause between tracks in "at the end" mode
const FORCED_ALL_MS = 6000; // if every pick is forced, still let people listen
const MIN_LISTEN_MS = 700;
const WAIT_GRACE_MS = 12000; // how long a round waits for a dropped player
const OFFLINE_GRACE_MS = 30000; // when a dropped player leaves the lobby / host passes on
const ROOM_IDLE_MS = 15 * 60 * 1000;
const POOL_TTL_MS = 8 * 60 * 1000;
// Avatar colours: soft, no violet (DESIGN.md, "Player colours").
const COLORS = ['#e9a98f', '#8fcfbf', '#f0c674', '#9dbfe6', '#e69aa8', '#b5d68f', '#d8b48a', '#8cc4d6'];
const MAX_CHAT = 60;
const CHAT_MAX_LEN = 240;

class GameError extends Error {}

let deezer = null;
let onChange = () => {};
let onFinish = () => {};
let isCodeTaken = () => false;
// decorate(accountId) -> { cosmetics, level }: what the room shows next to a signed-in player (server.js)
let decorate = () => ({});
const rooms = new Map();

// opts.isCodeTaken: shared code registry with the Spy mode, so codes never collide.
// opts.onFinish(room): called once when a game reaches its results (stats for accounts).
function init(opts) {
  deezer = opts.deezer;
  if (opts.onChange) onChange = opts.onChange;
  if (opts.onFinish) onFinish = opts.onFinish;
  if (opts.isCodeTaken) isCodeTaken = opts.isCodeTaken;
  if (opts.decorate) decorate = opts.decorate;
  if (!opts.noSweep) setInterval(sweep, 2000).unref();
}

const newToken = () => crypto.randomBytes(16).toString('hex');
const newPid = () => crypto.randomBytes(6).toString('hex');
const normCode = (c) => String(c || '').trim().toUpperCase();

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i += 1) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(code) || isCodeTaken(code));
  return code;
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!n) throw new GameError('Enter a nickname');
  return n;
}

function uniqueName(room, name, exceptPid) {
  const taken = new Set([...room.players.values()].filter((p) => p.id !== exceptPid).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let i = 2;
  while (taken.has(`${name} ${i}`.toLowerCase())) i += 1;
  return `${name} ${i}`;
}

function touch(room) {
  room.lastActive = Date.now();
}

function addPlayer(room, name, account = {}) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
  const now = Date.now();
  const p = {
    id: newPid(), token: newToken(), name: uniqueName(room, name), color, connected: false, lastSeen: now, joinedAt: now,
    accountId: account.accountId || null, avatar: account.avatar || '',
  };
  room.players.set(p.id, p);
  return p;
}

function createRoom(name, account = {}) {
  const clean = cleanName(name);
  const room = {
    code: genCode(),
    hostId: null,
    players: new Map(),
    settings: { trackCount: 10, revealMode: 'each', timer: 30 },
    source: null,
    pool: null,
    poolFetchedAt: 0,
    sourceLoading: null,
    phase: 'lobby',
    game: null,
    timer: null,
    chat: [],
    isOpen: false, // listed in "Open rooms" on the home screen
    createdAt: Date.now(),
    lastActive: Date.now(),
  };
  const p = addPlayer(room, clean, account);
  room.hostId = p.id;
  rooms.set(room.code, room);
  return { code: room.code, pid: p.id, token: p.token };
}

function joinRoom({ code, name, pid, token, accountId, avatar }) {
  const room = rooms.get(normCode(code));
  if (!room) throw new GameError('Room not found. Check the code');
  if (pid && token) {
    const existing = room.players.get(pid);
    if (existing && existing.token === token) {
      if (name) {
        try { existing.name = uniqueName(room, cleanName(name), existing.id); } catch { /* keep the old nickname */ }
      }
      if (accountId !== undefined) {
        existing.accountId = accountId || null;
        existing.avatar = avatar || '';
      }
      touch(room);
      onChange(room);
      return { code: room.code, pid: existing.id, token: existing.token };
    }
  }
  const clean = cleanName(name);
  if (room.players.size >= MAX_PLAYERS) throw new GameError(`Room is full (${MAX_PLAYERS} players max)`);
  const p = addPlayer(room, clean, { accountId, avatar });
  if (!room.players.has(room.hostId)) room.hostId = p.id;
  touch(room);
  onChange(room);
  return { code: room.code, pid: p.id, token: p.token };
}

function auth(code, pid, token) {
  const room = rooms.get(normCode(code));
  if (!room) return null;
  const player = room.players.get(String(pid || ''));
  if (!player || player.token !== token) return null;
  return { room, player };
}

function setConnected(room, pid, connected) {
  const p = room.players.get(pid);
  if (!p) return;
  p.connected = connected;
  p.lastSeen = Date.now();
  touch(room);
  onChange(room);
}

function isActive(room, pid, now = Date.now()) {
  const p = room.players.get(pid);
  return Boolean(p && (p.connected || now - p.lastSeen < WAIT_GRACE_MS));
}

function pickNewHost(room) {
  const candidates = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const next = candidates.find((p) => p.connected) || candidates[0];
  room.hostId = next ? next.id : null;
}

function deleteRoom(room) {
  clearTimeout(room.timer);
  rooms.delete(room.code);
}

function sweep() {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    let changed = false;
    if (room.phase !== 'playing' && room.phase !== 'loading') {
      for (const p of [...room.players.values()]) {
        if (!p.connected && now - p.lastSeen > OFFLINE_GRACE_MS) {
          room.players.delete(p.id);
          changed = true;
        }
      }
    }
    const host = room.players.get(room.hostId);
    if (!host || (!host.connected && now - host.lastSeen > OFFLINE_GRACE_MS)) {
      const before = room.hostId;
      pickNewHost(room);
      if (room.hostId !== before) changed = true;
    }
    const anyoneOnline = [...room.players.values()].some((p) => p.connected);
    if (room.players.size === 0 || (!anyoneOnline && now - room.lastActive > ROOM_IDLE_MS)) {
      deleteRoom(room);
      continue;
    }
    if (room.phase === 'playing') maybeAdvance(room);
    if (changed) onChange(room);
  }
}

// ---------- settings ----------

function allowedCounts(room) {
  const pool = room.source ? room.source.poolSize : Infinity;
  const list = TRACK_COUNTS.filter((n) => n <= pool);
  if (!list.length && pool >= 2) return [2];
  return list;
}

function fitTrackCount(room) {
  const allowed = allowedCounts(room);
  if (!allowed.length || allowed.includes(room.settings.trackCount)) return;
  const lower = allowed.filter((n) => n <= room.settings.trackCount);
  room.settings.trackCount = lower.length ? lower[lower.length - 1] : allowed[0];
}

function setSettings(room, payload) {
  if (room.phase !== 'lobby' && room.phase !== 'results') throw new GameError('Settings can only change in the lobby');
  const s = { ...room.settings };
  if (payload.trackCount !== undefined) {
    const n = Number(payload.trackCount);
    if (!allowedCounts(room).includes(n)) throw new GameError('That track count is not available');
    s.trackCount = n;
  }
  if (payload.revealMode !== undefined) {
    if (!REVEAL_MODES.includes(payload.revealMode)) throw new GameError('Unknown mode');
    s.revealMode = payload.revealMode;
  }
  if (payload.timer !== undefined) {
    const t = Number(payload.timer);
    if (!TIMERS.includes(t)) throw new GameError('Invalid timer');
    s.timer = t;
  }
  room.settings = s;
  onChange(room);
  return { ok: true };
}

async function loadPool(type, id) {
  return type === 'album' ? deezer.albumPool(id) : deezer.artistPool(id);
}

async function setSource(room, payload) {
  if (room.phase !== 'lobby' && room.phase !== 'results') throw new GameError('The music can only change in the lobby');
  const type = payload.type;
  const id = String(payload.id || '').replace(/\D/g, '');
  if (!SOURCE_TYPES.includes(type) || !id) throw new GameError('Invalid source');
  const reqId = newToken();
  room.sourceLoading = { type, id, reqId };
  onChange(room);
  let res;
  try {
    res = await loadPool(type, id);
  } catch (err) {
    if (room.sourceLoading && room.sourceLoading.reqId === reqId) {
      room.sourceLoading = null;
      onChange(room);
    }
    console.warn('[deezer]', err.message);
    throw new GameError('Could not load tracks from Deezer. Try again');
  }
  if (!room.sourceLoading || room.sourceLoading.reqId !== reqId) return { ok: true, stale: true };
  room.sourceLoading = null;
  if (res.tracks.length < 2) {
    onChange(room);
    throw new GameError('Almost no tracks here have previews. Pick something else');
  }
  room.source = { ...res.source, type, id, poolSize: res.tracks.length };
  room.pool = res.tracks;
  room.poolFetchedAt = Date.now();
  fitTrackCount(room);
  if (room.phase === 'results') {
    room.phase = 'lobby';
    room.game = null;
  }
  onChange(room);
  return { ok: true };
}

// ---------- game ----------

function countChoices(g, pid) {
  const counts = { keep: 0, delete: 0 };
  for (const ch of g.choices[pid] || []) if (ch) counts[ch.c] += 1;
  return counts;
}

function forcedChoice(g, pid) {
  const { keep, delete: del } = countChoices(g, pid);
  if (keep >= g.half) return 'delete';
  if (del >= g.half) return 'keep';
  return null;
}

async function startGame(room) {
  if (room.phase === 'playing' || room.phase === 'loading') throw new GameError('The game is already running');
  if (!room.source) throw new GameError('Pick an album or an artist first');
  const prevPhase = room.phase;
  room.phase = 'loading';
  onChange(room);
  try {
    if (!room.pool || Date.now() - room.poolFetchedAt > POOL_TTL_MS) {
      const res = await loadPool(room.source.type, room.source.id);
      room.pool = res.tracks;
      room.poolFetchedAt = Date.now();
      room.source.poolSize = res.tracks.length;
      fitTrackCount(room);
    }
    if (room.pool.length < room.settings.trackCount) throw new GameError(`Only ${room.pool.length} tracks have previews`);
  } catch (err) {
    room.phase = prevPhase;
    onChange(room);
    if (err instanceof GameError) throw err;
    console.warn('[deezer]', err.message);
    throw new GameError('Could not load tracks. Try again');
  }
  let participants = [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  if (!participants.length) participants = [...room.players.values()];
  const n = room.settings.trackCount;
  room.game = {
    id: newToken(),
    tracks: shuffle(room.pool).slice(0, n).map((t) => ({ ...t })),
    half: n / 2,
    round: -1,
    roundPhase: null,
    startsAt: 0,
    endsAt: null,
    phaseEndsAt: null,
    pendingEnd: false,
    settings: { ...room.settings },
    source: { ...room.source },
    roster: participants.map((p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar || '', accountId: p.accountId || null })),
    participants: participants.map((p) => p.id),
    choices: Object.fromEntries(participants.map((p) => [p.id, Array(n).fill(null)])),
  };
  room.phase = 'playing';
  nextRound(room);
  return { ok: true };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function nextRound(room) {
  const g = room.game;
  if (!g) return;
  clearTimeout(room.timer);
  g.round += 1;
  g.pendingEnd = false;
  if (g.round >= g.tracks.length) {
    finish(room);
    return;
  }
  const r = g.round;
  const track = g.tracks[r];
  g.roundPhase = 'loading';
  // Deezer preview links are signed and expire, so refresh before each round.
  if (deezer.trackPreview) {
    try {
      const fresh = await withTimeout(deezer.trackPreview(track.id), 2500);
      if (fresh) track.preview = fresh;
    } catch { /* play the old link */ }
  }
  if (room.game !== g || g.round !== r || room.phase !== 'playing') return;
  const now = Date.now();
  g.roundPhase = 'listening';
  g.startsAt = now + START_DELAY_MS;
  g.endsAt = g.settings.timer ? g.startsAt + g.settings.timer * 1000 : null;
  g.phaseEndsAt = null;
  for (const pid of g.participants) {
    const forced = forcedChoice(g, pid);
    if (forced) g.choices[pid][r] = { c: forced, how: 'forced' };
  }
  if (g.endsAt) room.timer = setTimeout(() => endRound(room, g, r), g.endsAt - now);
  onChange(room);
  maybeAdvance(room);
}

function maybeAdvance(room) {
  const g = room.game;
  if (!g || room.phase !== 'playing' || g.roundPhase !== 'listening') return false;
  const r = g.round;
  const now = Date.now();
  const waiting = g.participants.some((pid) => isActive(room, pid, now) && !g.choices[pid][r]);
  if (waiting) return false;
  const allForced = g.participants.every((pid) => g.choices[pid][r] && g.choices[pid][r].how === 'forced');
  const minEnd = g.startsAt + (allForced ? FORCED_ALL_MS : MIN_LISTEN_MS);
  if (now < minEnd) {
    if (!g.pendingEnd) {
      g.pendingEnd = true;
      clearTimeout(room.timer);
      room.timer = setTimeout(() => endRound(room, g, r), minEnd - now);
    }
    return false;
  }
  endRound(room, g, r);
  return true;
}

function endRound(room, g, r) {
  if (room.game !== g || g.round !== r || g.roundPhase !== 'listening') return;
  clearTimeout(room.timer);
  g.pendingEnd = false;
  for (const pid of g.participants) {
    if (!g.choices[pid][r]) {
      const c = forcedChoice(g, pid) || (crypto.randomInt(2) ? 'keep' : 'delete');
      g.choices[pid][r] = { c, how: 'auto' };
    }
  }
  g.roundPhase = 'reveal';
  const dur = g.settings.revealMode === 'each' ? REVEAL_MS : LOCK_MS;
  g.phaseEndsAt = Date.now() + dur;
  room.timer = setTimeout(() => {
    if (room.game === g && g.round === r) nextRound(room);
  }, dur);
  onChange(room);
}

function finish(room) {
  clearTimeout(room.timer);
  const g = room.game;
  g.roundPhase = null;
  g.round = g.tracks.length;
  room.phase = 'results';
  try { onFinish(room); } catch (err) { console.warn('[k5d5] onFinish failed', err.message); }
  onChange(room);
}

function sendChat(room, player, text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
  if (!body) throw new GameError('Write a message');
  room.chat = [...(room.chat || []), {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    playerId: player.id, playerName: player.name, color: player.color, text: body, createdAt: Date.now(),
  }].slice(-MAX_CHAT);
  onChange(room);
  return { ok: true };
}

function kick(room, host, targetId) {
  const target = room.players.get(String(targetId || ''));
  if (!target) throw new GameError('Player not found');
  if (target.id === host.id) throw new GameError('You cannot remove yourself');
  room.players.delete(target.id);
  onChange(room);
  if (room.phase === 'playing') maybeAdvance(room);
  return { ok: true };
}

function choose(room, player, c) {
  if (c !== 'keep' && c !== 'delete') throw new GameError('Invalid pick');
  const g = room.game;
  if (room.phase !== 'playing' || !g) throw new GameError('No game is running');
  if (!g.participants.includes(player.id)) throw new GameError('You are watching. You join from the next game');
  if (g.roundPhase !== 'listening') throw new GameError('This track is already closed');
  const r = g.round;
  if (g.choices[player.id][r]) throw new GameError('Your pick is locked and cannot change');
  if (countChoices(g, player.id)[c] >= g.half) {
    throw new GameError(c === 'keep' ? 'No Keep slots left' : 'No Delete slots left');
  }
  g.choices[player.id][r] = { c, how: 'manual' };
  onChange(room);
  maybeAdvance(room);
  return { ok: true };
}

function toLobby(room) {
  clearTimeout(room.timer);
  room.phase = 'lobby';
  room.game = null;
  onChange(room);
  return { ok: true };
}

function leave(room, player) {
  room.players.delete(player.id);
  if (room.players.size === 0) {
    deleteRoom(room);
    return { ok: true };
  }
  if (room.hostId === player.id) pickNewHost(room);
  onChange(room);
  if (room.phase === 'playing') maybeAdvance(room);
  return { ok: true };
}

async function action(code, pid, token, type, payload = {}) {
  const a = auth(code, pid, token);
  if (!a) throw new GameError('Session expired. Join the room again');
  const { room, player } = a;
  touch(room);
  const hostOnly = () => {
    if (room.hostId !== player.id) throw new GameError('Only the host can do that');
  };
  switch (type) {
    case 'setSource': hostOnly(); return setSource(room, payload || {});
    case 'setSettings': hostOnly(); return setSettings(room, payload || {});
    case 'start':
    case 'again': hostOnly(); return startGame(room);
    case 'toLobby': hostOnly(); return toLobby(room);
    case 'choose': return choose(room, player, payload && payload.choice);
    case 'leave': return leave(room, player);
    case 'chat': return sendChat(room, player, payload && payload.text);
    case 'setOpen': hostOnly(); room.isOpen = Boolean(payload && payload.open); onChange(room); return { ok: true };
    case 'kick': hostOnly(); return kick(room, player, payload && payload.playerId);
    default: throw new GameError('Unknown action');
  }
}

// ---------- what a given player sees ----------

function publicTrack(t, withPreview) {
  return { id: t.id, title: t.title, version: t.version || '', artist: t.artist, album: t.album, cover: t.cover, preview: withPreview ? t.preview : null };
}

function viewFor(room, pid) {
  const view = {
    code: room.code,
    phase: room.phase,
    meId: pid,
    hostId: room.hostId,
    isHost: room.hostId === pid,
    players: [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, avatar: p.avatar || '', accountId: p.accountId || null, ...(p.accountId ? decorate(p.accountId) : {}) })),
    isOpen: Boolean(room.isOpen),
    chat: room.chat || [],
    settings: room.settings,
    source: room.source,
    sourceLoading: room.sourceLoading ? { type: room.sourceLoading.type, id: room.sourceLoading.id } : null,
    limits: { trackCounts: allowedCounts(room), allTrackCounts: TRACK_COUNTS, timers: TIMERS, maxPlayers: MAX_PLAYERS },
    game: null,
  };
  const g = room.game;
  if (!g) return view;
  const n = g.tracks.length;
  const results = room.phase === 'results';
  const r = g.round;
  let revealUpTo = -1;
  if (results) revealUpTo = n - 1;
  else if (g.settings.revealMode === 'each') revealUpTo = g.roundPhase === 'reveal' ? r : r - 1;
  const visibleCount = results ? n : Math.min(n, r + 1);
  const choices = {};
  for (const id of g.participants) {
    choices[id] = g.choices[id].map((ch, i) => {
      if (!ch) return null;
      if (id === pid || i <= revealUpTo) return ch;
      return null;
    });
  }
  view.game = {
    round: r,
    total: n,
    half: g.half,
    roundPhase: g.roundPhase,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    phaseEndsAt: g.phaseEndsAt,
    settings: g.settings,
    source: g.source,
    roster: g.roster,
    isParticipant: g.participants.includes(pid),
    tracks: g.tracks.slice(0, visibleCount).map((t, i) => publicTrack(t, results || i === r)),
    choices,
    decided: g.roundPhase === 'listening' || g.roundPhase === 'reveal' ? g.participants.filter((id) => g.choices[id][r]) : [],
  };
  return view;
}

module.exports = {
  init, createRoom, joinRoom, auth, setConnected, action, viewFor, GameError, hasRoom: (code) => rooms.has(normCode(code)),
  findRoom: (code) => rooms.get(normCode(code)) || null, rooms,
  _rooms: rooms, _sweep: sweep, _nextRoundForTest: nextRound,
};
