process.env.VERCEL = '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-no-fallback-0123456789abcdef';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';

const app = require('../../src/index');

let server = null;

async function start() {
  if (server) return server;
  server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  return server;
}

function baseUrl() {
  if (!server) throw new Error('Llamar a start() primero');
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  return { status: res.status, data };
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { start, request, stop };
