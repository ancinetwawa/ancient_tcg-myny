// ============================================================
//  CARD LIST (loader)
//  Every card lives in its own file in the /cards folder. This file
//  just collects them all. You don't need to edit it: to make a card,
//  copy cards/_template.js (see cards/README.md).
//
//  The card's id is its file name: cards/fireball.js -> "fireball".
//  Files whose name starts with _ (like the template) are skipped.
// ============================================================

const fs = require("fs");
const path = require("path");

const CARDS_DIR = path.join(__dirname, "..", "cards");

const cards = {};
for (const file of fs.readdirSync(CARDS_DIR).sort()) {
  if (!file.endsWith(".js") || file.startsWith("_")) continue;
  const id = file.slice(0, -3); // "fireball.js" -> "fireball"
  cards[id] = require(path.join(CARDS_DIR, file));
}

module.exports = cards;
