'use strict';
const test = require('node:test');
const assert = require('node:assert');
const game = require('../lib/koth/game');
const mock = require('../lib/music/mock-deezer');

game.init({ deezer: mock, noSweep: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error('timeout waiting');
}

async function setup(names, settings) {
  const host = game.createRoom(names[0]);
  const room = game._rooms.get(host.code);
  const players = [host];
  for (const n of names.slice(1)) players.push(game.joinRoom({ code: host.code, name: n }));
  for (const p of players) game.setConnected(room, p.pid, true);
  const act = (p, type, payload) => game.action(host.code, p.pid, p.token, type, payload);
  await act(host, 'setSource', { type: 'album', id: 1001 });
  await act(host, 'setSettings', settings);
  return { room, players, act };
}

// skip the pause before a duel opens
const open = (room) => { room.game.startsAt = Date.now() - 1000; };

test('bracket helpers: pairs, byes, drawn tracks kept apart', () => {
  const r = game._makeRound([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(r.name, 'Quarterfinals');
  assert.strictEqual(r.matches.length, 4);
  assert.strictEqual(r.bye, null);
  r.matches[0].winners = [0, 1]; r.matches[0].how = 'draw';
  r.matches[1].winners = [2];
  r.matches[2].winners = [5];
  r.matches[3].winners = [7];
  const w = game._roundWinners(r);
  assert.deepStrictEqual(w, [0, 1, 2, 5, 7]);
  const next = game._makeRound(w, r);
  assert.strictEqual(next.name, 'Quarterfinals', '5 entrants is still more than a semifinal');
  assert.strictEqual(next.matches.length, 2);
  assert.ok(next.bye !== null);
  for (const m of next.matches) assert.ok(!([m.a, m.b].includes(0) && [m.a, m.b].includes(1)), 'tracks that drew do not meet again');
});

test('vote style: majority wins, 4 tracks give 2 semifinals and a final', async () => {
  const { room, players, act } = await setup(['Ann', 'Bob', 'Cid'], { size: 4, style: 'vote', timer: 0 });
  const [a, b, c] = players;
  assert.strictEqual(room.settings.size, 4);
  await assert.rejects(act(b, 'start'), /Only the host/);
  await act(a, 'start');
  await waitFor(() => room.game && room.game.phase === 'voting');
  const g = room.game;
  assert.strictEqual(g.rounds[0].name, 'Semifinals');
  open(room);

  await act(a, 'vote', { side: 'a' });
  // votes stay hidden from the others while the duel is open
  let view = game.viewFor(room, b.pid);
  assert.deepStrictEqual(view.game.rounds[0].matches[0].votes, {});
  assert.deepStrictEqual(view.game.decided, [a.pid]);
  assert.ok(view.game.tracks[g.rounds[0].matches[0].a].preview, 'the two tracks of the open duel come with previews');
  assert.strictEqual(view.game.tracks[g.rounds[0].matches[1].a].preview, null, 'later tracks do not');
  await act(a, 'vote', { side: 'b' }); // you can change your mind while the duel is open
  await act(b, 'vote', { side: 'b' });
  await act(c, 'vote', { side: 'a' });
  await waitFor(() => g.phase === 'reveal');
  const m0 = g.rounds[0].matches[0];
  assert.deepStrictEqual(m0.winners, [m0.b]);
  assert.strictEqual(m0.how, 'votes');
  assert.deepStrictEqual(m0.tally, { a: 1, b: 2 });

  clearTimeout(room.timer);
  game._advanceForTest(room);
  await waitFor(() => g.phase === 'voting' && g.mi === 1);
  open(room);
  for (const p of players) await act(p, 'vote', { side: 'a' });
  await waitFor(() => g.phase === 'reveal');
  clearTimeout(room.timer);
  game._advanceForTest(room);
  await waitFor(() => g.phase === 'voting' && g.ri === 1);
  assert.strictEqual(g.rounds[1].name, 'Final');
  open(room);
  for (const p of players) await act(p, 'vote', { side: 'b' });
  await waitFor(() => g.phase === 'reveal');
  clearTimeout(room.timer);
  game._advanceForTest(room);
  assert.strictEqual(room.phase, 'results');
  assert.deepStrictEqual(g.champions, [g.rounds[1].matches[0].b]);
  view = game.viewFor(room, c.pid);
  assert.ok(view.game.tracks.every((t) => t.preview), 'results come with every preview');
});

test('vote style: a tie can be conceded or drawn; a drawn final crowns two kings', async () => {
  const { room, players, act } = await setup(['Ann', 'Bob'], { size: 4, style: 'vote', timer: 0 });
  const [a, b] = players;
  await act(a, 'start');
  await waitFor(() => room.game && room.game.phase === 'voting');
  const g = room.game;
  open(room);

  // 1:1, Bob concedes: Ann's track goes through
  await act(a, 'vote', { side: 'a' });
  await act(b, 'vote', { side: 'b' });
  await waitFor(() => g.phase === 'tie');
  let view = game.viewFor(room, a.pid);
  assert.strictEqual(view.game.rounds[0].matches[0].votes[b.pid], 'b', 'a tie opens the votes');
  await assert.rejects(act(a, 'vote', { side: 'b' }), /closed/);
  await act(b, 'tie', { answer: 'concede' });
  const m0 = g.rounds[0].matches[0];
  assert.deepStrictEqual(m0.winners, [m0.a]);
  assert.strictEqual(m0.how, 'concede');
  assert.strictEqual(m0.concededBy, b.pid);
  assert.deepStrictEqual(m0.tally, { a: 1, b: 1 }, 'the votes stay as cast');

  // 1:1, both agree to a draw: both tracks go through
  clearTimeout(room.timer);
  game._advanceForTest(room);
  await waitFor(() => g.phase === 'voting' && g.mi === 1);
  open(room);
  await act(a, 'vote', { side: 'b' });
  await act(b, 'vote', { side: 'a' });
  await waitFor(() => g.phase === 'tie');
  await act(a, 'tie', { answer: 'draw' });
  assert.strictEqual(g.phase, 'tie', 'waits for the other voter');
  await act(b, 'tie', { answer: 'draw' });
  const m1 = g.rounds[0].matches[1];
  assert.strictEqual(m1.how, 'draw');
  assert.deepStrictEqual(m1.winners, [m1.a, m1.b]);

  // 3 tracks left: one duel and one bye
  clearTimeout(room.timer);
  game._advanceForTest(room);
  await waitFor(() => g.phase === 'voting' && g.ri === 1);
  assert.strictEqual(g.rounds[1].size, 3);
  assert.strictEqual(g.rounds[1].matches.length, 1);
  assert.ok(g.rounds[1].bye !== null);
  open(room);
  await act(a, 'vote', { side: 'a' });
  await act(b, 'vote', { side: 'a' });
  await waitFor(() => g.phase === 'reveal');
  clearTimeout(room.timer);
  game._advanceForTest(room);
  await waitFor(() => g.phase === 'voting' && g.ri === 2);
  assert.strictEqual(g.rounds[2].name, 'Final');

  // drawn final: silence counts as agreeing once the tie clock runs out
  open(room);
  await act(a, 'vote', { side: 'a' });
  await act(b, 'vote', { side: 'b' });
  await waitFor(() => g.phase === 'tie');
  await act(a, 'tie', { answer: 'draw' });
  game.setConnected(room, b.pid, false);
  room.players.get(b.pid).lastSeen = Date.now() - 60000; // Bob dropped: he cannot hold the tie up
  game._sweep();
  assert.strictEqual(g.phase, 'reveal');
  clearTimeout(room.timer);
  game._advanceForTest(room);
  assert.strictEqual(room.phase, 'results');
  assert.strictEqual(g.champions.length, 2, 'two kings of the hill');
});

test('vote style: no votes at all is settled by a coin flip', async () => {
  const { room, players, act } = await setup(['Solo'], { size: 4, style: 'vote', timer: 20 });
  await act(players[0], 'start');
  await waitFor(() => room.game && room.game.phase === 'voting');
  const g = room.game;
  game.setConnected(room, players[0].pid, false);
  room.players.get(players[0].pid).lastSeen = Date.now() - 60000;
  open(room);
  game._sweep();
  assert.strictEqual(g.phase, 'reveal');
  assert.strictEqual(g.rounds[0].matches[0].how, 'coin');
  clearTimeout(room.timer);
});

test('solo style: everyone runs their own bracket, results when all are done', async () => {
  const { room, players, act } = await setup(['Ann', 'Bob'], { size: 8, style: 'solo' });
  const [a, b] = players;
  await act(a, 'start');
  await waitFor(() => room.game && room.phase === 'playing');
  const g = room.game;
  assert.strictEqual(g.style, 'solo');
  open(room);
  const pickAll = async (p, side) => {
    while (!g.solo[p.pid].done) await act(p, 'vote', { side });
  };
  await pickAll(a, 'a');
  assert.strictEqual(g.solo[a.pid].picks, 7, '8 tracks take 7 duels');
  assert.strictEqual(room.phase, 'playing', 'waits for Bob');
  let view = game.viewFor(room, b.pid);
  assert.strictEqual(view.game.progress[a.pid].done, true);
  assert.strictEqual(view.game.progress[a.pid].champion, null, "Ann's king stays hidden until the results");
  assert.strictEqual(view.game.brackets, null);
  await assert.rejects(act(a, 'vote', { side: 'a' }), /finished/);
  await pickAll(b, 'b');
  assert.strictEqual(room.phase, 'results');
  view = game.viewFor(room, b.pid);
  assert.strictEqual(view.game.progress[a.pid].champion, g.solo[a.pid].champion);
  assert.ok(view.game.brackets[a.pid].rounds.length === 3);
  assert.notStrictEqual(g.solo[a.pid].champion, g.solo[b.pid].champion, 'always-left and always-right crown different kings');
  // the first round is the same for everyone
  assert.deepStrictEqual(g.solo[a.pid].rounds[0].matches.map((m) => [m.a, m.b]), g.solo[b.pid].rounds[0].matches.map((m) => [m.a, m.b]));
});

test('settings: bracket size is limited by the tracks with previews', async () => {
  const host = game.createRoom('Host');
  const room = game._rooms.get(host.code);
  const act = (type, payload) => game.action(host.code, host.pid, host.token, type, payload);
  await act('setSource', { type: 'album', id: 1003 }); // 5 tracks
  assert.strictEqual(room.settings.size, 4);
  await assert.rejects(act('setSettings', { size: 8 }), /not available/);
  await assert.rejects(act('setSettings', { style: 'chaos' }), /Unknown style/);
  await act('setSettings', { style: 'solo', timer: 45 });
  assert.deepStrictEqual(room.settings, { size: 4, style: 'solo', timer: 45 });
});
