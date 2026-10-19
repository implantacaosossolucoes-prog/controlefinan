import 'dotenv/config';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import apiHandler from './api/index.js';
import devApiHandler from './dev-api.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const demoMode = process.argv.includes('--demo');

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    void (demoMode ? devApiHandler : apiHandler)(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/site.webmanifest') {
    response.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    createReadStream(`${root}site.webmanifest`).pipe(response);
    return;
  }
  if (request.method === 'GET' && ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'].includes(pathname)) {
    const icon = pathname.slice(1);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    createReadStream(`${root}${icon}`).pipe(response);
    return;
  }
  if (request.method === 'GET' && pathname === '/logo.png') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    createReadStream(`${root}logo.png`).pipe(response);
    return;
  }
  if (request.method !== 'GET' || !['/', '/index.html'].includes(pathname)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  createReadStream(`${root}index.html`).pipe(response);
});

server.listen(port, '0.0.0.0', () => {
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  const codespace = process.env.CODESPACE_NAME;
  const url = domain && codespace
    ? `https://${codespace}-${port}.${domain}`
    : `http://localhost:${port}`;
  console.log(`Controle Financeiro${demoMode ? ' (modo de demonstração)' : ''} disponível em ${url}`);
  if (demoMode) console.log(`Login local: gabriel ou alipio; senha: ${process.env.LOCAL_DEMO_PASSWORD || 'teste123'}`);
});
