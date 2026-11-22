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
//    ctx.draw(player, amount) - make a player draw cards.
//                  player: 1-4 (player number, in join order) or "self"
//                  (the player this hook is about); amount: how many.
//
//  Return the string "block" from onBeforeDraw, onBeforePlay or
//  onBeforeMove to stop that draw, play or move.
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
  onTurnStart(ctx) {
    ctx.draw("self", 1); // draw 1 card at the start of each turn
  },

  // Runs before a card is played from the hand. Return "block" to cancel it.
  // ctx.card is the card being played.
  onBeforePlay(ctx) {},

  // Runs after a card has been played onto the board.
  // ctx.card has x and y: where on the board it was placed.
  onPlay(ctx) {},

  // Runs before a card already on the board is moved. Return "block" to cancel it.
  onBeforeMove(ctx) {},

  // Runs after a card on the board has been moved. ctx.card has its new x and y.
  onMove(ctx) {},
};
