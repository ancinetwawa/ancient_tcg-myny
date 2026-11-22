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
let zoom = 1;                         // current zoom: 1 = 100%
let tableLayout = null;               // where every board sits (see layoutTable)
let lastView = null;                  // the most recent game state from the server
let heldUid = null;                   // uid of the card you've picked up (kept out of your hand while held)
let lastMomentHeld = null;            // where you let go of a held card: { screenX, screenY, boardX, boardY }

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
    tableLayout = null;
    seenCardUids = new Set();
    $("hand").innerHTML = "";
    $("my-field").innerHTML = "";
    endHold();
    for (const board of otherBoards.values()) board.remove();
    otherBoards.clear();
    $("table").classList.add("hidden");
    $("welcome").classList.remove("hidden");
    $("join-error").textContent = "The game restarted. Enter your name to rejoin.";
  });
}

// Sends an action to the server. type: "draw", "endTurn" or "play".
// details: extra info some actions need (e.g. { uid, x, y } for play).
// If the rules refuse it, the reason pops up as a message.
// Returns true if it worked.
async function act(type, details = {}) {
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...details, playerId, type }),
    });
    const data = await res.json();
    if (!data.ok) toast(data.error);
    return data.ok;
  } catch {
    toast("Lost connection to the server");
    return false;
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
  lastView = view;
  const { you, others } = view;

  // Our name, the End Turn button, and the deck
  $("you-label").textContent = you.name;
  $("end-turn-label").textContent = `End Turn ${you.turn}`;
  $("deck-count").textContent = you.deckCount === 0 ? "Deck empty" : `${you.deckCount} cards`;
  $("deck").classList.toggle("empty", you.deckCount === 0);

  renderHand(you);
  renderField($("my-field"), you.field);

  // Other players' boards
  layoutTable(renderOtherBoards(others));

  // The card you're about to play has left your hand some other way: drop it
  if (heldUid !== null && !you.hand.some((c) => c.uid === heldUid)) endHold();

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

// ============================================================
//  HAND FAN: spreads the cards in a gentle curve, like a held hand.
//  Cards spread out until they fill the hand's width (set in
//  style.css), then overlap more as more are added.
// ============================================================
const FAN_CARD_GAP = -10;    // gap between cards when there's room (pixels); negative = overlap
const FAN_MAX_TILT = 5;      // most tilt between neighbouring cards (degrees)
const FAN_TOTAL_TILT = 36;   // most tilt across the whole hand, edge to edge (degrees)
const FAN_CURVE = 900;       // radius of the curve: smaller = cards at the edges drop lower

function layoutFan(hand) {
  const cards = [...hand.children];
  const n = cards.length;
  if (n === 0) return;
  const cardW = cards[0].offsetWidth; // width of one card
  const space = hand.clientWidth;     // width the hand may use
  // Distance between neighbouring cards: side by side if they fit, else squeezed together
  const step = n > 1 ? Math.max(6, Math.min(cardW + FAN_CARD_GAP, (space - cardW) / (n - 1))) : 0;
  const tilt = n > 1 ? Math.min(FAN_MAX_TILT, FAN_TOTAL_TILT / (n - 1)) : 0;

  let lowest = 0; // how far the lowest card corner sits below the hand's bottom edge
  cards.forEach((card, i) => {
    const fromMiddle = i - (n - 1) / 2;                                // e.g. -2,-1,0,1,2 for 5 cards
    const rot = fromMiddle * tilt;                                     // left cards tilt left, right cards right
    const rad = (rot * Math.PI) / 180;
    const drop = FAN_CURVE * (1 - Math.cos(rad));                      // edge cards sit a little lower
    card.style.setProperty("--x", `${fromMiddle * step}px`);
    card.style.setProperty("--y", `${drop}px`);
    card.style.setProperty("--rot", `${rot}deg`);
    // A tilted card's outer bottom corner dips below its bottom middle
    lowest = Math.max(lowest, drop + (cardW / 2) * Math.abs(Math.sin(rad)));
  });
  // New cards ("placing") jump straight to their spot instead of sliding out
  // from the centre; after that they slide normally when the hand changes.
  for (const card of cards) {
    if (card.classList.contains("placing")) {
      void card.offsetWidth; // makes the browser apply the new position now, with no slide
      card.classList.remove("placing");
    }
  }
  // Used by style.css to raise your hand far enough that no card is cut off when you hover it
  hand.style.setProperty("--hand-lift", `${lowest}px`);
}

// ============================================================
//  OTHER PLAYERS' BOARDS
//  Same layout as yours, but their hand shows face-down cards and
//  their deck can't be clicked. Rebuilt on every update.
// ============================================================
// Your hand: updated in place. Cards already showing are kept as they
// are (so they don't jump or re-animate); only new cards are added and
// cards that left the hand are removed. A card you're holding is left out.
function renderHand(you) {
  const hand = $("hand");
  const shown = new Map([...hand.children].map((el) => [el.dataset.uid, el])); // uid -> card element on screen
  you.hand
    .filter((card) => card.uid !== heldUid)
    .forEach((card, i) => {
      let el = shown.get(String(card.uid));
      if (!el) {
        el = makeCardElement(card);
        if (!firstRender && !seenCardUids.has(card.uid)) el.classList.add("new"); // slide-in animation
      }
      seenCardUids.add(card.uid);
      shown.delete(String(card.uid));
      if (hand.children[i] !== el) hand.insertBefore(el, hand.children[i] || null); // only moves cards whose order changed
    });
  for (const gone of shown.values()) gone.remove(); // cards no longer in the hand
  layoutFan(hand);
  firstRender = false;
}

// Cards played onto a board (yours or another player's). Updated in place
// like the hand. Each card sits with its centre at its x, y on the board.
function renderField(field, cards) {
  const shown = new Map([...field.children].map((el) => [el.dataset.uid, el]));
  for (const card of cards) {
    let el = shown.get(String(card.uid));
    if (!el) {
      el = makeCardElement(card);
      el.classList.remove("placing");
      field.appendChild(el);
    }
    shown.delete(String(card.uid));
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
  }
  for (const gone of shown.values()) gone.remove();
}

// Builds one card element (used for cards in your hand).
function makeCardElement(card) {
  const el = document.createElement("div");
  el.className = "card placing"; // "placing": appears in its spot without sliding there
  el.dataset.uid = card.uid;     // lets render() recognise this card on later updates
  el.addEventListener("animationend", () => el.classList.remove("new")); // so the slide-in only ever plays once
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
  return el;
}

// Creates or updates every other player's board, in seat order.
// Boards and cards already on screen are kept and only updated, so
// nothing re-animates when something unrelated changes.
// Returns the boards in seat order (used by layoutTable).
const otherBoards = new Map(); // player id -> their board element

function renderOtherBoards(others) {
  // Remove boards of players who are no longer in the game
  const stillHere = new Set(others.map((p) => p.id));
  for (const [id, board] of otherBoards) {
    if (!stillHere.has(id)) { board.remove(); otherBoards.delete(id); }
  }

  return others.map((p) => {
    let board = otherBoards.get(p.id);
    if (!board) {
      // First time we see this player: build their board
      board = document.createElement("div");
      board.innerHTML = `
        <div class="deck-area"><div class="deck"><span class="deck-stack"></span><span class="deck-count"></span></div></div>
        <div class="field"></div>
        <div class="hand"></div>
        <div class="board-name"></div>`;
      $("world").appendChild(board);
      otherBoards.set(p.id, board);
    }

    // Update what may have changed
    board.className = "board other" + (p.online ? "" : " offline");
    board.querySelector(".deck").classList.toggle("empty", p.deckCount === 0);
    board.querySelector(".deck-count").textContent = p.deckCount === 0 ? "Deck empty" : `${p.deckCount} cards`;
    board.querySelector(".board-name").textContent = `${p.name} · Turn ${p.turn}`;

    // Hand: one face-down card per card they hold; add or remove only the difference
    const hand = board.querySelector(".hand");
    while (hand.children.length < p.handCount) {
      const back = document.createElement("div");
      back.className = "card back placing";
      hand.appendChild(back);
    }
    while (hand.children.length > p.handCount) hand.lastChild.remove();
    layoutFan(hand);
    renderField(board.querySelector(".field"), p.field);
    return board;
  });
}

// ============================================================
//  TABLE LAYOUT: where each board sits around yours.
//  Positions are in board pixels with YOUR board's centre at (0, 0);
//  negative x = left, negative y = up. rot = rotation in degrees.
//  Players are listed clockwise from you (the server sends them in
//  that order), so seat 1 is the next player after you.
// ============================================================
const BOARD_GAP = 40;    // space between boards
const BASE_SCALE = 0.85; // size of everything at "100%" zoom (0.85 = 15% smaller than full size)
const MAX_ZOOM = 2;      // furthest zoom in (200%)
const ZOOM_STEP = 0.1;   // each click of + or - changes zoom by 10%

function seatPositions(numOthers, W, H) {
  const up = -(H + BOARD_GAP);   // one board-height above yours
  const left = -(W + BOARD_GAP); // one board-width to your left

  // 2 players: opponent straight across, facing you
  if (numOthers === 1) return [{ x: 0, y: up, rot: 180 }];

  // 3 players: next player on your left, turned to face the middle; then one across
  if (numOthers === 2) return [
    { x: -(W / 2 + BOARD_GAP + H / 2), y: up / 2, rot: 90 },
    { x: 0, y: up, rot: 180 },
  ];

  // 4 players: like two 2-player tables side by side.
  // Next to you (left), across from them, then across from you.
  const seats = [
    { x: left, y: 0, rot: 0 },
    { x: left, y: up, rot: 180 },
    { x: 0, y: up, rot: 180 },
  ];
  // 5+ players: more columns further left, bottom then top
  for (let k = 3; k < numOthers; k++) {
    const column = 2 + Math.floor((k - 3) / 2);
    const top = (k - 3) % 2 === 1;
    seats.push({ x: column * left, y: top ? up : 0, rot: top ? 180 : 0 });
  }
  return seats.slice(0, numOthers);
}

// Places every board, works out the table's total size, then applies zoom.
function layoutTable(others) {
  const numOthers = others.length;
  const css = getComputedStyle(document.documentElement);
  const W = parseFloat(css.getPropertyValue("--board-w"));
  const H = parseFloat(css.getPropertyValue("--board-h"));
  const boards = [$("my-board"), ...others];
  const seats = [{ x: 0, y: 0, rot: 0 }, ...seatPositions(numOthers, W, H)];

  // Bounding box of all boards (a board turned 90 degrees is H wide and W tall)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of seats) {
    const sideways = s.rot % 180 !== 0;
    const halfW = (sideways ? H : W) / 2;
    const halfH = (sideways ? W : H) / 2;
    minX = Math.min(minX, s.x - halfW); maxX = Math.max(maxX, s.x + halfW);
    minY = Math.min(minY, s.y - halfH); maxY = Math.max(maxY, s.y + halfH);
  }

  // Place each board (rotation turns it around its own centre)
  boards.forEach((board, i) => {
    const s = seats[i];
    board.style.left = `${s.x - W / 2 - minX}px`;
    board.style.top = `${s.y - H / 2 - minY}px`;
    board.style.transform = s.rot ? `rotate(${s.rot}deg)` : "";
  });

  const firstLayout = !tableLayout || tableLayout.numOthers !== numOthers;
  tableLayout = {
    numOthers,
    width: maxX - minX,
    height: maxY - minY,
    myLeft: -W / 2 - minX,  // your board's left edge within the table
    myBottom: H / 2 - minY, // your board's bottom edge within the table
  };
  applyZoom();
  if (firstLayout) scrollToMyBoard(); // new table shape: start looking at your board
}

