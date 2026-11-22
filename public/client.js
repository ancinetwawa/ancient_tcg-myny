// The website. It shows what the server sends and sends the player's
// clicks back. Game rules are NOT here; they live on the server in /rules.

const $ = (id) => document.getElementById(id);
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

let playerId = store.get("playerId");
let events = null;
let seenCardUids = new Set();
let firstRender = true;

$("name-input").value = store.get("playerName") || "";

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("name-input").value.trim();
  if (!name) return;
  $("join-error").textContent = "";
  try {
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, playerId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not join");
    playerId = data.playerId;
    store.set("playerId", playerId);
    store.set("playerName", name);
    connect();
  } catch (err) {
    $("join-error").textContent = err.message || "Could not reach the server. Try again.";
  }
});

function connect() {
  if (events) events.close();
  events = new EventSource(`/api/events?playerId=${encodeURIComponent(playerId)}`);
  events.addEventListener("state", (e) => {
    $("welcome").classList.add("hidden");
    $("table").classList.remove("hidden");
    render(JSON.parse(e.data));
  });
  // The server forgot us (e.g. it restarted): go back to the welcome screen.
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

$("deck").addEventListener("click", () => act("draw"));
$("end-turn").addEventListener("click", () => act("endTurn"));

function render(view) {
  const { you, others } = view;

  $("you-label").textContent = you.name;
  $("end-turn").textContent = `End Turn ${you.turn}`;
  $("deck-count").textContent = you.deckCount === 0 ? "Deck empty" : `${you.deckCount} cards`;
  $("deck").classList.toggle("empty", you.deckCount === 0);

  // Hand
  const hand = $("hand");
  hand.innerHTML = "";
  for (const card of you.hand) {
    const el = document.createElement("div");
    el.className = "card";
    if (!firstRender && !seenCardUids.has(card.uid)) el.classList.add("new");
    seenCardUids.add(card.uid);
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

  // Other players
  const list = $("players");
  list.innerHTML = "";
  for (const p of others) {
    const chip = document.createElement("div");
    chip.className = "player-chip" + (p.online ? "" : " offline");
    const dot = document.createElement("span");
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

// Overlap cards when the hand gets wider than the space available.
function fitHand() {
  const hand = $("hand");
  const cards = hand.children.length;
  if (cards < 2) return hand.style.setProperty("--overlap", "8px");
  const cardW = hand.firstChild.offsetWidth;
  const space = parseFloat(getComputedStyle(hand).maxWidth) || window.innerWidth;
  const needed = cards * cardW + (cards - 1) * 8;
  const overlap = needed <= space ? 8 : (space - cards * cardW) / (cards - 1);
  hand.style.setProperty("--overlap", `${Math.max(overlap, -cardW + 12)}px`);
}
window.addEventListener("resize", fitHand);

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}
