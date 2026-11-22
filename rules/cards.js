// ============================================================
//  CARD LIST
//  Every card in the game is one entry here, keyed by its id.
//  Use the id in rules/config.js (startingDeck) to put it in decks.
//
//  Fields:
//    name  - shown at the top of the card ("" for a blank card)
//    text  - shown in the middle of the card
//    any other fields you add (cost, attack, type...) are sent to
//    the website with the card and can be used by rules/effects.js
//    onPlay(ctx) - optional: what the card does when it's played.
//                  ctx.player is who played it; ctx.card is this card.
//
//  Effect functions you can use inside onPlay:
//    ctx.draw(player, amount)
//      player: 1, 2, 3 or 4 (player number, in join order) or "self"
//              (the player who played this card)
//      amount: how many cards to draw
//
//  Example card (put it in a deck in rules/config.js to use it):
//    insight: {
//      name: "Insight",
//      text: "Draw 2 cards.",
//      onPlay(ctx) { ctx.draw("self", 2); },
//    },
// ============================================================

module.exports = {
  blank: {
    name: "",
    text: "",
  },
};
