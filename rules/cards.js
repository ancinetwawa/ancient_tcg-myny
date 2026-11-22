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
// ============================================================

module.exports = {
  blank: {
    name: "",
    text: "",
  },
};
