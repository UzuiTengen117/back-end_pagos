const { test } = require('node:test');
const assert = require('node:assert/strict');

const { emitirTokenQr, verificarTokenQr, VIGENCIA_MS } = require('../src/utils/qrToken');

test('emitirTokenQr: emite un token que se puede verificar', () => {
  const token = emitirTokenQr(7);
  const resultado = verificarTokenQr(token);
  assert.equal(resultado.alumnoId, 7);
});

test('emitirTokenQr: la vigencia por defecto es de 60 segundos', () => {
  const ahora = 1_000_000_000_000;
  const token = emitirTokenQr(7, ahora);
  assert.equal(verificarTokenQr(token, ahora).expira, ahora + VIGENCIA_MS);
});

test('emitirTokenQr: el token lleva el id codificado, no datos personales', () => {
  const token = emitirTokenQr(7);
  const partes = token.split('.');
  assert.equal(partes[0], 'AMTKD1');
  // Solo id y expiracion viajan en el payload: ningun dato personal.
  const payload = Buffer.from(partes[1], 'base64url').toString('utf8');
  assert.match(payload, /^7\.\d+$/);
  assert.equal(payload.split('.').length, 2);
});

test('verificarTokenQr: rechaza un token expirado', () => {
  const ahora = 1_000_000_000_000;
  const token = emitirTokenQr(7, ahora);
  assert.throws(() => verificarTokenQr(token, ahora + VIGENCIA_MS + 1), /Qr expirado/);
});

test('verificarTokenQr: acepta el token justo antes de expirar', () => {
  const ahora = 1_000_000_000_000;
  const token = emitirTokenQr(7, ahora);
  assert.equal(verificarTokenQr(token, ahora + VIGENCIA_MS).alumnoId, 7);
});

test('verificarTokenQr: rechaza un token con la firma alterada', () => {
  const token = emitirTokenQr(7);
  const partes = token.split('.');
  partes[2] = Buffer.from('firma-falsa-cualquiera').toString('base64url');
  assert.throws(() => verificarTokenQr(`${partes[0]}.${partes[1]}.${partes[2]}`), /Qr invalido/);
});

test('verificarTokenQr: rechazar un token de otro alumno evita la suplantacion', () => {
  // Un alumno no puede cambiar el id del payload sin invalidar la firma.
  const token = emitirTokenQr(7);
  const partes = token.split('.');
  const payloadAlterado = Buffer.from('99.9999999999999').toString('base64url');
  assert.throws(() => verificarTokenQr(`${partes[0]}.${payloadAlterado}.${partes[2]}`), /Qr invalido/);
});

test('verificarTokenQr: rechaza entradas mal formadas', () => {
  for (const malo of ['', null, undefined, 'abc', 'AMTKD1.abc', 'OTRO.a.b.c', 123]) {
    assert.throws(() => verificarTokenQr(malo), /Qr invalido/, `debio rechazar: ${malo}`);
  }
});
