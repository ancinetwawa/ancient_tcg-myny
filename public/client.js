// ============================================================
//  WEBSITE SCRIPT (runs in each player's browser)
//  Shows whatever the server sends and sends the player's clicks
//  back. Game rules are NOT here; they live on the server in /rules.
// ============================================================

// Shortcut: $("deck") finds the element with id="deck" in index.html
const $ = (id) => document.getElementById(id);

// Saves small values in the browser between visits (player id and name).
// Wrapped in try/catch because some browsers block storage.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

// ---------- State ----------
let playerId = store.get("playerId"); // our secret id from the server; lets a reload keep our cards
let events = null;                    // the live-update connection to the server
let seenCardUids = new Set();         // card uids already shown, so only NEW cards animate in
let firstRender = true;               // true until the table is drawn once (skip animation then)

// Pre-fill the name box with the name used last time
$("name-input").value = store.get("playerName") || "";

// ============================================================
//  WELCOME SCREEN: send the name to the server, then connect
// ============================================================
$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault(); // stop the page from reloading
  const name = $("name-input").value.trim();
  if (!name) return;
  $("join-error").textContent = "";
  try {
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, playerId }),
    });
    const data = await res.json(); // { ok, playerId } or { ok:false, error }
    if (!data.ok) throw new Error(data.error || "Could not join");
    playerId = data.playerId;
    store.set("playerId", playerId);
    store.set("playerName", name);
    connect();
  } catch (err) {
    $("join-error").textContent = err.message || "Could not reach the server. Try again.";
  }
});

// Opens the live-update connection. Every time the game changes,
// the server sends a "state" message and we redraw the table.
function connect() {
  if (events) events.close();
  events = new EventSource(`/api/events?playerId=${encodeURIComponent(playerId)}`);

  // New game state arrived: switch to the table and draw it
  events.addEventListener("state", (e) => {
    $("welcome").classList.add("hidden");
    $("table").classList.remove("hidden");
    render(JSON.parse(e.data));
  });

  // The server forgot us (e.g. it restarted): go back to the welcome screen
  events.addEventListener("reset", () => {
    events.close();
    events = null;
    playerId = null;
    store.remove("playerId");
    firstRender = true;
    seenCardUids = new Set();
    $("table").classList.add("hidden");
    $("welcome").classList.remove("hidden");
    $("join-error").textContent = "The game restarted. Enter your name to rejoin.";
  });
}

// Sends an action to the server. type: "draw" or "endTurn".
// If the rules refuse it, the reason pops up as a message.
async function act(type) {
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, type }),
    });
    const data = await res.json();
    if (!data.ok) toast(data.error);
  } catch {
    toast("Lost connection to the server");
  }
}

// ---------- Buttons ----------
$("deck").addEventListener("click", () => act("draw"));
$("end-turn").addEventListener("click", () => act("endTurn"));

// ============================================================
//  DRAW THE TABLE from the server's view of the game.
//  view.you    = our name, turn, deckCount and full hand
//  view.others = other players' name, turn, handCount, online
// ============================================================
function render(view) {
  const { you, others } = view;

  // Our name, the End Turn button, and the deck
  $("you-label").textContent = you.name;
  $("end-turn-label").textContent = `End Turn ${you.turn}`;
  $("deck-count").textContent = you.deckCount === 0 ? "Deck empty" : `${you.deckCount} cards`;
  $("deck").classList.toggle("empty", you.deckCount === 0);

  // Our hand: rebuild one white card element per card
  const hand = $("hand");
  hand.innerHTML = "";
  for (const card of you.hand) {
    const el = document.createElement("div");
    el.className = "card";
    if (!firstRender && !seenCardUids.has(card.uid)) el.classList.add("new"); // slide-in animation
    seenCardUids.add(card.uid);
    // Card name and text (empty for blank cards)
    if (card.name) {
      const name = document.createElement("div");
      name.className = "card-name";
      name.textContent = card.name;
      el.appendChild(name);
    }
    if (card.text) {
      const text = document.createElement("div");
      text.textContent = card.text;
      el.appendChild(text);
    }
    hand.appendChild(el);
  }
  fitHand();
  firstRender = false;

  // Other players: one chip each at the top of the screen
  const list = $("players");
  list.innerHTML = "";
  for (const p of others) {
    const chip = document.createElement("div");
    chip.className = "player-chip" + (p.online ? "" : " offline"); // offline chips fade out
    const dot = document.createElement("span"); // green = online, gray = offline
    dot.className = "dot";
    const name = document.createElement("strong");
    name.textContent = p.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `Turn ${p.turn} · ${p.handCount} in hand`;
    chip.append(dot, name, meta);
    list.appendChild(chip);
  }
}

