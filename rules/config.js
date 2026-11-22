// ============================================================
//  GAME RULES CONFIG
//  Change the numbers here to change how the game plays.
//  After editing, push to GitHub and Render redeploys the game.
// ============================================================

module.exports = {
  // What each player's deck is made of when they join.
  // Each entry is a card id from rules/cards.js and how many copies.
  startingDeck: [
    { card: "blank", count: 60 },
  ],

  // Shuffle the deck when a player joins?
  shuffleDeck: true,

  // How many cards each player draws automatically when they join.
  startingHandSize: 0,

  // The turn number players start on.
  startingTurn: 1,

  // Most cards a player may draw by clicking the deck in one turn.
  // null = no limit.
  maxDrawsPerTurn: null,

  // Most cards a player may hold. Drawing is blocked once reached.
  // null = no limit.
  maxHandSize: null,
};
