// ============================================================
//  WEB SERVER
//  Serves the website from /public, lets players join, receives
//  their actions, and pushes live updates to every open screen
//  (using Server-Sent Events). Uses only what comes with Node.js,
//  so there are no packages to install.
// ============================================================

const http = require("http"); // built-in web server
const fs = require("fs");     // built-in file reading
const path = require("path"); // built-in file path helpers
const { Game } = require("./engine");

// ---------- Settings ----------
const PORT = process.env.PORT || 3000;                     // Render sets PORT; 3000 on your own computer
const PUBLIC_DIR = path.join(__dirname, "..", "public");   // folder holding the website files
const MAX_NAME_LENGTH = 20;                                // longest name a player can use
const FORGET_OFFLINE_PLAYERS_AFTER_MS = 30 * 60 * 1000;    // remove players gone this long (30 min)

// ---------- Server state ----------
const game = new Game();   // the one game everyone plays in
const streams = new Map(); // player id -> Set of open live-update connections (one per open tab)

// File types the website uses, so browsers know how to read each file.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Sends a JSON reply. status: HTTP code (200 ok, 400 bad request).
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Reads a JSON request body. Gives {} for anything unreadable,
// and cuts off oversized bodies so nobody can flood the server.
function readJson(req) {
  return new Promise((resolve) => {
    let data = ""; // body text collected so far
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Sends one player their current view of the game, on every tab they have open.
function pushTo(playerId) {
  const view = game.viewFor(playerId);
  for (const res of streams.get(playerId) || []) {
    res.write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
  }
}

// Sends every connected player their updated view (after anything changes).
function broadcast() {
  for (const playerId of streams.keys()) pushTo(playerId);
}

// Serves a website file from /public (index.html, style.css, client.js...).
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  // Safety: refuse anything outside /public (e.g. "/../server/index.js")
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

// ============================================================
//  ROUTES: every address the server answers.
// ============================================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  // GET /healthz - quick "is the server up?" check
  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, { ok: true, players: game.players.size });
  }

  // POST /api/join - join with a name, or rejoin with a saved playerId
  if (req.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(req); // { name, playerId? }
    const name = String(body.name || "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return sendJson(res, 400, { ok: false, error: "Please enter a name" });

    // Known player: keep their cards and just update the name. New: create them.
    let player = body.playerId && game.players.get(body.playerId);
    if (player) player.name = name;
    else player = game.addPlayer(name);
    broadcast();
    return sendJson(res, 200, { ok: true, playerId: player.id });
  }

  // GET /api/events - a player's live-update connection, held open
  if (req.method === "GET" && url.pathname === "/api/events") {
    const playerId = url.searchParams.get("playerId");
    const player = game.players.get(playerId);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stop proxies holding updates back
    });
    // Unknown player (e.g. server restarted): tell the browser to start over
    if (!player) {
      res.write("event: reset\ndata: {}\n\n");
      return res.end();
    }

    // Remember this connection and mark the player online
    if (!streams.has(playerId)) streams.set(playerId, new Set());
    streams.get(playerId).add(res);
    player.connections++;
    broadcast();

    // Send a tiny message every 20 seconds so the connection isn't dropped as idle
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);

    // Tab closed or connection lost: clean up and mark offline if it was their last tab
    req.on("close", () => {
      clearInterval(ping);
      const set = streams.get(playerId);
      set.delete(res);
      if (set.size === 0) streams.delete(playerId);
      player.connections--;
      player.lastSeen = Date.now();
      broadcast();
    });
    return;
  }

  // POST /api/action - a player does something ({ playerId, type: "draw" | "endTurn" | "play" | "move", ...details })
  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(req);
    const result = game.act(body.playerId, String(body.type || ""), body); // body also carries details like uid, x, y
    if (result.ok) broadcast(); // only update screens if something changed
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  // Anything else: a website file
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

// Once a minute, remove players who have been offline too long.
setInterval(() => {
  const now = Date.now();
  let changed = false; // whether anyone was removed
  for (const p of game.players.values()) {
    if (p.connections === 0 && now - p.lastSeen > FORGET_OFFLINE_PLAYERS_AFTER_MS) {
      game.removePlayer(p.id);
      changed = true;
    }
  }
  if (changed) broadcast();
}, 60000).unref();

// Start the server
server.listen(PORT, () => console.log(`Ancient TCG running on http://localhost:${PORT}`));
