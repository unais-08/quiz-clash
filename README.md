# Quiz Clash

A real-time, 2–4 player quiz game. The Node server owns room membership, question selection, the 15-second timer, accepted answers, scoring, round transitions, and the final standings. Browsers connect to the same server over WebSockets, so a player action and question state are shared across devices.

## Run locally

Requires Node.js 22 or newer. There are no runtime dependencies.

```sh
npm start
```

Open <http://localhost:3000> in two or more browser windows/devices. Create a room in one, share its six-character code, and join from the others. The host can start once a second player arrives. `npm test` runs the game rule checks; `npm run check` checks JavaScript syntax.

## Deploy

The included `render.yaml` is a Render Blueprint for a single Node web service. Connect this repository to Render and create the Blueprint; Render supplies `PORT` and deploys the `npm start` process. The host must support WebSocket upgrades and run one server process/instance. Set the instance count to one; process memory is the live room store, so multiple instances do not share rooms. Rooms are ephemeral and expire after one hour after a completed match. An idle free service may sleep; players can reconnect after it wakes, but an in-progress match is lost if the process restarts.

This game is not suitable for static-only hosting or Netlify Functions: request-scoped functions cannot own the persistent WebSocket and authoritative room timers. A multi-instance deployment would need a shared pub/sub and durable room store (for example Redis) before enabling scaling.

No public deployment was made from this workspace. To publish, push the project to a Git repository and deploy the Render Blueprint; the assigned public URL can then be tested.

## Code layout

- `server.js` composes the HTTP server, game service, and WebSocket transport, and remains the application entry point.
- `src/game/questions.js` contains the shared question bank.
- `src/game/game-service.js` owns rooms, authoritative actions, scoring, timers, and game-state broadcasts.
- `src/network/http-server.js` serves the browser app and creates rooms over HTTP.
- `src/network/websocket-server.js` handles the WebSocket handshake and frames, then delegates messages and disconnects to the game service.
- `public/` contains the browser interface.

The separation keeps transport and static-file concerns out of the game rules while preserving the existing routes, WebSocket message shapes, and `server.js` entry point.
