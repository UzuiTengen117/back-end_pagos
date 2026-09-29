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

// Para lo que `request` no cubre: subidas multipart y respuestas binarias.
// Es una funcion aparte y no un parametro extra en `request` a proposito: cambiar
// la forma de `request` obliga a revisar los ~200 tests que ya la usan.
//
// Con `form` NO se pone Content-Type a mano. Si se pusiera, el boundary que
// genera fetch se pierde, el servidor no encuentra el final del cuerpo y multer
// se queda sin archivo, tirando un 400 que parece del validador de formato y no
// del transporte.
async function requestRaw(method, path, { token, form } = {}) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: form,
  });
  return {
    status: res.status,
    headers: res.headers,
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

module.exports = { start, request, requestRaw, stop };
