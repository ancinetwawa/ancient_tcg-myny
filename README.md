# Ancient TCG

An online multiplayer trading card game. Players enter a name, get their own
60-card deck, draw cards by clicking the deck, and end turns with the button
in the bottom-right corner. Everyone connected sees each other's names, turn
numbers and hand sizes live.

The game rules live in their own files, separate from the engine, so you can
change how the game plays without touching the server code.

## Where things are

| Folder / file | What it is | Edit it? |
|---|---|---|
| `rules/config.js` | Deck contents, starting hand, draw limits, hand limit | **Yes**: this is where you tinker |
| `rules/cards.js` | Every card in the game (name, text, any stats you add) | **Yes** |
| `rules/effects.js` | Custom rules that run on join, draw, end of turn, start of turn | **Yes** |
| `server/engine.js` | Applies the rules above | Rarely |
| `server/index.js` | Web server and live updates | Rarely |
| `public/` | The website (welcome screen, table, cards, button) | For look-and-feel changes |
| `test/` | Automated checks of the engine | Add tests for new rules |

## Changing the rules: examples

**Smaller deck:** in `rules/config.js` set `{ card: "blank", count: 40 }`.

**Start with 5 cards in hand:** in `rules/config.js` set `startingHandSize: 5`.

**Only one draw per turn:** in `rules/config.js` set `maxDrawsPerTurn: 1`.

**Add a card:** in `rules/cards.js` add

```js
fireball: { name: "Fireball", text: "Deal 3 damage.", cost: 2 },
```

then add `{ card: "fireball", count: 4 }` to `startingDeck` in `rules/config.js`.

**Custom rule:** in `rules/effects.js`, for example, to draw a card
automatically at the start of every turn:

```js
onTurnStart(ctx) {
  const card = ctx.player.deck.pop();
  if (card) ctx.player.hand.push(card);
},
```

## Running it on your own computer (optional)

Requires [Node.js](https://nodejs.org) 18 or newer. No packages to install.

```
npm start      # then open http://localhost:3000
npm test       # run the automated checks
```

## Hosting on Render

Create a **Web Service** from this repository with:

- **Runtime:** Node
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Instance type:** Free

Every push to the `main` branch redeploys the site automatically.

Note: game state is kept in the server's memory, so it resets when the server
restarts or redeploys (and Render's free plan sleeps after 15 minutes with
no visitors). Players are sent back to the welcome screen when that happens.
