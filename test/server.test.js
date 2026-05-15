const test = require("node:test");
const assert = require("node:assert/strict");

const { ALLOWED_REACTIONS, countReactions, getActiveTurnOrder, removePlayerFromLobby } = require("../server");

test("getActiveTurnOrder keeps the first-round order for later rounds", () => {
  const lobby = {
    baseOrder: ["player-3", "player-1", "player-2"],
    players: [
      { id: "player-1" },
      { id: "player-2" },
      { id: "player-3" }
    ]
  };

  assert.deepEqual(getActiveTurnOrder(lobby), ["player-3", "player-1", "player-2"]);
});

test("getActiveTurnOrder removes disconnected players without reshuffling survivors", () => {
  const lobby = {
    baseOrder: ["player-2", "player-1", "player-4", "player-3"],
    players: [
      { id: "player-1" },
      { id: "player-2" },
      { id: "player-3" }
    ]
  };

  assert.deepEqual(getActiveTurnOrder(lobby), ["player-2", "player-1", "player-3"]);
});
test("removePlayerFromLobby clears a kicked player from game state", () => {
  const lobby = {
    players: [{ id: "host" }, { id: "kicked" }, { id: "next" }],
    order: ["host", "kicked", "next"],
    baseOrder: ["host", "kicked", "next"],
    spies: ["kicked"],
    voteCandidates: ["host", "kicked", "next"],
    votes: { host: "kicked", kicked: "next" },
    currentTurnIndex: 2
  };

  const removedIndex = removePlayerFromLobby(lobby, "kicked");

  assert.equal(removedIndex, 1);
  assert.deepEqual(lobby.players, [{ id: "host" }, { id: "next" }]);
  assert.deepEqual(lobby.order, ["host", "next"]);
  assert.deepEqual(lobby.baseOrder, ["host", "next"]);
  assert.deepEqual(lobby.spies, []);
  assert.deepEqual(lobby.voteCandidates, ["host", "next"]);
  assert.deepEqual(lobby.votes, {});
  assert.equal(lobby.currentTurnIndex, 1);
});


test("countReactions aggregates only allowed reactions", () => {
  const [fire, heart, laugh] = ALLOWED_REACTIONS;

  assert.deepEqual(countReactions({
    player1: fire,
    player2: heart,
    player3: fire,
    player4: "invalid",
    player5: laugh
  }), {
    [fire]: 2,
    [heart]: 1,
    [laugh]: 1
  });
});

test("removePlayerFromLobby removes current track reaction and syncs history", () => {
  const [fire, heart] = ALLOWED_REACTIONS;
  const lobby = {
    players: [{ id: "host" }, { id: "kicked" }, { id: "next" }],
    order: ["host", "kicked", "next"],
    baseOrder: ["host", "kicked", "next"],
    spies: [],
    voteCandidates: ["host", "kicked", "next"],
    votes: {},
    currentTurnIndex: 1,
    lastTrack: { id: "track-1" },
    currentTrackReactions: { host: fire, kicked: heart },
    trackHistory: [{ id: "track-1", reactions: {} }]
  };

  removePlayerFromLobby(lobby, "kicked");

  assert.deepEqual(lobby.currentTrackReactions, { host: fire });
  assert.deepEqual(lobby.trackHistory[0].reactions, { [fire]: 1 });
});
