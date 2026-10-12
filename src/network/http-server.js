import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createHttpServer({ publicDir, onCreateRoom }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let name;
      try {
        name = JSON.parse(body).name;
      } catch { }
      if (!String(name || '').trim()) {
        return respond(res, 400, { error: 'Enter a name to create a room.' });
      }
      return respond(res, 201, { code: onCreateRoom() });
    }

    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    if (file.includes('..')) return respond(res, 400, { error: 'Invalid path.' });

    try {
      const contents = await readFile(path.join(publicDir, file));
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(contents);
    } catch {
      respond(res, 404, { error: 'Not found.' });
    }
  });
}
