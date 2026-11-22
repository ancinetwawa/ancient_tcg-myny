# Cards

Every card in the game is one file in this folder. The file name is the
card's id: `cards/fireball.js` is the card `"fireball"`.

## Make a card

1. Copy `_template.js` and rename the copy, e.g. `fireball.js`.
   Lowercase letters, numbers and `_` only, and don't start the name with `_`.
2. Set its `name` and `text` (what's printed on the card), add any stats,
   and fill in the hooks you need. Delete the ones you don't.
3. Put it in the deck: in `rules/config.js`, add `{ card: "fireball", count: 3 }`
   to `startingDeck`.
4. Commit. Render redeploys and the card is in the game.

## What a card can do

Hooks (functions the game runs):

| Hook | When it runs |
|---|---|
| `onBeforePlay(ctx)` | When you press Play, before it's played. Return `"block"` to stop it. |
| `onPlay(ctx)` | When it's played onto the board. Its main effect goes here. |
| `onDraw(ctx)` | When it's drawn into its owner's hand. |
| `onMove(ctx)` | When it's moved on the board. |

Effect functions (`player` is `1`, `2`, `3`, `4` or `"self"`, meaning the card's owner):

| Function | What it does |
|---|---|
| `ctx.draw(player, amount)` | That player draws `amount` cards |
| `ctx.incrementCoin(player, amount)` | Changes their Coin (negative takes away) |
| `ctx.incrementFunding(player, amount)` | Changes their Funding |
| `ctx.incrementRep(player, amount)` | Changes their Rep |

Things you can read: `ctx.card` (this card), `ctx.player` (its owner:
`.number`, `.currency.coin`, `.hand.length`...), `ctx.game` (everything).
Full details are in the comments in `_template.js`.

## What's in this folder

- `_template.js`: the commented template to copy when making a card.
- `blank.js`: the plain white card the deck is made of right now.

## Example

A card that costs 1 Coin, gives 3 Coin, and makes player 2 lose 1 Rep:

```js
module.exports = {
  name: "Tax",
  text: "Costs 1 Coin. Gain 3 Coin. Player 2 loses 1 Rep.",
  cost: 1,
  onBeforePlay(ctx) {
    if (ctx.player.currency.coin < ctx.card.cost) return "block"; // can't afford it
  },
  onPlay(ctx) {
    ctx.incrementCoin("self", -ctx.card.cost); // pay the cost
    ctx.incrementCoin("self", 3);
    ctx.incrementRep(2, -1);
  },
};
```

## Rules for every card

Rules that apply to all cards (not just one) go in `rules/effects.js`,
which has the same hooks and effect functions.
