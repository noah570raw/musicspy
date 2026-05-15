const test = require("node:test");
const assert = require("node:assert/strict");

const { getActiveTurnOrder } = require("../server");

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
