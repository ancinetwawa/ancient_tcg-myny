// ============================================================
//  EFFECTS AND RULE HOOKS
//  The engine calls these functions at key moments of the game.
//  Put custom rules here. Each gets a `ctx` object with:
//    ctx.player  - the player it is happening to
//                  (name, turn, deck, hand, drawsThisTurn)
//    ctx.card    - the card involved, when there is one
//                  ({ uid, id, ...the card's fields from cards.js })
//    ctx.game    - the whole game (ctx.game.players is a Map)
//
//  Return the string "block" from onBeforeDraw to stop a draw.
// ============================================================

module.exports = {
  // Runs once when a new player joins, after their deck is built.
  onJoin(ctx) {},

  // Runs before a draw. Return "block" to cancel it.
  onBeforeDraw(ctx) {},

  // Runs after a card moves from the deck into the hand.
  onDraw(ctx) {},

  // Runs when a player ends their turn, before the turn number goes up.
  onTurnEnd(ctx) {},

  // Runs after the turn number goes up.
  onTurnStart(ctx) {},
};
