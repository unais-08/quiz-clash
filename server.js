import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  cleanupExpiredRooms,
  createRoom,
  disconnectClient,
  receiveMessage
} from './src/game/game-service.js';
import { createHttpServer } from './src/network/http-server.js';
import { attachWebSocketServer } from './src/network/websocket-server.js';

export { QUESTIONS } from './src/game/questions.js';
export { scoreAnswer } from './src/game/game-service.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

export const server = createHttpServer({
  publicDir: path.join(projectRoot, 'public'),
  onCreateRoom: createRoom
});

attachWebSocketServer(server, {
  onMessage: receiveMessage,
  onDisconnect: disconnectClient
});

const roomCleanup = setInterval(cleanupExpiredRooms, 60_000);
roomCleanup.unref?.();

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (existsSync(path.join(projectRoot, 'public', 'index.html')) && isMainModule) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Quiz Clash ready on port ${port}`);
  });
}
