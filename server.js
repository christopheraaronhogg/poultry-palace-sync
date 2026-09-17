#!/usr/bin/env node
/**
 * Poultry Palace multiplayer sync — WebSocket chick position relay.
 * Path: /ws  Port: PORT env (default 8090)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8090;
const STATE_MIN_MS = 66; // ~15 Hz max inbound state

const COLORS = [
  '#f7d94a', '#f0b429', '#e8862a', '#7ec8e3', '#e07a9a',
  '#8bc34a', '#ce93d8', '#ffab91', '#80cbc4', '#fff59d',
];

let nextId = 1;
/** @type {Map<import('ws').WebSocket, Peer>} */
const clients = new Map();

/**
 * @typedef {{ id:number, name:string, color:string, x:number, y:number, z:number, ry:number, lastState:number }} Peer
 */

function peerPublic(p) {
  return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, ry: p.ry };
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
    res.end(JSON.stringify({ ok: true, peers: clients.size }));
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
  };
  clients.set(ws, peer);

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
      send(ws, { type: 'welcome', id: peer.id, peers });
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
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'leave', id: peer.id });
  });

  ws.on('error', () => {
    /* close handler cleans up */
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[poultry-palace-sync] listening on 127.0.0.1:${PORT} (ws path /ws)`);
});
