'use strict';
// King of the Hill: rooms and bracket rules. Everything lives in process memory.
// Tracks from an album or a discography meet in pairs; the winner of each duel moves up until one is left.
// Two styles:
//   vote  one shared bracket. Everyone votes, the majority wins. On a tie the voters either agree to a draw
//         (both tracks go through) or one of them concedes (their vote goes to the other track).
//   solo  everyone runs their own copy of the same bracket at their own pace; kings are compared at the end.
// Same room machinery as Keep 5 Delete 5 (lib/k5d5/game.js); transport-agnostic (onChange callback).
const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIZES = [4, 8, 16, 32];
const TIMERS = [20, 30, 45, 60, 0]; // seconds per duel in the vote style, 0 = no timer
const STYLES = ['vote', 'solo'];
const SOURCE_TYPES = ['album', 'artist'];
const MAX_PLAYERS = 8;
const NAME_MAX = 20;

const START_DELAY_MS = 1200; // pause before a duel opens so everyone can load both previews
const REVEAL_MS = 4200; // how long the result of a duel stays up
const TIE_MS = 15000; // time to agree to a draw or concede; silence counts as a draw
const MIN_LISTEN_MS = 700;
const MAX_DRAW_ROUNDS = 8; // from this round on a tie outside the final is settled by a coin flip
const PREVIEW_FRESH_MS = 5 * 60 * 1000; // Deezer preview links are signed and expire
const WAIT_GRACE_MS = 12000; // how long a duel waits for a dropped player
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
const other = (side) => (side === 'a' ? 'b' : 'a');

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

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
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
    settings: { size: 8, style: 'vote', timer: 30 },
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
    if (room.phase === 'playing') checkProgress(room);
    if (changed) onChange(room);
  }
}

// ---------- bracket ----------

function roundName(n) {
  if (n <= 2) return 'Final';
  if (n <= 4) return 'Semifinals';
  if (n <= 8) return 'Quarterfinals';
  if (n <= 16) return 'Round of 16';
  return 'Round of 32';
}

// Pairs the entrants of a round in bracket order. With an odd count (only after a draw) one entrant sits the
// round out, preferring one that did not just have a bye; two tracks that drew are kept apart when possible.
function makeRound(entrants, prev = null) {
  let list = [...entrants];
  let bye = null;
  if (list.length % 2) {
    const options = list.filter((t) => !prev || t !== prev.bye);
    bye = options[crypto.randomInt(options.length)];
    list = list.filter((t) => t !== bye);
  }
  const drew = new Set();
  if (prev) {
    for (const m of prev.matches) {
      if (m.how === 'draw') drew.add(`${m.a}-${m.b}`).add(`${m.b}-${m.a}`);
    }
  }
  const matches = [];
  while (list.length) {
    const a = list.shift();
    let j = list.findIndex((b) => !drew.has(`${a}-${b}`));
    if (j < 0) j = 0;
    const [b] = list.splice(j, 1);
    matches.push({ a, b, winners: null, how: null });
  }
  return { name: roundName(entrants.length), size: entrants.length, entrants: [...entrants], matches, bye };
}

function roundWinners(round) {
  const out = [];
  for (const t of round.entrants) {
    if (t === round.bye) {
      out.push(t);
      continue;
    }
    const m = round.matches.find((x) => x.a === t || x.b === t);
    if (m && m.winners && m.winners.includes(t)) out.push(t);
  }
  return out;
}

const cloneRound = (r) => ({ ...r, entrants: [...r.entrants], matches: r.matches.map((m) => ({ ...m })) });

// ---------- settings ----------

function allowedSizes(room) {
  const pool = room.source ? room.source.poolSize : Infinity;
  return SIZES.filter((n) => n <= pool);
}

function fitSize(room) {
  const allowed = allowedSizes(room);
  if (!allowed.length || allowed.includes(room.settings.size)) return;
  const lower = allowed.filter((n) => n <= room.settings.size);
  room.settings.size = lower.length ? lower[lower.length - 1] : allowed[0];
}

