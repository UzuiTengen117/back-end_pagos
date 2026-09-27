const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');
const { emitirTokenQr } = require('../src/utils/qrToken');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign({ id, username: 'u', rol, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };

const ALUMNO_EN_GRADO = {
  id: 7,
  nombre: 'Ana',
  primer_apellido: 'Lopez',
  segundo_apellido: 'Ruiz',
  grado: '1er',
  sede: 'Progreso',
};

const SESION_ABIERTA = {
  id: 1,
  grado: '1er',
  sede: 'Progreso',
  fecha: '2026-09-26',
  profesor_id: 1,
  abierta: true,
};

test('GET /api/asistencias/mi-qr: estudiante recibe token y sus datos', async () => {
  await start();
  install([
    { match: 'WHERE a.usuario_id = $1', result: () => ({ rows: [{ ...ALUMNO_EN_GRADO, usuario_id: 7, username: 'ana', email: 'a@b.c', foto: null }] }) },
  ]);
  const res = await request('GET', '/api/asistencias/mi-qr', { token: token('estudiante', 7) });
  assert.equal(res.status, 200);
  assert.ok(res.data.token.startsWith('AMTKD1.'));
  assert.equal(res.data.alumno.nombre, 'Ana');
  assert.equal(res.data.alumno.primer_apellido, 'Lopez');
  assert.equal(res.data.alumno.segundo_apellido, 'Ruiz');
  assert.equal(res.data.alumno.username, 'ana');
  assert.equal(res.data.alumno.grado, '1er');
  assert.equal(res.data.alumno.sede, 'Progreso');
});

test('GET /api/asistencias/mi-qr: profesor no puede generar QR de alumno', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('GET', '/api/asistencias/mi-qr', { token: token('profesor', 1) });
  assert.equal(res.status, 403);
});

test('GET /api/asistencias/mis-asistencias: el scope filtra por el usuario del alumno', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM asistencias a', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/asistencias/mis-asistencias', { token: token('estudiante', 7) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('FROM asistencias a'));
  assert.match(call.text, /al\.usuario_id = \$1/);
  assert.deepEqual(call.params, [7]);
});

test('POST /api/asistencias/abrir-sesion: crea la sesion del grado y sede', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'abierta = TRUE', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO asistencia_sesiones', result: () => ({ rows: [SESION_ABIERTA] }) },
  ]);
  const res = await request('POST', '/api/asistencias/abrir-sesion', {
    token: token('profesor', 1),
    body: { grado: '1er', sede: 'Progreso' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.grado, '1er');
  const insert = calls.find((c) => c.text.includes('INSERT INTO asistencia_sesiones'));
  assert.deepEqual(insert.params, ['1er', 'Progreso', 1]);
});

test('POST /api/asistencias/abrir-sesion: reutiliza la sesion ya abierta', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'abierta = TRUE', result: () => ({ rows: [SESION_ABIERTA] }) },
  ]);
  const res = await request('POST', '/api/asistencias/abrir-sesion', {
    token: token('profesor', 1),
    body: { grado: '1er', sede: 'Progreso' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, 1);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO asistencia_sesiones')));
});

test('POST /api/asistencias/abrir-sesion: sede invalida → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('POST', '/api/asistencias/abrir-sesion', {
    token: token('profesor', 1),
    body: { grado: '1er', sede: 'Cancun' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/asistencias/registrar: QR valido registra asistencia', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [SESION_ABIERTA] }) },
    { match: 'FROM alumnos WHERE id = $1', result: () => ({ rows: [ALUMNO_EN_GRADO] }) },
    { match: 'INSERT INTO asistencias', result: () => ({ rows: [{ id: 50, sesion_id: 1, alumno_id: 7, metodo: 'qr' }] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: emitirTokenQr(7), sesion_id: 1 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.alumno.nombre, 'Ana');
  assert.equal(res.data.metodo, 'qr');
  assert.equal(res.data.duplicado, false);
});

test('POST /api/asistencias/registrar: QR expirado → 410', async () => {
  await start();
  install([PERMISOS_VACIO]);
  // El token se emite con una fecha en el pasado, asi ya expiro al validarlo.
  const vencido = emitirTokenQr(7, Date.now() - 10 * 60 * 1000);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: vencido, sesion_id: 1 },
  });
  assert.equal(res.status, 410);
  assert.equal(res.data.message, 'Qr expirado');
});

test('POST /api/asistencias/registrar: QR con firma manipulada → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const partes = emitirTokenQr(7).split('.');
  partes[1] = Buffer.from('99.99999999999999').toString('base64url');
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: partes.join('.'), sesion_id: 1 },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.message, 'Qr invalido');
});

test('POST /api/asistencias/registrar: no toca la BD si el QR es invalido', async () => {
  await start();
  const { calls } = install([PERMISOS_VACIO]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: 'basura', sesion_id: 1 },
  });
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO asistencias')));
});

