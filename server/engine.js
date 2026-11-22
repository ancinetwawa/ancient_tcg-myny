// The game engine. It holds no rules of its own: everything comes from
// the files in /rules. You normally don't need to edit this file.

const crypto = require("crypto");

function loadRules(rulesDir) {
  const dir = rulesDir || require("path").join(__dirname, "..", "rules");
  return {
    config: require(`${dir}/config.js`),
    cards: require(`${dir}/cards.js`),
    effects: require(`${dir}/effects.js`),
  };
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

class Game {
  constructor(rules) {
    this.rules = rules || loadRules();
    this.players = new Map();
    this.nextUid = 1;
  }

  makeCard(cardId) {
    const def = this.rules.cards[cardId];
    if (!def) throw new Error(`Unknown card id "${cardId}" in rules/config.js`);
    return { uid: this.nextUid++, id: cardId, ...def };
  }

  hook(name, ctx) {
    const fn = this.rules.effects[name];
    return typeof fn === "function" ? fn({ game: this, ...ctx }) : undefined;
  }

  addPlayer(name, id) {
    const { config } = this.rules;
    const deck = [];
    for (const entry of config.startingDeck) {
      for (let i = 0; i < entry.count; i++) deck.push(this.makeCard(entry.card));
    }
    if (config.shuffleDeck) shuffle(deck);

    const player = {
      id: id || crypto.randomUUID(),
      name,
      turn: config.startingTurn,
      deck,
      hand: [],
      drawsThisTurn: 0,
      connections: 0,
      lastSeen: Date.now(),
    };
    this.players.set(player.id, player);
    this.hook("onJoin", { player });
    for (let i = 0; i < config.startingHandSize; i++) this.moveTopCardToHand(player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  moveTopCardToHand(player) {
    const card = player.deck.pop();
    if (!card) return null;
    player.hand.push(card);
    this.hook("onDraw", { player, card });
    return card;
  }

  // Every action a player can take. Each returns { ok } or { ok:false, error }.
  act(playerId, type) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: "Unknown player" };
    const { config } = this.rules;

    if (type === "draw") {
      if (player.deck.length === 0) return { ok: false, error: "Your deck is empty" };
      if (config.maxDrawsPerTurn != null && player.drawsThisTurn >= config.maxDrawsPerTurn) {
        return { ok: false, error: "You can't draw any more this turn" };
      }
      if (config.maxHandSize != null && player.hand.length >= config.maxHandSize) {
        return { ok: false, error: "Your hand is full" };
      }
      const top = player.deck[player.deck.length - 1];
      if (this.hook("onBeforeDraw", { player, card: top }) === "block") {
        return { ok: false, error: "You can't draw right now" };
      }
      this.moveTopCardToHand(player);
      player.drawsThisTurn++;
      return { ok: true };
    }

    if (type === "endTurn") {
      this.hook("onTurnEnd", { player });
      player.turn++;
      player.drawsThisTurn = 0;
      this.hook("onTurnStart", { player });
      return { ok: true };
    }

    return { ok: false, error: `Unknown action "${type}"` };
  }

  // What one player is allowed to see: their own hand in full,
  // only counts for everyone else.
  viewFor(playerId) {
    const me = this.players.get(playerId);
    if (!me) return null;
    return {
      you: {
        id: me.id,
        name: me.name,
        turn: me.turn,
        deckCount: me.deck.length,
        hand: me.hand.map((card) => ({ ...card })),
      },
      others: [...this.players.values()]
        .filter((p) => p.id !== me.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          turn: p.turn,
          deckCount: p.deck.length,
          handCount: p.hand.length,
          online: p.connections > 0,
        })),
    };
  }
}

module.exports = { Game, loadRules };
