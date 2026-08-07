const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

test('pregunta-secreta: devuelve la pregunta de un usuario que la tiene configurada', async () => {
  await start();
  install([
    {
      match: 'SELECT pregunta_secreta FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ pregunta_secreta: '¿Nombre de tu primera mascota?' }] }),
    },
  ]);
  const res = await request('GET', '/api/usuarios/pregunta-secreta?username=test');
  assert.equal(res.status, 200);
  assert.equal(res.data.pregunta, '¿Nombre de tu primera mascota?');
});

test('pregunta-secreta: 404 si el usuario no existe o no tiene pregunta', async () => {
  await start();
  install([
    {
      match: 'SELECT pregunta_secreta FROM usuarios WHERE username = $1',
      result: () => ({ rows: [] }),
    },
  ]);
  const res = await request('GET', '/api/usuarios/pregunta-secreta?username=nadie');
  assert.equal(res.status, 404);
});

test('recuperar-contrasena: respuesta correcta restablece la contraseña', async () => {
  await start();
  const hash = await bcrypt.hash('mi respuesta', 4);
  const installed = install([
    {
      match: 'SELECT id, respuesta_secreta, locked_until FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ id: 1, respuesta_secreta: hash, locked_until: null }] }),
    },
    {
      match: 'token_version = token_version + 1, failed_attempts',
      result: () => ({ rows: [] }),
    },
  ]);
  const res = await request('POST', '/api/usuarios/recuperar-contrasena', {
    body: { username: 'test', respuesta: 'mi respuesta', newPassword: 'nueva123' },
  });
  assert.equal(res.status, 200);
  const update = installed.calls.find((c) => c.text.includes('token_version = token_version + 1'));
  assert.ok(update, 'debe ejecutar el UPDATE de contraseña');
  assert.notEqual(update.params[0], 'nueva123', 'la contraseña debe guardarse hasheada');
  assert.equal(update.params[1], 1);
});

test('recuperar-contrasena: respuesta incorrecta → 400', async () => {
  await start();
  const hash = await bcrypt.hash('mi respuesta', 4);
  install([
    {
      match: 'SELECT id, respuesta_secreta, locked_until FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ id: 1, respuesta_secreta: hash, locked_until: null }] }),
    },
  ]);
  const res = await request('POST', '/api/usuarios/recuperar-contrasena', {
    body: { username: 'test', respuesta: 'otra', newPassword: 'nueva123' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /incorrecta/i);
});

test('recuperar-contrasena: sin pregunta configurada → 400', async () => {
  await start();
  install([
    {
      match: 'SELECT id, respuesta_secreta, locked_until FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ id: 1, respuesta_secreta: null, locked_until: null }] }),
    },
  ]);
  const res = await request('POST', '/api/usuarios/recuperar-contrasena', {
    body: { username: 'test', respuesta: 'x', newPassword: 'nueva123' },
  });
  assert.equal(res.status, 400);
});

test('recuperar-contrasena: contraseña nueva muy corta → 400', async () => {
  await start();
  const res = await request('POST', '/api/usuarios/recuperar-contrasena', {
    body: { username: 'test', respuesta: 'x', newPassword: '123' },
  });
  assert.equal(res.status, 400);
});