test('POST /api/asistencias/registrar: alumno de otro grado → 400', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [SESION_ABIERTA] }) },
    { match: 'FROM alumnos WHERE id = $1', result: () => ({ rows: [{ ...ALUMNO_EN_GRADO, grado: '5to' }] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: emitirTokenQr(7), sesion_id: 1 },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /5to/);
});

test('POST /api/asistencias/registrar: sesion de otro profesor → 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    // La sesion pertenece al profesor 1, asi que el filtro por profesor_id
    // la deja fuera y el registro se rechaza.
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 2),
    body: { token: emitirTokenQr(7), sesion_id: 1 },
  });
  assert.equal(res.status, 404);
});

test('POST /api/asistencias/registrar: sesion cerrada → 409', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [{ ...SESION_ABIERTA, abierta: false }] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: emitirTokenQr(7), sesion_id: 1 },
  });
  assert.equal(res.status, 409);
});

test('POST /api/asistencias/registrar: duplicado → 409 con los datos del alumno', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [SESION_ABIERTA] }) },
    { match: 'FROM alumnos WHERE id = $1', result: () => ({ rows: [ALUMNO_EN_GRADO] }) },
    { match: 'INSERT INTO asistencias', result: () => ({ rows: [] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { token: emitirTokenQr(7), sesion_id: 1 },
  });
  assert.equal(res.status, 409);
  assert.equal(res.data.duplicado, true);
  assert.equal(res.data.alumno.nombre, 'Ana');
});

test('POST /api/asistencias/registrar: captura manual funciona sin QR', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2', result: () => ({ rows: [SESION_ABIERTA] }) },
    { match: 'FROM alumnos WHERE id = $1', result: () => ({ rows: [ALUMNO_EN_GRADO] }) },
    { match: 'INSERT INTO asistencias', result: () => ({ rows: [{ id: 51, metodo: 'manual' }] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 1),
    body: { alumno_id: 7, sesion_id: 1 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.metodo, 'manual');
  const insert = calls.find((c) => c.text.includes('INSERT INTO asistencias'));
  assert.deepEqual(insert.params, [1, 7, 1, 'manual']);
});

test('POST /api/asistencias/registrar: sin permiso de registrar → 403', async () => {
  await start();
  install([
    { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [{ modulo: 'pagos', accion: 'crear' }] }) },
  ]);
  const res = await request('POST', '/api/asistencias/registrar', {
    token: token('profesor', 9),
    body: { alumno_id: 7, sesion_id: 1 },
  });
  assert.equal(res.status, 403);
});

test('GET /api/asistencias/sesion/:id/alumnos: lista los alumnos del grado con su estado', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT * FROM asistencia_sesiones WHERE id = $1', result: () => ({ rows: [SESION_ABIERTA] }) },
    { match: 'LEFT JOIN asistencias asis', result: () => ({ rows: [{ ...ALUMNO_EN_GRADO, asistencia_id: null }] }) },
  ]);
  const res = await request('GET', '/api/asistencias/sesion/1/alumnos', { token: token('profesor', 1) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('LEFT JOIN asistencias asis'));
  // req.params llega como string; el grado y la sede vienen de la sesion.
  assert.deepEqual(call.params, ['1', '1er', 'Progreso']);
});

test('GET /api/asistencias/sesion/:id/alumnos: sesion inexistente → 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'SELECT * FROM asistencia_sesiones WHERE id = $1', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/asistencias/sesion/99/alumnos', { token: token('profesor', 1) });
  assert.equal(res.status, 404);
});

test('DELETE /api/asistencias/:id: elimina el registro de la sesion del profesor', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'DELETE FROM asistencias a', result: () => ({ rows: [{ id: 50 }] }) },
  ]);
  const res = await request('DELETE', '/api/asistencias/50', { token: token('profesor', 1) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('DELETE FROM asistencias a'));
  // El borrado debe ir acotado al profesor que hace la peticion.
  assert.match(call.text, /s\.profesor_id = \$2/);
  assert.deepEqual(call.params, ['50', 1]);
});

test('DELETE /api/asistencias/:id: no borra asistencias de otro profesor → 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    // El filtro por profesor deja la fila fuera, asi que no se borra nada.
    { match: 'DELETE FROM asistencias a', result: () => ({ rows: [] }) },
  ]);
  const res = await request('DELETE', '/api/asistencias/50', { token: token('profesor', 2) });
  assert.equal(res.status, 404);
});

test('el estudiante no puede abrir sesiones de clase', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('POST', '/api/asistencias/abrir-sesion', {
    token: token('estudiante', 7),
    body: { grado: '1er', sede: 'Progreso' },
  });
  assert.equal(res.status, 403);
});