// ============================================================
//  ZOOM AND SCROLLING
// ============================================================
// Smallest zoom: where the whole table fits on screen (never above 100%).
function minZoom() {
  if (!tableLayout) return 1;
  const view = $("viewport");
  const fit = Math.min(view.clientWidth / tableLayout.width, view.clientHeight / tableLayout.height);
  return Math.min(1, fit / BASE_SCALE);
}

// Scales the table to the current zoom and updates the - 100% + control.
function applyZoom() {
  if (!tableLayout) return;
  zoom = Math.min(MAX_ZOOM, Math.max(minZoom(), zoom));
  const scale = BASE_SCALE * zoom;
  const world = $("world");
  world.style.width = `${tableLayout.width}px`;
  world.style.height = `${tableLayout.height}px`;
  world.style.transform = `scale(${scale})`;
  $("world-sizer").style.width = `${tableLayout.width * scale}px`;   // lets the page scroll
  $("world-sizer").style.height = `${tableLayout.height * scale}px`; // over the whole zoomed table
  $("zoom-level").textContent = `${Math.round(zoom * 100)}%`;
  $("zoom-out").disabled = zoom <= minZoom() + 0.001;
  $("zoom-in").disabled = zoom >= MAX_ZOOM - 0.001;
}

// Scrolls so your board's bottom-left corner is at the screen's bottom-left.
function scrollToMyBoard() {
  const view = $("viewport");
  const scale = BASE_SCALE * zoom;
  view.scrollLeft = tableLayout.myLeft * scale;
  view.scrollTop = tableLayout.myBottom * scale - view.clientHeight;
}

