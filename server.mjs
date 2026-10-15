import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const database = new DatabaseSync(join(dataDir, 'controle-financeiro.sqlite'));
const port = Number(process.env.PORT || 3000);
const collections = new Set(['config', 'lancamentos', 'contas', 'vacas']);

database.exec(`
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  )
`);

function send(response, status, payload, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}

function servePage(response) {
  const filename = join(root, 'Index.html');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  createReadStream(filename).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/' && request.method === 'GET') return servePage(response);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    return send(response, 404, { error: 'Not found' });
  }

  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const [collection, id] = parts;
  if (!collections.has(collection) || parts.length > 2) {
    return send(response, 404, { error: 'Unknown collection' });
  }

  try {
    if (request.method === 'GET' && !id) {
      const rows = database.prepare('SELECT id, data FROM records WHERE collection = ?').all(collection);
      return send(response, 200, rows.map(row => ({ id: row.id, ...JSON.parse(row.data) })));
    }
    if (request.method === 'POST' && !id) {
      const record = await readBody(request);
      const newId = randomUUID();
      database.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?)').run(collection, newId, JSON.stringify(record));
      return send(response, 201, { id: newId });
    }
    if (request.method === 'PUT' && id) {
      const record = await readBody(request);
      database.prepare('INSERT INTO records (collection, id, data) VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data').run(collection, id, JSON.stringify(record));
      return send(response, 200, { id });
    }
    if (request.method === 'DELETE' && id) {
      database.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, id);
      return send(response, 204, '');
    }
    return send(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    const status = error.message === 'Request body too large' ? 413 : 400;
    return send(response, status, { error: 'Invalid request' });
  }
});

server.listen(port, '0.0.0.0', () => {
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  const codespace = process.env.CODESPACE_NAME;
  const url = domain && codespace
    ? `https://${codespace}-${port}.${domain}`
    : `http://localhost:${port}`;
  console.log(`Controle Financeiro disponível em ${url}`);
});
