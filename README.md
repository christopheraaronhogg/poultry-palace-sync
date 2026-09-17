# Poultry Palace Sync

Lightweight WebSocket relay so multiple browser clients can see each other's chicks in [Poultry Palace](https://github.com/christopheraaronhogg/poultry-palace).

## Protocol (JSON over WebSocket)

Connect to `wss://poultry-palace-sync.on-forge.com/ws` (or `ws://127.0.0.1:8090/ws` locally).

| Direction | Message |
|-----------|---------|
| Client → server | `{ "type": "join", "name"?: string, "color"?: "#rrggbb" }` |
| Server → client | `{ "type": "welcome", "id": number, "peers": [{ id, name, color, x, y, z, ry }] }` |
| Client → server | `{ "type": "state", "x", "y", "z", "ry" }` (~10–15 Hz; server throttles) |
| Server → others | `{ "type": "peer", "id", "name", "color", "x", "y", "z", "ry" }` |
| Server → others | `{ "type": "leave", "id" }` |

## Local run

```bash
npm install
PORT=8090 npm start
# health: http://127.0.0.1:8090/
# ws:     ws://127.0.0.1:8090/ws
```

## Forge deploy

- Site: `poultry-palace-sync.on-forge.com` (PHP/static root serves `index.html`)
- Nginx proxies `/ws` → `http://127.0.0.1:8090`
- Supervisor daemon: `PORT=8090 node server.js` as user `forge` in the site root

## How it works

1. Client opens WebSocket and sends `join`.
2. Server assigns an id, replies with `welcome` + current peers, and tells others about the new peer.
3. Client sends `state` with position/yaw; server broadcasts `peer` updates to everyone else.
4. On disconnect, server broadcasts `leave`.

No persistence, rooms, or auth — a cozy backyard playground sync.
