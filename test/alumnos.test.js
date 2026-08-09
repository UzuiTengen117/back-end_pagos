const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign({ id, username: 'u', rol, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };
const USUARIO_EXISTE = { match: 'SELECT id FROM usuarios WHERE id = $1', result: () => ({ rows: [{ id: 5 }] }) };

const BODY_VALIDO = {
  nombre: 'A',
  primer_apellido: 'B',
  usuario_id: 5,
  email: 'a@b.com',
  grado: '1',
  sede: 'Progreso',
};

test('crear alumno sin sede → 400', async () => {
  await start();
  install([PERMISOS_VACIO, USUARIO_EXISTE, { match: 'INSERT INTO alumnos', result: () => ({ rows: [] }) }]);
  const { sede, ...sinSede } = BODY_VALIDO;
  const res = await request('POST', '/api/alumnos', {
    token: token('profesor'),
    body: sinSede,
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /sede/i);
});

test('crear alumno con sede inválida → 400', async () => {
  await start();
  install([PERMISOS_VACIO, USUARIO_EXISTE, { match: 'INSERT INTO alumnos', result: () => ({ rows: [] }) }]);
  const res = await request('POST', '/api/alumnos', {
    token: token('profesor'),
    body: { ...BODY_VALIDO, sede: 'Coyoacan' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /sede/i);
});

test('crear alumno con sede válida → 201 e INSERT incluye sede', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    USUARIO_EXISTE,
    { match: 'INSERT INTO alumnos', result: () => ({ rows: [{ id: 1, ...BODY_VALIDO }] }) },
  ]);
  const res = await request('POST', '/api/alumnos', {
    token: token('profesor'),
    body: { ...BODY_VALIDO, sede: 'Morelos' },
  });
  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO alumnos'));
  assert.ok(insert.text.includes('sede'), 'el INSERT debe incluir la columna sede');
  assert.ok(insert.params.includes('Morelos'), 'el valor de sede debe viajar parametrizado');
});

test('editar alumno con sede inválida → 400', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'UPDATE alumnos', result: () => ({ rows: [] }) }]);
  const res = await request('PUT', '/api/alumnos/editar/1', {
    token: token('profesor'),
    body: { ...BODY_VALIDO, sede: 'Inexistente' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /sede/i);
});

test('editar alumno con sede válida → 200 y UPDATE incluye sede', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'UPDATE alumnos', result: () => ({ rows: [{ id: 1, ...BODY_VALIDO }] }) },
  ]);
  const res = await request('PUT', '/api/alumnos/editar/1', {
    token: token('profesor'),
    body: { ...BODY_VALIDO, sede: 'Morelos' },
  });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('UPDATE alumnos'));
  assert.ok(update.text.includes('sede = $9'), 'el UPDATE debe incluir la columna sede');
  assert.ok(update.params.includes('Morelos'), 'el valor de sede debe viajar parametrizado');
});