function setSettings(room, payload) {
  if (room.phase !== 'lobby' && room.phase !== 'results') throw new GameError('Settings can only change in the lobby');
  const s = { ...room.settings };
  if (payload.size !== undefined) {
    const n = Number(payload.size);
    if (!allowedSizes(room).includes(n)) throw new GameError('That bracket size is not available');
    s.size = n;
  }
  if (payload.style !== undefined) {
    if (!STYLES.includes(payload.style)) throw new GameError('Unknown style');
    s.style = payload.style;
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
  if (res.tracks.length < SIZES[0]) {
    onChange(room);
    throw new GameError(`Fewer than ${SIZES[0]} tracks here have previews. Pick something else`);
  }
  room.source = { ...res.source, type, id, poolSize: res.tracks.length };
  room.pool = res.tracks;
  room.poolFetchedAt = Date.now();
  fitSize(room);
  if (room.phase === 'results') {
    room.phase = 'lobby';
    room.game = null;
  }
  onChange(room);
  return { ok: true };
}

// ---------- previews ----------

// Re-fetches the signed preview links of these tracks if they are getting old. Resolves to true if any changed.
async function refreshPreviews(g, idxs, force = false) {
  if (!deezer.trackPreview) return false;
  const now = Date.now();
  const todo = [...new Set(idxs)].filter((i) => g.tracks[i] && now - (g.tracks[i].freshAt || 0) > (force ? 20000 : PREVIEW_FRESH_MS));
  if (!todo.length) return false;
  let changed = false;
  await Promise.all(todo.map(async (i) => {
    const t = g.tracks[i];
    t.freshAt = now;
    try {
      const fresh = await withTimeout(deezer.trackPreview(t.id), 2500);
      if (fresh && fresh !== t.preview) {
        t.preview = fresh;
        changed = true;
      }
    } catch { /* keep the old link */ }
  }));
  return changed;
}

// ---------- game ----------

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
      fitSize(room);
    }
    if (room.pool.length < room.settings.size) throw new GameError(`Only ${room.pool.length} tracks have previews`);
  } catch (err) {
    room.phase = prevPhase;
    onChange(room);
    if (err instanceof GameError) throw err;
    console.warn('[deezer]', err.message);
    throw new GameError('Could not load tracks. Try again');
  }
  let participants = [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  if (!participants.length) participants = [...room.players.values()];
  const n = room.settings.size;
  const settings = { ...room.settings };
  const first = makeRound(Array.from({ length: n }, (_, i) => i));
  const g = {
    id: newToken(),
    style: settings.style,
    settings,
    source: { ...room.source },
    tracks: shuffle(room.pool).slice(0, n).map((t) => ({ ...t, freshAt: room.poolFetchedAt })),
    roster: participants.map((p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar || '', accountId: p.accountId || null })),
    participants: participants.map((p) => p.id),
    rounds: [first],
    ri: 0,
    mi: 0,
    phase: 'loading', // vote style: loading | voting | tie | reveal
    startsAt: 0,
    endsAt: null,
    phaseEndsAt: null,
    pendingEnd: false,
    votes: {},
    tie: null,
    champions: null,
    solo: null,
  };
  room.game = g;
  room.phase = 'playing';
  if (g.style === 'solo') {
    g.phase = null;
    g.rounds = null;
    g.seed = first;
    g.solo = Object.fromEntries(g.participants.map((pid) => [pid, { rounds: [cloneRound(first)], ri: 0, mi: 0, done: false, champion: null, picks: 0 }]));
    g.startsAt = Date.now() + START_DELAY_MS;
    const m = first.matches[0];
    await refreshPreviews(g, [m.a, m.b]);
    if (room.game === g) onChange(room);
    return { ok: true };
  }
  startMatch(room);
  return { ok: true };
}

const curRound = (g) => g.rounds[g.ri];
const curMatch = (g) => g.rounds[g.ri].matches[g.mi];

async function startMatch(room) {
  const g = room.game;
  if (!g) return;
  clearTimeout(room.timer);
  const ri = g.ri;
  const mi = g.mi;
  const m = curMatch(g);
  g.phase = 'loading';
  g.votes = {};
  g.tie = null;
  g.pendingEnd = false;
  onChange(room);
  await refreshPreviews(g, [m.a, m.b]);
  if (room.game !== g || g.ri !== ri || g.mi !== mi || room.phase !== 'playing') return;
  const now = Date.now();
  g.phase = 'voting';
  g.startsAt = now + START_DELAY_MS;
  g.endsAt = g.settings.timer ? g.startsAt + g.settings.timer * 1000 : null;
  g.phaseEndsAt = null;
  if (g.endsAt) room.timer = setTimeout(() => closeVoting(room, g, ri, mi), g.endsAt - now);
  onChange(room);
  maybeCloseVoting(room);
}