// Changes zoom while keeping the middle of the screen in the same place.
function zoomBy(step) {
  if (!tableLayout) return;
  const view = $("viewport");
  const oldScale = BASE_SCALE * zoom;
  const centerX = (view.scrollLeft + view.clientWidth / 2) / oldScale;  // table point at screen centre
  const centerY = (view.scrollTop + view.clientHeight / 2) / oldScale;
  zoom = Math.round((zoom + step) * 10) / 10; // keep to clean 10% steps
  applyZoom();
  const newScale = BASE_SCALE * zoom;
  view.scrollLeft = centerX * newScale - view.clientWidth / 2;
  view.scrollTop = centerY * newScale - view.clientHeight / 2;
}
$("zoom-in").addEventListener("click", () => zoomBy(ZOOM_STEP));
$("zoom-out").addEventListener("click", () => zoomBy(-ZOOM_STEP));
window.addEventListener("resize", applyZoom);

// ============================================================
//  FRAMED BUTTON OUTLINES (End Turn, Play, Cancel)
//  Draws the two cut-corner outlines as an SVG sized to each button.
//  The look settings (--cut, --round, --thick, --gap, --inner-shift)
//  are in the .frame-btn section of style.css. Redraws whenever a
//  button changes size (e.g. "End Turn 9" -> "End Turn 10").
// ============================================================
const SVG_NS = "http://www.w3.org/2000/svg";

