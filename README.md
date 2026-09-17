# Poultry Palace Sync

WebSocket multiplayer sync for [Poultry Palace](https://poultry-palace-game.netlify.app).

- **Chick presence** — join / state / peer / leave
- **Shared room** (host authority = lowest peer id) — `dayT`, doors, hens
- **Acts** (any client) — door toggle, skipDay

## Protocol

```
-> { type:'join', name, color }
<- { type:'welcome', id, peers, hostId, room }
-> { type:'state', x, y, z, ry }          # ~12 Hz
-> { type:'room', dayT, doors, hens }     # host, ~6–10 Hz
-> { type:'act', act:'door', key:'people'|'gate'|'partition', open:0|1 }
-> { type:'act', act:'skipDay' }
<- { type:'peer' | 'leave' | 'host' | 'room' | 'act' }
```

Room shape: `{ dayT, doors:{ people, gate, partition, pop }, hens:[{ i,x,y,z,ry,alive }], hostId }`

## Run

```bash
npm install
PORT=8090 npm start
# WS at ws://127.0.0.1:8090/ws
```

Production: `wss://poultry-palace-sync.on-forge.com/ws`
