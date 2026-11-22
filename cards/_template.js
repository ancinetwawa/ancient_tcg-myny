// ============================================================
//  CARD TEMPLATE
//  To make a new card:
//    1. Copy this file and rename the copy, e.g. cards/fireball.js
//       (the file name becomes the card's id: "fireball").
//       Use lowercase letters, numbers and _ only. Don't start it with _.
//    2. Fill in the name and text, and delete the hooks you don't need.
//    3. Put it in a deck: in rules/config.js add
//         { card: "fireball", count: 3 }
//       to startingDeck.
//  This file itself is ignored by the game because its name starts with _.
// ============================================================

module.exports = {
  // ---------- What's printed on the card ----------
  name: "Card Name",               // bold, at the top of the card
  text: "What the card does.",     // under the name

  // ---------- Any stats you like ----------
  // Add whatever fields your game needs. They're sent to the website with
  // the card and you can read them in the hooks below as ctx.card.cost etc.
  // cost: 2,
  // type: "spell",

  // ============================================================
  //  HOOKS: functions the game runs at certain moments.
  //  Every hook gets `ctx`, which has:
  //
  //    ctx.card     this card (its name, text, stats; x and y once on the board)
  //    ctx.player   the player who owns this card. Useful parts:
  //                   ctx.player.number         1, 2, 3, 4...
  //                   ctx.player.name
  //                   ctx.player.turn
  //                   ctx.player.hand.length    cards in hand
  //                   ctx.player.deck.length    cards left in deck
  //                   ctx.player.field          cards on their board
  //                   ctx.player.currency.coin  (and .funding, .rep)
  //    ctx.game     the whole game (ctx.game.players has every player)
  //
  //  Effect functions (for `player` use 1, 2, 3, 4 or "self"; "self" is
  //  the player who owns this card):
  //    ctx.draw(player, amount)              that player draws `amount` cards
  //    ctx.incrementCoin(player, amount)     change their Coin by `amount`
  //    ctx.incrementFunding(player, amount)  change their Funding
  //    ctx.incrementRep(player, amount)      change their Rep
  //  (use a negative amount to take away)
  // ============================================================

  // Runs when you press Play, BEFORE the card is played.
  // Return "block" to stop it being played (e.g. can't afford it).
  onBeforePlay(ctx) {
    // Example: costs 2 Coin
    // if (ctx.player.currency.coin < 2) return "block";
  },

  // Runs when the card is played onto the board. Its main effect goes here.
  onPlay(ctx) {
    // Examples:
    // ctx.incrementCoin("self", -2);   // pay 2 Coin
    // ctx.draw("self", 1);             // draw a card
    // ctx.incrementRep(2, -1);         // player 2 loses 1 Rep
  },

  // Runs when the card is drawn into its owner's hand.
  onDraw(ctx) {},

  // Runs when the card is moved to a new spot on the board.
  onMove(ctx) {},
};
