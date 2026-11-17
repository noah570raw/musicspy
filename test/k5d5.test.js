'use strict';
const test = require('node:test');
const assert = require('node:assert');
const game = require('../lib/k5d5/game');
const mock = require('../lib/music/mock-deezer');
const deezer = require('../lib/music/deezer');

const changes = [];
game.init({ deezer: mock, onChange: (room) => changes.push(room.code), noSweep: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error('timeout waiting');
}

test('full game for two: 4 tracks, 2/2 limits, reveal after each track', async () => {
  const host = game.createRoom('Ярик');
  const friend = game.joinRoom({ code: host.code.toLowerCase(), name: 'ярик' });
  const room = game._rooms.get(host.code);
  assert.strictEqual(room.players.get(friend.pid).name, 'ярик 2', 'ник должен стать уникальным');
  game.setConnected(room, host.pid, true);
  game.setConnected(room, friend.pid, true);

  await assert.rejects(game.action(host.code, friend.pid, friend.token, 'start'), /Only the host/);
  await game.action(host.code, host.pid, host.token, 'setSource', { type: 'album', id: 1003 });
  assert.strictEqual(room.source.poolSize, 5);
  assert.strictEqual(room.settings.trackCount, 4, 'в EP 5 треков → максимум 4');
  await game.action(host.code, host.pid, host.token, 'setSettings', { timer: 10, revealMode: 'each' });

  await game.action(host.code, host.pid, host.token, 'start');
  await waitFor(() => room.game && room.game.roundPhase === 'listening');
  const g = room.game;
  assert.strictEqual(g.half, 2);

  // друг не видит выбор хоста, пока раунд не закрыт
  await game.action(host.code, host.pid, host.token, 'choose', { choice: 'keep' });
  await assert.rejects(game.action(host.code, host.pid, host.token, 'choose', { choice: 'delete' }), /cannot change/);
  let fv = game.viewFor(room, friend.pid);
  assert.strictEqual(fv.game.choices[host.pid][0], null);
  assert.deepStrictEqual(fv.game.decided, [host.pid]);
  assert.ok(fv.game.tracks[0].preview, 'текущий трек с превью');
  assert.strictEqual(fv.game.tracks.length, 1, 'будущие треки скрыты');

  await game.action(host.code, friend.pid, friend.token, 'choose', { choice: 'delete' });
  await waitFor(() => g.roundPhase === 'reveal');
  fv = game.viewFor(room, friend.pid);
  assert.strictEqual(fv.game.choices[host.pid][0].c, 'keep', 'после раунда выбор виден');

  // ускоряем: сразу следующий раунд
  const fast = async (hostChoice, friendChoice) => {
    const r = g.round + 1;
    clearTimeout(room.timer);
    await game._nextRoundForTest(room);
    assert.strictEqual(g.round, r);
    assert.strictEqual(g.roundPhase, 'listening');
    if (hostChoice && !g.choices[host.pid][r]) await game.action(host.code, host.pid, host.token, 'choose', { choice: hostChoice });
    if (friendChoice && !g.choices[friend.pid][r]) await game.action(host.code, friend.pid, friend.token, 'choose', { choice: friendChoice });
  };

  await fast('keep', 'delete'); // хост 2 keep → дальше только delete
  await waitFor(() => g.roundPhase === 'reveal', 3000);
  await fast(null, null);
  assert.strictEqual(g.choices[host.pid][2].how, 'forced');
  assert.strictEqual(g.choices[host.pid][2].c, 'delete');
  assert.strictEqual(g.choices[friend.pid][2].c, 'keep');
  await waitFor(() => g.roundPhase === 'reveal', 8000); // все вынуждены → ждём FORCED_ALL_MS
  await fast(null, null);
  await waitFor(() => g.roundPhase === 'reveal', 8000);
  clearTimeout(room.timer);
  await game._nextRoundForTest(room);
  assert.strictEqual(room.phase, 'results');
  const hv = game.viewFor(room, host.pid);
  const keeps = hv.game.choices[host.pid].filter((c) => c.c === 'keep').length;
  assert.strictEqual(keeps, 2);
  assert.strictEqual(hv.game.tracks.length, 4);
});

test('"at the end" mode: others picks stay hidden until results', async () => {
  const host = game.createRoom('A');
  const friend = game.joinRoom({ code: host.code, name: 'B' });
  const room = game._rooms.get(host.code);
  game.setConnected(room, host.pid, true);
  game.setConnected(room, friend.pid, true);
  await game.action(host.code, host.pid, host.token, 'setSource', { type: 'artist', id: 2001 });
  assert.strictEqual(room.source.poolSize, 22);
  await game.action(host.code, host.pid, host.token, 'setSettings', { trackCount: 6, revealMode: 'end', timer: 0 });
  await game.action(host.code, host.pid, host.token, 'start');
  await waitFor(() => room.game.roundPhase === 'listening');
  await game.action(host.code, host.pid, host.token, 'choose', { choice: 'keep' });
  await game.action(host.code, friend.pid, friend.token, 'choose', { choice: 'keep' });
  await waitFor(() => room.game.roundPhase === 'reveal');
  const fv = game.viewFor(room, friend.pid);
  assert.strictEqual(fv.game.choices[host.pid][0], null);
  assert.strictEqual(fv.game.choices[friend.pid][0].c, 'keep');
  await game.action(host.code, host.pid, host.token, 'toLobby');
  assert.strictEqual(room.phase, 'lobby');
  clearTimeout(room.timer);
});

test('title normalisation for discographies', () => {
  const n = deezer._normTitle;
  assert.strictEqual(n('Get Lucky (Radio Edit)'), n('Get Lucky'));
  assert.strictEqual(n('One More Time - Remastered 2011'), n('One More Time'));
  assert.strictEqual(n('Song feat. Someone'), n('Song'));
  assert.notStrictEqual(n('Звезда'), n('Звёзды'));
});
