const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');
const { JWT_SECRET } = require('../src/config/security');

after(() => stop());

test('JWT_SECRET no usa el fallback hardcodeado', () => {
  assert.notEqual(JWT_SECRET, 'fallback_secret');
  assert.ok(JWT_SECRET.length >= 32, 'el secreto debe ser largo');
});

test('token forjado con otro secreto → 401', async () => {
  await start();
  const forged = jwt.sign({ id: 1, username: 'admin', rol: 'admin', token_version: 0 }, 'secreto-desconocido', { expiresIn: '1h' });
  const res = await request('GET', '/api/usuarios', { token: forged });
  assert.equal(res.status, 401);
  assert.equal(res.data.message, 'Token inválido');
});

test('token válido con rol admin → 200', async () => {
  await start();
  install([
    { match: 'FROM usuarios', result: () => ({ rows: [] }) },
  ]);
  const valid = jwt.sign({ id: 1, username: 'admin', rol: 'admin', token_version: 0 }, JWT_SECRET, { expiresIn: '1h' });
  const res = await request('GET', '/api/usuarios', { token: valid });
  assert.equal(res.status, 200);
});
