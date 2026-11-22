// The web server. Serves the website from /public and keeps every
// player's screen up to date with live updates (Server-Sent Events).
// No packages needed: it uses only what comes with Node.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Game } = require("./engine");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MAX_NAME_LENGTH = 20;
const FORGET_OFFLINE_PLAYERS_AFTER_MS = 30 * 60 * 1000; // 30 minutes

const game = new Game();
const streams = new Map(); // playerId -> Set of open responses

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
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

function pushTo(playerId) {
  const view = game.viewFor(playerId);
  for (const res of streams.get(playerId) || []) {
    res.write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
  }
}

function broadcast() {
  for (const playerId of streams.keys()) pushTo(playerId);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJson(res, 200, { ok: true, players: game.players.size });
  }

  // Join (or rejoin) the game with a name.
  if (req.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(req);
    const name = String(body.name || "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return sendJson(res, 400, { ok: false, error: "Please enter a name" });

    let player = body.playerId && game.players.get(body.playerId);
    if (player) player.name = name;
    else player = game.addPlayer(name);
    broadcast();
    return sendJson(res, 200, { ok: true, playerId: player.id });
  }

  // Live updates for one player.
  if (req.method === "GET" && url.pathname === "/api/events") {
    const playerId = url.searchParams.get("playerId");
    const player = game.players.get(playerId);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (!player) {
      res.write("event: reset\ndata: {}\n\n");
      return res.end();
    }

    if (!streams.has(playerId)) streams.set(playerId, new Set());
    streams.get(playerId).add(res);
    player.connections++;
    broadcast();

    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
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

  // A player does something (draw, endTurn...).
  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readJson(req);
    const result = game.act(body.playerId, String(body.type || ""));
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

// Forget players who have been gone a long time.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const p of game.players.values()) {
    if (p.connections === 0 && now - p.lastSeen > FORGET_OFFLINE_PLAYERS_AFTER_MS) {
      game.removePlayer(p.id);
      changed = true;
    }
  }
  if (changed) broadcast();
}, 60000).unref();

server.listen(PORT, () => console.log(`Ancient TCG running on http://localhost:${PORT}`));