// Turns a list of corner points into a closed path with rounded corners.
// radii: one number per corner = how far from that corner the rounding
// starts, in pixels (0 = sharp corner).
function roundedPath(points, radii) {
  let d = "";
  points.forEach((cur, i) => {
    const radius = radii[i];
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
// Order: [0] top-left cut (top end), [1] top-right, [2] bottom-right cut (top end),
//        [3] bottom-right cut (bottom end), [4] bottom-left, [5] top-left cut (left end)
function cutCornerPoints(x0, y0, x1, y1, cut) {
  return [
    [x0 + cut, y0], [x1, y0],       // top edge (starts after the top-left cut)
    [x1, y1 - cut], [x1 - cut, y1], // right edge, then the bottom-right cut
    [x0, y1], [x0, y0 + cut],       // bottom edge, left edge, then the top-left cut
  ];
}

function drawButtonFrame(button) {
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

  // Only the top-right [1] and bottom-left [4] corners are rounded; the cut corners stay sharp.
  const outerRadii = [0, radius, 0, 0, radius, 0];
  const innerRadii = outerRadii.map((r) => r * 0.7); // slightly tighter so inner corners sit evenly inside

  outer.setAttribute("d", roundedPath(cutCornerPoints(half, half, w - half, h - half, outerCut), outerRadii));
  inner.setAttribute("d", roundedPath(
    cutCornerPoints(inset + shift, inset, w - inset + shift, h - inset, innerCut),
    innerRadii
  ));
}
const frameObserver = new ResizeObserver((entries) => entries.forEach((e) => drawButtonFrame(e.target)));
document.querySelectorAll(".frame-btn").forEach((button) => frameObserver.observe(button));

// ============================================================
//  PLAYING A CARD
//  1. Press and hold a card in your hand: it leaves the hand, grows,
//     and follows the cursor.
//  2. Let go far enough above your hand: it moves to the middle of the
//     screen and grows again, with Play and Cancel next to it. Where
//     you let go is saved in lastMomentHeld.
//     Let go too close to your hand: it goes back.
//  3. Cancel: back to the hand. Play: placed on your board at the spot
//     you let go, at the same size as your deck.
// ============================================================
const HOLD_SCALE = 1.25;               // size while dragging, compared with a card in your hand (+25%)
const STAGE_SCALE = HOLD_SCALE * 1.5;  // size in the middle of the screen (another +50%); if you change this, update .stage-buttons in style.css
const PLAY_DISTANCE = 50;       // how far above your hand (pixels) the card's bottom must be to play it

let heldCard = null;  // the floating card element while holding or staging
let holdState = null; // null, "dragging" or "staged"

// Puts the floating card's centre at (x, y) on screen, at a given size.
function placeHeld(x, y, scale) {
  heldCard.style.setProperty("--gx", `${x}px`);
  heldCard.style.setProperty("--gy", `${y}px`);
  heldCard.style.setProperty("--gs", scale);
}

// 1. Pick up: press on a card in your hand
$("hand").addEventListener("pointerdown", (e) => {
  const cardEl = e.target.closest(".card");
  if (!cardEl || e.button !== 0 || holdState) return;
  const card = lastView.you.hand.find((c) => String(c.uid) === cardEl.dataset.uid);
  if (!card) return;
  e.preventDefault();

  heldUid = card.uid;
  heldCard = makeCardElement(card);
  heldCard.classList.remove("placing");
  heldCard.classList.add("held-card");
  document.body.appendChild(heldCard);
  placeHeld(e.clientX, e.clientY, HOLD_SCALE);
  holdState = "dragging";
  renderHand(lastView.you); // takes the card out of the hand; the rest close up

  window.addEventListener("pointermove", dragMove);
  window.addEventListener("pointerup", dragEnd, { once: true });
});

// The card follows the cursor
function dragMove(e) {
  placeHeld(e.clientX, e.clientY, HOLD_SCALE);
}

// 2. Let go
function dragEnd(e) {
  window.removeEventListener("pointermove", dragMove);
  if (holdState !== "dragging") return;

  const cardBottom = e.clientY + (heldCard.offsetHeight * HOLD_SCALE) / 2;
  const handTop = $("hand").getBoundingClientRect().top;
  if (handTop - cardBottom <= PLAY_DISTANCE) return endHold(); // not far enough: back to the hand

  // Remember where it was let go, on screen and on your board
  const board = $("my-board").getBoundingClientRect();
  const scale = BASE_SCALE * zoom; // how big the table is drawn right now
  lastMomentHeld = {
    screenX: e.clientX,
    screenY: e.clientY,
    boardX: (e.clientX - board.left) / scale,
    boardY: (e.clientY - board.top) / scale,
  };

  // Glide to the middle of the screen, bigger, with Play and Cancel
  holdState = "staged";
  heldCard.classList.add("staged");
  placeHeld(window.innerWidth / 2, window.innerHeight / 2, STAGE_SCALE);
  $("stage-buttons").classList.remove("hidden");
}

// 3a. Cancel: the card goes back to your hand
$("cancel-btn").addEventListener("click", () => endHold());

// 3b. Play: place it on your board where you let go
$("play-btn").addEventListener("click", async () => {
  if (holdState !== "staged") return;
  $("play-btn").disabled = true;
  const played = await act("play", { uid: heldUid, x: lastMomentHeld.boardX, y: lastMomentHeld.boardY });
  $("play-btn").disabled = false;
  if (holdState !== "staged") return; // the server's update already arrived and tidied up
  if (!played) return endHold();      // refused: back to the hand (the reason pops up)
  // Played. Hide the floating card; render() finishes up (endHold) once the
  // server's update arrives showing the card on the board, so it never
  // flashes back into the hand in between.
  heldCard.remove();
  heldCard = null;
  holdState = "played";
  $("stage-buttons").classList.add("hidden");
  if (!lastView.you.hand.some((c) => c.uid === heldUid)) endHold(); // update already arrived
});

// Clears the floating card and buttons, and shows the hand as the server has it.
function endHold() {
  window.removeEventListener("pointermove", dragMove);
  heldCard?.remove();
  heldCard = null;
  holdState = null;
  heldUid = null;
  $("stage-buttons").classList.add("hidden");
  if (lastView) renderHand(lastView.you);
}

// Shows a short message at the top of the screen for 2 seconds.
let toastTimer; // timer that hides the message
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}
