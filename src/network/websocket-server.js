import { createHash } from 'node:crypto';

function sendError(client, message) {
  client.send(JSON.stringify({ type: 'error', message }));
}

function acceptWebSocket(req, socket, { onMessage, onDisconnect }) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const client = {
    socket,
    open: true,
    playerId: null,
    room: null,
    send(text) {
      if (!this.open) return;
      const data = Buffer.from(text);
      let header;
      if (data.length < 126) {
        header = Buffer.from([0x81, data.length]);
      } else if (data.length < 65_536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(data.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(data.length), 2);
      }
      socket.write(Buffer.concat([header, data]));
    }
  };

  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const shortLength = buffer[1] & 0x7f;
      const masked = Boolean(buffer[1] & 0x80);
      let length = shortLength;
      let offset = 2;

      if (shortLength === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (shortLength === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (masked) offset += 4;
      if (buffer.length < offset + length) return;

      let payload = buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = buffer.subarray(offset - 4, offset);
        payload = Buffer.from(payload);
        for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
      }
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) {
        client.open = false;
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0]));
        continue;
      }

      try {
        onMessage(client, JSON.parse(payload.toString()));
      } catch {
        sendError(client, 'Something went wrong. Please reconnect.');
      }
    }
  });

  socket.on('close', () => {
    client.open = false;
    onDisconnect(client);
  });
  socket.on('error', () => { });
}

export function attachWebSocketServer(server, callbacks) {
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') return socket.destroy();
    acceptWebSocket(req, socket, callbacks);
  });
}
