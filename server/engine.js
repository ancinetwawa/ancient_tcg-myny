// ============================================================
//  GAME ENGINE
//  Carries out the game. It holds no rules of its own: deck
//  contents, limits, cards and custom effects all come from the
//  files in /rules. You normally don't need to edit this file,
//  except to add a new KIND of action (see act() below).
// ============================================================

const crypto = require("crypto"); // Built into Node: random numbers and unique ids

// Reads the three rules files and returns them together.
// rulesDir: optional folder to load from (tests can point elsewhere).
function loadRules(rulesDir) {
  const dir = rulesDir || require("path").join(__dirname, "..", "rules");
  return {
    config: require(`${dir}/config.js`),   // numbers and limits
    cards: require(`${dir}/cards.js`),     // every card's definition
    effects: require(`${dir}/effects.js`), // custom rule hooks
  };
}

// Shuffles a list in place (Fisher-Yates shuffle) and returns it.
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); // random position from 0 to i
    [list[i], list[j]] = [list[j], list[i]]; // swap the two cards
  }
  return list;
}

// One Game holds every player connected to the server.
class Game {
  constructor(rules) {
    this.rules = rules || loadRules(); // { config, cards, effects } from /rules
    this.players = new Map();          // player id -> player object (see addPlayer)
    this.nextUid = 1;                  // counter that gives every card copy its own id
  }

  // Creates one physical copy of a card from its id in rules/cards.js.
  // Each copy gets a unique "uid" so two copies of the same card can be told apart.
  makeCard(cardId) {
    const def = this.rules.cards[cardId]; // the card's definition (name, text, stats...)
    if (!def) throw new Error(`Unknown card id "${cardId}" in rules/config.js`);
    return { uid: this.nextUid++, id: cardId, ...def };
  }

  // Builds the `ctx` object that rules and card effects receive.
  // Adds the game and the effect functions (like ctx.draw) to { player, card }.
  makeCtx(ctx) {
    const self = ctx.player; // the player this is happening to ("self" in draw)
    return {
      game: this,
      ...ctx,
      // draw(player, amount): player = 1-4 (player number) or "self"
      draw: (who, amount) => this.draw(who, amount, self),
    };
  }

  // Runs a hook from rules/effects.js (e.g. "onDraw") if it exists.
  // ctx: info passed to the hook ({ player, card }); see makeCtx.
  hook(name, ctx) {
    const fn = this.rules.effects[name];
    return typeof fn === "function" ? fn(this.makeCtx(ctx)) : undefined;
  }

  // ----------------------------------------------------------
  //  EFFECT FUNCTIONS: things rules and cards can make happen.
  //  Use them from rules/effects.js or a card's onPlay as ctx.draw(...).
  // ----------------------------------------------------------

  // Finds a player from a rules-style reference.
  // who: a player number (1, 2, 3, 4...) or "self" (whoever the effect belongs to).
  // self: the player "self" means. Returns the player, or null if there's no match.
  findPlayer(who, self) {
    if (String(who).toLowerCase() === "self") return self || null;
    const number = Number(who);
    return [...this.players.values()].find((p) => p.number === number) || null;
  }

  // draw(player, amount): that player draws `amount` cards from their deck.
  // Stops early if their deck runs out or their hand reaches maxHandSize.
  // Doesn't count towards maxDrawsPerTurn (that limit is for clicking the deck).
  // Returns how many cards were actually drawn.
  draw(who, amount, self) {
    const player = this.findPlayer(who, self);
    if (!player) return 0;
    const { maxHandSize } = this.rules.config;
    let drawn = 0;
    for (let i = 0; i < Number(amount); i++) {
      if (maxHandSize != null && player.hand.length >= maxHandSize) break;
      if (!this.moveTopCardToHand(player)) break; // deck empty
      drawn++;
    }
    return drawn;
  }

  // Adds a new player: builds and shuffles their deck, deals the starting hand.
  // name: what they typed on the welcome screen. id: optional, made up if missing.
  addPlayer(name, id) {
    const { config } = this.rules;

    // Build the deck from config.startingDeck, e.g. [{ card: "blank", count: 60 }]
    const deck = [];
    for (const entry of config.startingDeck) {
      for (let i = 0; i < entry.count; i++) deck.push(this.makeCard(entry.card));
    }
    if (config.shuffleDeck) shuffle(deck);

    // Player number: the lowest number not already taken (first to join = 1)
    const taken = new Set([...this.players.values()].map((p) => p.number));
    let number = 1;
    while (taken.has(number)) number++;

    // Everything the server knows about one player.
    const player = {
      id: id || crypto.randomUUID(), // secret id the player's browser uses to identify itself
      number,                        // player 1, 2, 3, 4... used by effects like draw(2, 1)
      name,                          // display name from the welcome screen
      turn: config.startingTurn,     // this player's turn number (shown on End Turn button)
      deck,                          // cards left to draw; the LAST item is the top card
      hand: [],                      // cards in the player's hand, in order drawn
      field: [],                     // cards played onto their board; each has x, y (board pixels, card centre)
      drawsThisTurn: 0,              // draws so far this turn (for maxDrawsPerTurn)
      connections: 0,                // open browser tabs for this player; 0 = offline
      lastSeen: Date.now(),          // when they last disconnected (to forget old players)
    };
    this.players.set(player.id, player);
    this.hook("onJoin", { player });

    // Deal the starting hand
    for (let i = 0; i < config.startingHandSize; i++) this.moveTopCardToHand(player);
    return player;
  }