// Overlaps the cards in the hand when there are too many to fit side by side.
// Sets the CSS variable --overlap (gap between cards; negative = overlapping).
function fitHand() {
  const hand = $("hand");
  const cards = hand.children.length; // number of cards in hand
  if (cards < 2) return hand.style.setProperty("--overlap", "8px");
  const cardW = hand.firstChild.offsetWidth; // width of one card in pixels
  const space = parseFloat(getComputedStyle(hand).maxWidth) || window.innerWidth; // room available
  const needed = cards * cardW + (cards - 1) * 8; // width if laid out with normal 8px gaps
  const overlap = needed <= space ? 8 : (space - cards * cardW) / (cards - 1);
  hand.style.setProperty("--overlap", `${Math.max(overlap, -cardW + 12)}px`); // always show 12px of each card
}
window.addEventListener("resize", fitHand);

// ============================================================
//  END TURN BUTTON OUTLINES
//  Draws the two cut-corner outlines as an SVG sized to the button.
//  The look settings (--cut, --round, --thick, --gap, --inner-shift)
//  are in the .end-turn section of style.css. Redraws whenever the
//  button changes size (e.g. "End Turn 9" -> "End Turn 10").
// ============================================================
const SVG_NS = "http://www.w3.org/2000/svg";

// Turns a list of corner points into a closed path with rounded corners.
// radius: how far from each corner the rounding starts, in pixels.
function roundedPath(points, radius) {
  let d = "";
  points.forEach((cur, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    // Distance to the neighbouring corners; rounding can't use more than half an edge
    const lenIn = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const lenOut = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    // Where the curve starts (on the edge coming in) and ends (on the edge going out)
    const start = [cur[0] - ((cur[0] - prev[0]) / lenIn) * r, cur[1] - ((cur[1] - prev[1]) / lenIn) * r];
    const end = [cur[0] + ((next[0] - cur[0]) / lenOut) * r, cur[1] + ((next[1] - cur[1]) / lenOut) * r];
    d += `${i === 0 ? "M" : "L"}${start} Q${cur} ${end} `;
  });
  return d + "Z";
}

// Corner points of a rectangle with its top-left and bottom-right corners cut.
// (x0, y0) = top-left, (x1, y1) = bottom-right, cut = size of the diagonal cut.
function cutCornerPoints(x0, y0, x1, y1, cut) {
  return [
    [x0 + cut, y0], [x1, y0],       // top edge (starts after the top-left cut)
    [x1, y1 - cut], [x1 - cut, y1], // right edge, then the bottom-right cut
    [x0, y1], [x0, y0 + cut],       // bottom edge, left edge, then the top-left cut
  ];
}

function drawEndTurnFrame() {
  const button = $("end-turn");
  const css = getComputedStyle(button);
  const setting = (name) => parseFloat(css.getPropertyValue(name)) || 0;
  const cut = setting("--cut");
  const round = setting("--round");
  const thick = setting("--thick");
  const gap = setting("--gap");
  const shift = setting("--inner-shift");
  const w = button.offsetWidth;  // button width
  const h = button.offsetHeight; // button height

  // Create the drawing the first time
  let svg = button.querySelector(".frame");
  if (!svg) {
    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "frame");
    svg.append(document.createElementNS(SVG_NS, "path"), document.createElementNS(SVG_NS, "path"));
    button.prepend(svg);
  }
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const [outer, inner] = svg.querySelectorAll("path");

  // Lines are drawn along their centre, so pull each outline in by half
  // its thickness to keep it inside the button. 0.586 keeps the diagonal
  // cuts parallel when an outline is pulled inward.
  const half = thick / 2;
  const outerCut = cut - half * 0.586;
  const inset = half + thick + gap; // how far in the inner outline sits
  const innerCut = cut - inset * 0.586;
  const radius = round * h;         // --round is a fraction of the button's height

  outer.setAttribute("d", roundedPath(cutCornerPoints(half, half, w - half, h - half, outerCut), radius));
  inner.setAttribute("d", roundedPath(
    cutCornerPoints(inset + shift, inset, w - inset + shift, h - inset, innerCut),
    radius * 0.7 // slightly tighter rounding so the inner corners sit evenly inside the outer ones
  ));
}
new ResizeObserver(drawEndTurnFrame).observe($("end-turn"));

// Shows a short message at the top of the screen for 2 seconds.
let toastTimer; // timer that hides the message
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}
