// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { Game, loadRules } = require("../server/engine");

function gameWith(configChanges = {}, effects = {}) {
  const rules = loadRules();
  return new Game({
    ...rules,
    config: { ...rules.config, ...configChanges },
    effects: { ...rules.effects, ...effects },
  });
}

test("a new player gets a 60-card deck, empty hand, turn 1", () => {
  const game = gameWith();
  const p = game.addPlayer("Ana");
  const view = game.viewFor(p.id);
  assert.equal(view.you.deckCount, 60);
  assert.equal(view.you.hand.length, 0);
  assert.equal(view.you.turn, 1);
});

test("drawing moves one card from deck to hand", () => {
  const game = gameWith();
  const p = game.addPlayer("Ana");
  assert.deepEqual(game.act(p.id, "draw"), { ok: true });
  assert.equal(p.deck.length, 59);
  assert.equal(p.hand.length, 1);
});

test("can't draw from an empty deck", () => {
  const game = gameWith({ startingDeck: [{ card: "blank", count: 1 }] });
  const p = game.addPlayer("Ana");
  game.act(p.id, "draw");
  assert.equal(game.act(p.id, "draw").ok, false);
});

test("ending the turn increases the turn number", () => {
  const game = gameWith();
  const p = game.addPlayer("Ana");
  game.act(p.id, "endTurn");
  game.act(p.id, "endTurn");
  assert.equal(p.turn, 3);
});

test("players have separate decks, hands and turns", () => {
  const game = gameWith();
  const a = game.addPlayer("Ana");
  const b = game.addPlayer("Ben");
  game.act(a.id, "draw");
  game.act(a.id, "endTurn");
  assert.equal(b.hand.length, 0);
  assert.equal(b.turn, 1);
  const benSees = game.viewFor(b.id).others[0];
  assert.equal(benSees.name, "Ana");
  assert.equal(benSees.handCount, 1);
  assert.equal(benSees.hand, undefined, "other players' hands stay hidden");
});

test("maxDrawsPerTurn limits draws and resets each turn", () => {
  const game = gameWith({ maxDrawsPerTurn: 1 });
  const p = game.addPlayer("Ana");
  assert.equal(game.act(p.id, "draw").ok, true);
  assert.equal(game.act(p.id, "draw").ok, false);
  game.act(p.id, "endTurn");
  assert.equal(game.act(p.id, "draw").ok, true);
});

test("effects hooks run and can block a draw", () => {
  const calls = [];
  const game = gameWith({}, {
    onDraw: () => calls.push("draw"),
    onTurnEnd: () => calls.push("end"),
    onBeforeDraw: ({ player }) => (player.hand.length >= 2 ? "block" : undefined),
  });
  const p = game.addPlayer("Ana");
  game.act(p.id, "draw");
  game.act(p.id, "draw");
  assert.equal(game.act(p.id, "draw").ok, false);
  game.act(p.id, "endTurn");
  assert.deepEqual(calls, ["draw", "draw", "end"]);
});