const sameMatch = (room, g, ri, mi) => room.game === g && g.ri === ri && g.mi === mi && room.phase === 'playing';

function maybeCloseVoting(room) {
  const g = room.game;
  if (!g || room.phase !== 'playing' || g.phase !== 'voting') return false;
  const now = Date.now();
  const waiting = g.participants.some((pid) => isActive(room, pid, now) && !g.votes[pid]);
  if (waiting) return false;
  const minEnd = g.startsAt + MIN_LISTEN_MS;
  const { ri, mi } = g;
  if (now < minEnd) {
    if (!g.pendingEnd) {
      g.pendingEnd = true;
      clearTimeout(room.timer);
      room.timer = setTimeout(() => closeVoting(room, g, ri, mi), minEnd - now);
    }
    return false;
  }
  closeVoting(room, g, ri, mi);
  return true;
}

function tally(g, votes = g.votes) {
  const t = { a: 0, b: 0 };
  for (const pid of g.participants) if (votes[pid]) t[votes[pid]] += 1;
  return t;
}

function drawsAllowed(g) {
  return curRound(g).size === 2 || g.rounds.length < MAX_DRAW_ROUNDS;
}

function closeVoting(room, g, ri, mi) {
  if (!sameMatch(room, g, ri, mi) || g.phase !== 'voting') return;
  clearTimeout(room.timer);
  g.pendingEnd = false;
  const m = curMatch(g);
  const t = tally(g);
  if (t.a !== t.b) {
    resolve(room, g, [t.a > t.b ? m.a : m.b], 'votes');
    return;
  }
  if (!t.a || !drawsAllowed(g)) {
    resolve(room, g, [crypto.randomInt(2) ? m.a : m.b], 'coin');
    return;
  }
  const now = Date.now();
  g.phase = 'tie';
  g.tie = { voters: g.participants.filter((pid) => g.votes[pid]), answers: {} };
  g.phaseEndsAt = now + TIE_MS;
  room.timer = setTimeout(() => endTie(room, g, ri, mi), TIE_MS);
  onChange(room);
  maybeEndTie(room);
}

function maybeEndTie(room) {
  const g = room.game;
  if (!g || room.phase !== 'playing' || g.phase !== 'tie') return false;
  const now = Date.now();
  const waiting = g.tie.voters.some((pid) => isActive(room, pid, now) && !g.tie.answers[pid]);
  if (waiting) return false;
  endTie(room, g, g.ri, g.mi);
  return true;
}

// Everyone agreed, or the clock ran out (silence = agreeing): both tracks go through.
function endTie(room, g, ri, mi) {
  if (!sameMatch(room, g, ri, mi) || g.phase !== 'tie') return;
  const m = curMatch(g);
  resolve(room, g, [m.a, m.b], 'draw');
}

function resolve(room, g, winners, how, extra = {}) {
  clearTimeout(room.timer);
  const m = curMatch(g);
  m.winners = winners;
  m.how = how;
  m.votes = { ...g.votes };
  m.tally = tally(g);
  if (g.tie) m.tieAnswers = { ...g.tie.answers };
  Object.assign(m, extra);
  g.phase = 'reveal';
  g.phaseEndsAt = Date.now() + REVEAL_MS;
  const { ri, mi } = g;
  room.timer = setTimeout(() => {
    if (sameMatch(room, g, ri, mi)) advance(room);
  }, REVEAL_MS);
  onChange(room);
}

function advance(room) {
  const g = room.game;
  const round = curRound(g);
  g.mi += 1;
  if (g.mi < round.matches.length) {
    startMatch(room);
    return;
  }
  const winners = roundWinners(round);
  if (winners.length === 1 || (round.size === 2 && winners.length === 2)) {
    g.champions = winners;
    finish(room);
    return;
  }
  g.rounds.push(makeRound(winners, round));
  g.ri += 1;
  g.mi = 0;
  startMatch(room);
}

function vote(room, player, side) {
  if (side !== 'a' && side !== 'b') throw new GameError('Invalid pick');
  const g = room.game;
  if (room.phase !== 'playing' || !g) throw new GameError('No game is running');
  if (!g.participants.includes(player.id)) throw new GameError('You are watching. You join from the next game');
  if (g.style === 'solo') return soloPick(room, g, player, side);
  if (g.phase !== 'voting') throw new GameError('This duel is already closed');
  g.votes[player.id] = side;
  onChange(room);
  maybeCloseVoting(room);
  return { ok: true };
}

