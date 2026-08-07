const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');
const ALLOWED_INTERPOLATIONS = ['SELECT_PAGOS', 'SELECT_COMPROBANTES', 'USUARIO_FIELDS', 'where'];

function extractTemplateQueries(fileContent) {
  const queries = [];
  let fromIndex = 0;
  while (true) {
    const i = fileContent.indexOf('pool.query', fromIndex);
    if (i === -1) break;
    const open = fileContent.indexOf('(', i);
    const chunk = fileContent.slice(open + 1);
    const match = chunk.match(/^\s*`/);
    if (match) {
      const end = chunk.indexOf('`', 1);
      if (end !== -1) {
        queries.push(chunk.slice(1, end));
      }
    }
    fromIndex = i + 10;
  }
  return queries;
}

test('SQLi estático: ninguna consulta interpola datos del request', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'debe existir al menos un archivo de rutas');

  for (const file of files) {
    const content = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const queries = extractTemplateQueries(content);

    for (const query of queries) {
      const interpolations = [...query.matchAll(/\$\{([^}]*)\}/g)];
      for (const match of interpolations) {
        const expr = match[1].trim();
        assert.ok(
          ALLOWED_INTERPOLATIONS.includes(expr),
          `${file}: interpolación no permitida en SQL: \${${expr}}`
        );
        assert.ok(
          !/req\.|\b(body|params|query|user|headers)\b/i.test(expr),
          `${file}: se interpola datos del request en SQL: \${${expr}}`
        );
      }
    }
  }
});

test('SQLi en /login: el payload viaja como parámetro, no como SQL', async () => {
  await start();
  const { calls } = install([
    {
      match: 'FROM usuarios WHERE username = $1',
      result: () => ({ rows: [] }),
    },
  ]);

  const payload = "' OR 1=1--";
  const res = await request('POST', '/api/usuarios/login', {
    body: { username: payload, password: 'x' },
  });

  assert.equal(res.status, 401);
  const loginCall = calls.find((c) => c.text.includes('FROM usuarios WHERE username'));
  assert.ok(loginCall, 'debe haberse ejecutado la búsqueda de usuario');
  assert.equal(loginCall.text, 'SELECT * FROM usuarios WHERE username = $1');
  assert.deepEqual(loginCall.params, [payload]);
});

test('SQLi en /editar: payload malicioso en campos viaja parametrizado', async () => {
  await start();
  const { calls } = install([
    {
      match: 'UPDATE usuarios SET nombre',
      result: () => ({ rows: [{ id: 1 }] }),
    },
  ]);

  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { id: 1, username: 'admin', rol: 'admin', token_version: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const payload = "'; DROP TABLE usuarios;--";
  const res = await request('PUT', '/api/usuarios/editar/1', {
    token,
    body: {
      nombre: payload,
      primer_apellido: 'x',
      segundo_apellido: '',
      username: 'admin',
      email: 'a@a.com',
      rol: 'admin',
    },
  });

  assert.equal(res.status, 200);
  const updateCall = calls.find((c) => c.text.includes('UPDATE usuarios SET nombre'));
  assert.ok(updateCall, 'debe haberse ejecutado el UPDATE');
  assert.ok(!updateCall.text.includes(payload), 'el payload no debe concatenarse en el SQL');
  assert.ok(updateCall.params.includes(payload), 'el payload debe ir en los parámetros');
  assert.match(updateCall.text, /\$1/);
});
