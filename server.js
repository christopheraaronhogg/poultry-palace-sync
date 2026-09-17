#!/usr/bin/env node
/**
 * Poultry Palace multiplayer sync — WebSocket chick + shared room relay.
 * Path: /ws  Port: PORT env (default 8090)
 *
 * Room (host authority): dayT, doors, hens. Host = lowest connected peer id.
 * Acts (any client): door toggles, skipDay — server applies and broadcasts.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8090;
const STATE_MIN_MS = 66; // ~15 Hz max inbound chick state
const ROOM_MIN_MS = 100; // ~10 Hz max inbound room from host

const COLORS = [
  '#f7d94a', '#f0b429', '#e8862a', '#7ec8e3', '#e07a9a',
  '#8bc34a', '#ce93d8', '#ffab91', '#80cbc4', '#fff59d',
];

const DOOR_KEYS = new Set(['people', 'gate', 'partition', 'pop']);

let nextId = 1;
/** @type {Map<import('ws').WebSocket, Peer>} */
const clients = new Map();

/** Shared world state (single room). */
const room = {
  dayT: 0.36,
  doors: { people: 0, gate: 0, partition: 0, pop: 1 },
  hens: [],
  hostId: null,
};

/**
 * @typedef {{ id:number, name:string, color:string, x:number, y:number, z:number, ry:number, lastState:number, lastRoom:number }} Peer
 */

function peerPublic(p) {
  return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, ry: p.ry };
}

function roomPublic() {
  return {
    dayT: room.dayT,
    doors: { ...room.doors },
    hens: room.hens,
    hostId: room.hostId,
  };
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(obj, exceptWs) {
  const raw = JSON.stringify(obj);
  for (const [ws] of clients) {
    if (ws === exceptWs) continue;
    if (ws.readyState === 1) ws.send(raw);
  }
}

function broadcastAll(obj) {
  const raw = JSON.stringify(obj);
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

/** Lowest connected peer id becomes host. */
function electHost() {
  let lowest = null;
  for (const [, p] of clients) {
    if (lowest == null || p.id < lowest) lowest = p.id;
  }
  const prev = room.hostId;
  room.hostId = lowest;
  if (prev !== room.hostId) {
    broadcastAll({ type: 'host', hostId: room.hostId, room: roomPublic() });
  }
  return room.hostId;
}

function clamp01(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function skipDayT(t) {
  const s = Math.sin(t * Math.PI * 2 - Math.PI / 2);
  return s > -0.1 ? 0.80 : 0.30;
}

function sanitizeHens(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const h of raw.slice(0, 16)) {
    if (!h || typeof h !== 'object') continue;
    const i = Number(h.i);
    const x = Number(h.x), y = Number(h.y), z = Number(h.z), ry = Number(h.ry);
    if (![i, x, y, z, ry].every(Number.isFinite)) continue;
    out.push({
      i: Math.max(0, Math.min(15, i | 0)),
      x, y, z, ry,
      alive: h.alive !== false,
    });
  }
  return out;
}

function applyDoorsPartial(doors) {
  if (!doors || typeof doors !== 'object') return;
  for (const k of DOOR_KEYS) {
    if (k in doors) room.doors[k] = clamp01(doors[k]);
  }
}

const indexPath = path.join(__dirname, 'index.html');
let indexHtml = '<!DOCTYPE html><html><body>Poultry Palace Sync OK</body></html>';
try {
  indexHtml = fs.readFileSync(indexPath, 'utf8');
} catch (_) { /* use fallback */ }

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/index')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
    return;
  }
  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      peers: clients.size,
      hostId: room.hostId,
      dayT: room.dayT,
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const id = nextId++;
  /** @type {Peer} */
  const peer = {
    id,
    name: `Chick ${id}`,
    color: COLORS[(id - 1) % COLORS.length],
    x: 0, y: 0, z: 0, ry: 0,
    lastState: 0,
    lastRoom: 0,
  };
  clients.set(ws, peer);
  electHost();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        peer.name = msg.name.trim().slice(0, 32);
      }
      if (typeof msg.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(msg.color)) {
        peer.color = msg.color;
      }
      const peers = [];
      for (const [otherWs, p] of clients) {
        if (otherWs !== ws) peers.push(peerPublic(p));
      }
      send(ws, {
        type: 'welcome',
        id: peer.id,
        peers,
        hostId: room.hostId,
        room: roomPublic(),
      });
      broadcast({ type: 'peer', ...peerPublic(peer) }, ws);
      return;
    }

    if (msg.type === 'state') {
      const now = Date.now();
      if (now - peer.lastState < STATE_MIN_MS) return;
      peer.lastState = now;
      const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z), ry = Number(msg.ry);
      if (![x, y, z, ry].every(Number.isFinite)) return;
      peer.x = x;
      peer.y = y;
      peer.z = z;
      peer.ry = ry;
      broadcast({ type: 'peer', ...peerPublic(peer) }, ws);
      return;
    }

    // Host pushes shared world snapshot
    if (msg.type === 'room') {
      if (peer.id !== room.hostId) return;
      const now = Date.now();
      if (now - peer.lastRoom < ROOM_MIN_MS) return;
      peer.lastRoom = now;
      if (typeof msg.dayT === 'number' && Number.isFinite(msg.dayT)) {
        room.dayT = ((msg.dayT % 1) + 1) % 1;
      }
      applyDoorsPartial(msg.doors);
      const hens = sanitizeHens(msg.hens);
      if (hens) room.hens = hens;
      broadcast({ type: 'room', ...roomPublic() }, ws);
      return;
    }

    // Any client may request door toggle or day skip
    if (msg.type === 'act') {
      const act = msg.act;
      if (act === 'door') {
        const key = msg.key;
        // Manual doors only; pop is host-driven from day cycle
        if (key !== 'people' && key !== 'gate' && key !== 'partition') return;
        const open = msg.open === 1 || msg.open === true ? 1 : 0;
        room.doors[key] = open;
        const payload = {
          type: 'act',
          act: 'door',
          key,
          open,
          from: peer.id,
          room: roomPublic(),
        };
        broadcastAll(payload);
        broadcastAll({ type: 'room', ...roomPublic() });
        return;
      }
      if (act === 'skipDay') {
        room.dayT = skipDayT(room.dayT);
        broadcastAll({
          type: 'act',
          act: 'skipDay',
          dayT: room.dayT,
          from: peer.id,
          room: roomPublic(),
        });
        broadcastAll({ type: 'room', ...roomPublic() });
        return;
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'leave', id: peer.id });
    electHost();
  });

  ws.on('error', () => {
    /* close handler cleans up */
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[poultry-palace-sync] listening on 127.0.0.1:${PORT} (ws path /ws)`);
});