function answerTie(room, player, answer) {
  const g = room.game;
  if (room.phase !== 'playing' || !g || g.phase !== 'tie') throw new GameError('There is no tie to settle');
  if (!g.tie.voters.includes(player.id)) throw new GameError('Only the players who voted settle a tie');
  if (g.tie.answers[player.id]) throw new GameError('You already answered');
  if (answer === 'concede') {
    // the votes stay as cast (the bracket shows 1 to 1, conceded); the other track goes through
    const mine = g.votes[player.id];
    const m = curMatch(g);
    g.tie.answers[player.id] = 'concede';
    resolve(room, g, [m[other(mine)]], 'concede', { concededBy: player.id });
    return { ok: true };
  }
  if (answer !== 'draw') throw new GameError('Invalid answer');
  g.tie.answers[player.id] = 'draw';
  onChange(room);
  maybeEndTie(room);
  return { ok: true };
}

// ---------- solo style ----------

function soloPick(room, g, player, side) {
  const st = g.solo[player.id];
  if (!st || st.done) throw new GameError('Your bracket is finished');
  if (Date.now() < g.startsAt) throw new GameError('Get ready');
  const round = st.rounds[st.ri];
  const m = round.matches[st.mi];
  m.winners = [m[side]];
  m.how = 'pick';
  st.picks += 1;
  st.mi += 1;
  if (st.mi >= round.matches.length) {
    const winners = roundWinners(round);
    if (winners.length === 1) {
      st.done = true;
      st.champion = winners[0];
    } else {
      st.rounds.push(makeRound(winners, round));
      st.ri += 1;
      st.mi = 0;
    }
  }
  onChange(room);
  if (!st.done) {
    const next = st.rounds[st.ri].matches[st.mi];
    refreshPreviews(g, [next.a, next.b]).then((changed) => { if (changed && room.game === g) onChange(room); });
  }
  maybeFinishSolo(room);
  return { ok: true };
}

function maybeFinishSolo(room) {
  const g = room.game;
  if (!g || g.style !== 'solo' || room.phase !== 'playing') return false;
  const now = Date.now();
  const waiting = g.participants.some((pid) => isActive(room, pid, now) && !g.solo[pid].done);
  if (waiting) return false;
  finish(room);
  return true;
}

function checkProgress(room) {
  const g = room.game;
  if (!g) return;
  if (g.style === 'solo') maybeFinishSolo(room);
  else if (g.phase === 'voting') maybeCloseVoting(room);
  else if (g.phase === 'tie') maybeEndTie(room);
}

function finish(room) {
  clearTimeout(room.timer);
  const g = room.game;
  g.phase = null;
  room.phase = 'results';
  try { onFinish(room); } catch (err) { console.warn('[koth] onFinish failed', err.message); }
  onChange(room);
}

// Solo style: the host stops waiting for the players who are still picking; their brackets stay unfinished.
function finishNow(room) {
  const g = room.game;
  if (room.phase !== 'playing' || !g || g.style !== 'solo') throw new GameError('Nothing to finish');
  finish(room);
  return { ok: true };
}

async function stalePreview(room, idx) {
  const g = room.game;
  const i = Number(idx);
  if (!g || !Number.isInteger(i) || !g.tracks[i]) return { ok: true };
  if (await refreshPreviews(g, [i], true)) onChange(room);
  return { ok: true };
}

// ---------- room actions ----------

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
  if (room.phase === 'playing') checkProgress(room);
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
  if (room.phase === 'playing') checkProgress(room);
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
  payload = payload || {};
  switch (type) {
    case 'setSource': hostOnly(); return setSource(room, payload);
    case 'setSettings': hostOnly(); return setSettings(room, payload);
    case 'start':
    case 'again': hostOnly(); return startGame(room);
    case 'toLobby': hostOnly(); return toLobby(room);
    case 'finishNow': hostOnly(); return finishNow(room);
    case 'vote': return vote(room, player, payload.side);
    case 'tie': return answerTie(room, player, payload.answer);
    case 'stalePreview': return stalePreview(room, payload.track);
    case 'leave': return leave(room, player);
    case 'chat': return sendChat(room, player, payload.text);
    case 'setOpen': hostOnly(); room.isOpen = Boolean(payload && payload.open); onChange(room); return { ok: true };
    case 'kick': hostOnly(); return kick(room, player, payload.playerId);
    default: throw new GameError('Unknown action');
  }
}

