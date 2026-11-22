// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { Game, loadRules } = require("../server/engine");

// A game using the real cards and config, but with NO rules from
// rules/effects.js (only the ones a test passes in). That way these tests
// check the engine itself and keep passing whatever rules you write.
function gameWith(configChanges = {}, effects = {}) {
  const rules = loadRules();
  return new Game({
    ...rules,
    config: { ...rules.config, ...configChanges },
    effects,
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

test("other players are listed clockwise starting after you", () => {
  const game = gameWith();
  const [a, b, c, d] = ["A", "B", "C", "D"].map((n) => game.addPlayer(n));
  const names = (p) => game.viewFor(p.id).others.map((o) => o.name).join("");
  assert.equal(names(a), "BCD");
  assert.equal(names(c), "DAB");
  assert.equal(names(d), "ABC");
});

test("playing a card moves it from hand to the board at the given spot", () => {
  const game = gameWith();
  const a = game.addPlayer("Ana");
  const b = game.addPlayer("Ben");
  game.act(a.id, "draw");
  const uid = a.hand[0].uid;
  assert.deepEqual(game.act(a.id, "play", { uid, x: 300, y: 120 }), { ok: true });
  assert.equal(a.hand.length, 0);
  assert.equal(a.field.length, 1);
  assert.equal(game.viewFor(a.id).you.field[0].x, 300);
  assert.equal(game.viewFor(b.id).others[0].field[0].y, 120, "other players see played cards");
});

test("can't play a card you don't have, or with no position", () => {
  const game = gameWith();
  const a = game.addPlayer("Ana");
  game.act(a.id, "draw");
  assert.equal(game.act(a.id, "play", { uid: 9999, x: 0, y: 0 }).ok, false);
  assert.equal(game.act(a.id, "play", { uid: a.hand[0].uid }).ok, false);
  assert.equal(a.hand.length, 1);
});

test("moving a played card changes its position; only your own", () => {
  const game = gameWith();
  const a = game.addPlayer("Ana");
  const b = game.addPlayer("Ben");
  game.act(a.id, "draw");
  const uid = a.hand[0].uid;
  game.act(a.id, "play", { uid, x: 100, y: 100 });
  assert.deepEqual(game.act(a.id, "move", { uid, x: 400, y: 250 }), { ok: true });
  assert.equal(a.field[0].x, 400);
  assert.equal(a.field[0].y, 250);
  assert.equal(game.act(b.id, "move", { uid, x: 0, y: 0 }).ok, false, "can't move someone else's card");
  assert.equal(a.field[0].x, 400);
});

test("players get numbers in join order; a free number is reused", () => {
  const game = gameWith();
  const [a, b, c] = ["A", "B", "C"].map((n) => game.addPlayer(n));
  assert.deepEqual([a.number, b.number, c.number], [1, 2, 3]);
  game.removePlayer(b.id);
  assert.equal(game.addPlayer("D").number, 2);
  assert.equal(game.viewFor(a.id).you.number, 1);
});

test("draw(player, amount) with a player number or self", () => {
  const game = gameWith();
  const a = game.addPlayer("A");
  const b = game.addPlayer("B");
  assert.equal(game.draw(2, 3, a), 3);
  assert.equal(b.hand.length, 3);
  assert.equal(game.draw("self", 2, a), 2);
  assert.equal(a.hand.length, 2);
  assert.equal(game.draw(4, 1, a), 0, "no player 4: nothing happens");
});

test("draw stops at an empty deck and at maxHandSize", () => {
  const small = gameWith({ startingDeck: [{ card: "blank", count: 2 }] });
  const a = small.addPlayer("A");
  assert.equal(small.draw("self", 5, a), 2);
  const capped = gameWith({ maxHandSize: 3 });
  const b = capped.addPlayer("B");
  assert.equal(capped.draw("self", 10, b), 3);
});

test("a card's onPlay can use ctx.draw", () => {
  const rules = loadRules();
  const game = new Game({
    ...rules,
    cards: { ...rules.cards, insight: { name: "Insight", text: "Draw 2.", onPlay: (ctx) => ctx.draw("self", 2) } },
    config: { ...rules.config, startingDeck: [{ card: "insight", count: 10 }] },
  });
  const a = game.addPlayer("A");
  game.act(a.id, "draw");
  game.act(a.id, "play", { uid: a.hand[0].uid, x: 0, y: 0 });
  assert.equal(a.hand.length, 2, "played 1 card, then drew 2");
});

test("effects hooks get ctx.draw", () => {
  const game = gameWith({}, { onTurnStart: (ctx) => ctx.draw("self", 1) });
  const a = game.addPlayer("A");
  game.act(a.id, "endTurn");
  assert.equal(a.hand.length, 1);
});

test("currencies start from config and change with adjust", () => {
  const game = gameWith({ startingCurrency: { coin: 2, funding: 0, rep: 0 } });
  const a = game.addPlayer("A");
  assert.deepEqual(game.viewFor(a.id).you.currency, { coin: 2, funding: 0, rep: 0 });
  assert.equal(game.act(a.id, "adjust", { currency: "coin", delta: 1 }).ok, true);
  assert.equal(game.act(a.id, "adjust", { currency: "funding", delta: 1 }).ok, true);
  assert.deepEqual(a.currency, { coin: 3, funding: 1, rep: 0 });
  assert.equal(game.act(a.id, "adjust", { currency: "gold", delta: 1 }).ok, false, "unknown currency");
});

test("currencies can't go below 0 unless allowed", () => {
  const game = gameWith({ currencyCanGoNegative: false });
  const a = game.addPlayer("A");
  assert.equal(game.act(a.id, "adjust", { currency: "rep", delta: -1 }).ok, false);
  assert.equal(a.currency.rep, 0);
  const loose = gameWith({ currencyCanGoNegative: true });
  const b = loose.addPlayer("B");
  assert.equal(loose.act(b.id, "adjust", { currency: "rep", delta: -1 }).ok, true);
  assert.equal(b.currency.rep, -1);
});

test("incrementCoin / Funding / Rep change a player's currency", () => {
  const game = gameWith();
  const a = game.addPlayer("A");
  const b = game.addPlayer("B");
  const ctx = game.makeCtx({ player: a });
  assert.equal(ctx.incrementCoin("self", 3), 3);
  assert.equal(ctx.incrementFunding(2, 2), 2);
  assert.equal(ctx.incrementRep("self", -1), -1);
  assert.deepEqual(a.currency, { coin: 3, funding: 0, rep: -1 });
  assert.deepEqual(b.currency, { coin: 0, funding: 2, rep: 0 });
  assert.equal(ctx.incrementCoin(4, 1), null, "no player 4: nothing happens");
});

test("increment stops at 0 when negatives aren't allowed", () => {
  const game = gameWith({ currencyCanGoNegative: false });
  const a = game.addPlayer("A");
  assert.equal(game.makeCtx({ player: a }).incrementCoin("self", -5), 0);
});

test("a card's onPlay can use increment functions", () => {
  const rules = loadRules();
  const game = new Game({
    ...rules,
    effects: {},
    cards: { ...rules.cards, tax: { name: "Tax", onPlay: (ctx) => { ctx.incrementCoin("self", 3); ctx.incrementRep(2, -1); } } },
    config: { ...rules.config, startingDeck: [{ card: "tax", count: 5 }] },
  });
  const a = game.addPlayer("A");
  const b = game.addPlayer("B");
  game.act(a.id, "draw");
  game.act(a.id, "play", { uid: a.hand[0].uid, x: 0, y: 0 });
  assert.equal(a.currency.coin, 3);
  assert.equal(b.currency.rep, -1);
});

test("cards load from the /cards folder; _template is skipped", () => {
  const { cards } = loadRules();
  assert.ok(cards.blank);
  assert.equal(cards._template, undefined);
});

test("the template is valid and its hooks do nothing as written", () => {
  const template = require("../cards/_template.js");
  const game = gameWith();
  const a = game.addPlayer("A");
  const ctx = game.makeCtx({ player: a, card: template });
  for (const hook of ["onBeforePlay", "onPlay", "onDraw", "onMove"]) template[hook](ctx);
  assert.equal(a.hand.length, 0);
});

// A game whose deck is made of one given card, with no rules from effects.js
function deckOf(card) {
  const rules = loadRules();
  return new Game({
    ...rules, effects: {},
    cards: { test: card },
    config: { ...rules.config, startingDeck: [{ card: "test", count: 10 }] },
  });
}

test("a card whose onPlay draws 2", () => {
  const game = deckOf({ name: "Insight", onPlay: (ctx) => ctx.draw("self", 2) });
  const a = game.addPlayer("A");
  game.act(a.id, "draw");
  game.act(a.id, "play", { uid: a.hand[0].uid, x: 0, y: 0 });
  assert.equal(a.hand.length, 2);
});

test("a card with a cost: blocked without Coin, otherwise pays 1, gains 3, player 2 loses 1 Rep", () => {
  const game = deckOf({
    name: "Tax", cost: 1,
    onBeforePlay: (ctx) => (ctx.player.currency.coin < ctx.card.cost ? "block" : undefined),
    onPlay: (ctx) => { ctx.incrementCoin("self", -ctx.card.cost); ctx.incrementCoin("self", 3); ctx.incrementRep(2, -1); },
  });
  const a = game.addPlayer("A");
  const b = game.addPlayer("B");
  game.act(a.id, "draw");
  const uid = a.hand[0].uid;
  assert.equal(game.act(a.id, "play", { uid, x: 0, y: 0 }).ok, false, "0 Coin: can't play");
  game.act(a.id, "adjust", { currency: "coin", delta: 1 });
  assert.equal(game.act(a.id, "play", { uid, x: 0, y: 0 }).ok, true);
  assert.equal(a.currency.coin, 3);
  assert.equal(b.currency.rep, -1);
});

test("a card's own onDraw and onMove run", () => {
  const calls = [];
  const rules = loadRules();
  const game = new Game({
    ...rules, effects: {},
    cards: { spy: { name: "Spy", onDraw: () => calls.push("draw"), onMove: () => calls.push("move") } },
    config: { ...rules.config, startingDeck: [{ card: "spy", count: 3 }] },
  });
  const a = game.addPlayer("A");
  game.act(a.id, "draw");
  const uid = a.hand[0].uid;
  game.act(a.id, "play", { uid, x: 0, y: 0 });
  game.act(a.id, "move", { uid, x: 5, y: 5 });
  assert.deepEqual(calls, ["draw", "move"]);
});

test("onBeforePlay can block a play", () => {
  const game = gameWith({}, { onBeforePlay: () => "block" });
  const a = game.addPlayer("Ana");
  game.act(a.id, "draw");
  assert.equal(game.act(a.id, "play", { uid: a.hand[0].uid, x: 0, y: 0 }).ok, false);
  assert.equal(a.field.length, 0);
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