  // Removes a player from the game completely.
  removePlayer(id) {
    this.players.delete(id);
  }

  // Moves the top card of a player's deck into their hand and runs onDraw.
  // Returns the card, or null if the deck was empty. Used by draws and dealing.
  moveTopCardToHand(player) {
    const card = player.deck.pop(); // take the top card
    if (!card) return null;
    player.hand.push(card);
    this.hook("onDraw", { player, card });
    return card;
  }

  // ----------------------------------------------------------
  //  ACTIONS: everything a player can do.
  //  playerId: who is acting. type: which action ("draw", "endTurn", "play", "move").
  //  data: extra details some actions need (e.g. which card and where).
  //  Returns { ok: true } or { ok: false, error: "message shown to player" }.
  //  To add a new action, add another `if (type === "...")` block.
  // ----------------------------------------------------------
  act(playerId, type, data = {}) {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: "Unknown player" };
    const { config } = this.rules;

    // DRAW: player clicked their deck
    if (type === "draw") {
      // Check every limit before drawing
      if (player.deck.length === 0) return { ok: false, error: "Your deck is empty" };
      if (config.maxDrawsPerTurn != null && player.drawsThisTurn >= config.maxDrawsPerTurn) {
        return { ok: false, error: "You can't draw any more this turn" };
      }
      if (config.maxHandSize != null && player.hand.length >= config.maxHandSize) {
        return { ok: false, error: "Your hand is full" };
      }
      // Let rules/effects.js veto the draw
      const top = player.deck[player.deck.length - 1]; // the card about to be drawn
      if (this.hook("onBeforeDraw", { player, card: top }) === "block") {
        return { ok: false, error: "You can't draw right now" };
      }
      this.moveTopCardToHand(player);
      player.drawsThisTurn++;
      return { ok: true };
    }

    // END TURN: player clicked the End Turn button
    if (type === "endTurn") {
      this.hook("onTurnEnd", { player });
      player.turn++;
      player.drawsThisTurn = 0; // new turn, draw count starts over
      this.hook("onTurnStart", { player });
      return { ok: true };
    }

    // PLAY: player put a card from their hand onto their board.
    // data.uid = which card; data.x, data.y = where its centre goes, in board pixels.
    if (type === "play") {
      const index = player.hand.findIndex((c) => c.uid === data.uid);
      if (index === -1) return { ok: false, error: "That card isn't in your hand" };
      const x = Number(data.x), y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Couldn't tell where to play that" };
      const card = player.hand[index];
      // Let rules/effects.js veto the play
      if (this.hook("onBeforePlay", { player, card }) === "block") {
        return { ok: false, error: "You can't play that card right now" };
      }
      player.hand.splice(index, 1);
      card.x = Math.max(-5000, Math.min(5000, x)); // keep it within a sane distance of the board
      card.y = Math.max(-5000, Math.min(5000, y));
      player.field.push(card);
      this.hook("onPlay", { player, card });
      // The card's own effect, if it has one in rules/cards.js
      if (typeof card.onPlay === "function") card.onPlay(this.makeCtx({ player, card }));
      return { ok: true };
    }

    // MOVE: player dragged one of their cards already on the board to a new spot.
    // data.uid = which card; data.x, data.y = its new centre, in board pixels.
    if (type === "move") {
      const card = player.field.find((c) => c.uid === data.uid);
      if (!card) return { ok: false, error: "That card isn't on your board" };
      const x = Number(data.x), y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Couldn't tell where to move that" };
      if (this.hook("onBeforeMove", { player, card }) === "block") {
        return { ok: false, error: "You can't move that card right now" };
      }
      card.x = Math.max(-5000, Math.min(5000, x));
      card.y = Math.max(-5000, Math.min(5000, y));
      this.hook("onMove", { player, card });
      return { ok: true };
    }

    return { ok: false, error: `Unknown action "${type}"` };
  }

  // Every player except playerId, in join order starting just after them
  // and wrapping around. E.g. join order A,B,C,D: for C this gives D,A,B.
  seatOrderAfter(playerId) {
    const all = [...this.players.values()]; // Map keeps join order
    const i = all.findIndex((p) => p.id === playerId);
    return [...all.slice(i + 1), ...all.slice(0, i)];
  }

  // ----------------------------------------------------------
  //  What one player's screen is allowed to show.
  //  They see their own hand in full, but only COUNTS for other
  //  players, so nobody can peek at someone else's cards.
  // ----------------------------------------------------------
  viewFor(playerId) {
    const me = this.players.get(playerId);
    if (!me) return null;
    return {
      // This player's own info
      you: {
        id: me.id,
        number: me.number,
        name: me.name,
        turn: me.turn,
        deckCount: me.deck.length,
        hand: me.hand.map((card) => ({ ...card })), // copies of the full cards
        field: me.field.map((card) => ({ ...card })), // cards you've played, with their x, y
      },
      // Everyone else, with hidden information left out. Listed in seat
      // order going clockwise from this player (join order, starting
      // with whoever joined after them), so every player sees the same
      // seating from their own side of the table.
      others: this.seatOrderAfter(me.id)
        .map((p) => ({
          id: p.id,
          number: p.number,
          name: p.name,
          turn: p.turn,
          deckCount: p.deck.length,
          handCount: p.hand.length,
          field: p.field.map((card) => ({ ...card })), // played cards are face up, so everyone sees them
          online: p.connections > 0, // true if they have the game open right now
        })),
    };
  }
}

module.exports = { Game, loadRules };