// ---------- what a given player sees ----------

function publicTrack(t, withPreview) {
  return { id: t.id, title: t.title, version: t.version || '', artist: t.artist, album: t.album, cover: t.cover, preview: withPreview ? t.preview : null };
}

// A finished match shows everything; the open one shows only my own vote until it closes (a tie opens the votes).
function publicMatch(m, pid, open, showVotes) {
  const out = { a: m.a, b: m.b, winners: m.winners, how: m.how };
  if (!open) {
    if (m.votes) out.votes = m.votes;
    if (m.tally) out.tally = m.tally;
    if (m.concededBy) out.concededBy = m.concededBy;
    return out;
  }
  out.votes = showVotes.votes;
  return out;
}

function soloProgress(st) {
  const round = st.rounds[st.ri];
  return { done: st.done, picks: st.picks, round: round.name, match: st.mi, matches: round.matches.length };
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
    limits: { sizes: allowedSizes(room), allSizes: SIZES, timers: TIMERS, maxPlayers: MAX_PLAYERS, tieMs: TIE_MS, revealMs: REVEAL_MS },
    game: null,
  };
  const g = room.game;
  if (!g) return view;
  const results = room.phase === 'results';
  const base = {
    style: g.style,
    size: g.tracks.length,
    settings: g.settings,
    source: g.source,
    roster: g.roster,
    isParticipant: g.participants.includes(pid),
    startsAt: g.startsAt,
  };

  if (g.style === 'solo') {
    const mine = g.solo[pid] || null;
    const live = new Set();
    if (mine && !mine.done) {
      const m = mine.rounds[mine.ri].matches[mine.mi];
      live.add(m.a).add(m.b);
    }
    const progress = {};
    for (const id of g.participants) {
      const st = g.solo[id];
      progress[id] = { ...soloProgress(st), champion: results || id === pid ? st.champion : null };
    }
    view.game = {
      ...base,
      tracks: g.tracks.map((t, i) => publicTrack(t, results || live.has(i))),
      seed: g.seed.matches.map((m) => ({ a: m.a, b: m.b })),
      mine: mine ? { rounds: mine.rounds, ri: mine.ri, mi: mine.mi, done: mine.done, champion: mine.champion } : null,
      progress,
      brackets: results ? Object.fromEntries(g.participants.map((id) => [id, { rounds: g.solo[id].rounds, champion: g.solo[id].champion }])) : null,
    };
    return view;
  }

  const open = !results && (g.phase === 'loading' || g.phase === 'voting' || g.phase === 'tie');
  const revealVotes = g.phase === 'tie';
  const curVotes = revealVotes ? { ...g.votes } : (g.votes[pid] ? { [pid]: g.votes[pid] } : {});
  const live = new Set();
  if (!results && g.rounds[g.ri]) {
    const m = curMatch(g);
    live.add(m.a).add(m.b);
  }
  view.game = {
    ...base,
    tracks: g.tracks.map((t, i) => publicTrack(t, results || live.has(i))),
    rounds: g.rounds.map((r, ri) => ({
      name: r.name,
      size: r.size,
      bye: r.bye,
      matches: r.matches.map((m, mi) => publicMatch(m, pid, open && ri === g.ri && mi === g.mi, { votes: curVotes })),
    })),
    ri: g.ri,
    mi: g.mi,
    phase: g.phase,
    endsAt: g.endsAt,
    phaseEndsAt: g.phaseEndsAt,
    decided: g.phase === 'voting' ? g.participants.filter((id) => g.votes[id]) : [],
    tie: g.tie ? { voters: g.tie.voters, answers: g.tie.answers } : null,
    champions: g.champions,
  };
  return view;
}

module.exports = {
  init, createRoom, joinRoom, auth, setConnected, action, viewFor, GameError, hasRoom: (code) => rooms.has(normCode(code)),
  findRoom: (code) => rooms.get(normCode(code)) || null, rooms,
  _rooms: rooms, _sweep: sweep, _makeRound: makeRound, _roundWinners: roundWinners, _advanceForTest: advance,
  TIE_MS, REVEAL_MS,
};
