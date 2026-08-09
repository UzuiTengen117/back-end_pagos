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

const SOLICITUD = {
  id: 1,
  alumno_id: 7,
  pago_id: 3,
  comprobante_id: 9,
  monto: 800,
  motivo: 'Pago duplicado',
  estado: 'pendiente',
};

test('GET /api/reembolsos: profesor con permiso por defecto ve la lista completa', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [SOLICITUD] }) },
  ]);
  const res = await request('GET', '/api/reembolsos', { token: token('profesor') });
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 1);
  const call = calls.find((c) => c.text.includes('FROM solicitudes_reembolso s'));
  assert.ok(call);
  assert.ok(!call.text.includes('usuario_id'), 'profesor no debe filtrar por usuario');
});

test('GET /api/reembolsos: estudiante solo ve las suyas', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/reembolsos', { token: token('estudiante', 7) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('FROM solicitudes_reembolso s'));
  assert.match(call.text, /WHERE a\.usuario_id = \$1/);
  assert.deepEqual(call.params, [7]);
});

test('GET /api/reembolsos: sin permiso de ver → 403', async () => {
  await start();
  install([
    { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [{ modulo: 'pagos', accion: 'crear' }] }) },
  ]);
  const res = await request('GET', '/api/reembolsos', { token: token('profesor', 9) });
  assert.equal(res.status, 403);
});

test('GET /api/reembolsos/pendientes filtra por estado pendiente', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [SOLICITUD] }) },
  ]);
  const res = await request('GET', '/api/reembolsos/pendientes', { token: token('profesor') });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('FROM solicitudes_reembolso s'));
  assert.match(call.text, /s\.estado = \$1/);
  assert.deepEqual(call.params, ['pendiente']);
});

test('GET /api/reembolsos/historial solo trae aprobadas y rechazadas', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/reembolsos/historial', { token: token('profesor') });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('FROM solicitudes_reembolso s'));
  assert.match(call.text, /s\.estado IN \(\$1, \$2\)/);
  assert.deepEqual(call.params, ['aprobada', 'rechazada']);
});

test('GET /api/reembolsos/:id devuelve la solicitud o 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [SOLICITUD] }) },
  ]);
  const found = await request('GET', '/api/reembolsos/1', { token: token('profesor') });
  assert.equal(found.status, 200);
  assert.equal(found.data.motivo, 'Pago duplicado');

  install([
    PERMISOS_VACIO,
    { match: 'FROM solicitudes_reembolso s', result: () => ({ rows: [] }) },
  ]);
  const notFound = await request('GET', '/api/reembolsos/999', { token: token('profesor') });
  assert.equal(notFound.status, 404);
});

test('POST /api/reembolsos: estudiante solicita sobre su propio comprobante reciente → 201', async () => {
  await start();
  const creado = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { calls } = install([
    {
      match: 'FROM comprobantes WHERE id = $1',
      result: () => ({ rows: [{ id: 9, alumno_id: 7, pago_id: 3, monto: 800, created_at: creado }] }),
    },
    { match: 'SELECT id FROM alumnos WHERE id = $1 AND usuario_id = $2', result: () => ({ rows: [{ id: 7 }] }) },
    { match: 'SELECT id FROM solicitudes_reembolso WHERE comprobante_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO solicitudes_reembolso', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('POST', '/api/reembolsos', {
    token: token('estudiante', 7),
    body: { comprobante_id: 9, motivo: 'Pago duplicado' },
  });
  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO solicitudes_reembolso'));
  assert.ok(insert);
  assert.equal(insert.params[0], 7, 'alumno_id');
  assert.equal(insert.params[1], 3, 'pago_id por defecto');
  assert.equal(insert.params[3], 800, 'monto por defecto desde comprobante');
});

test('POST /api/reembolsos: estudiante no puede pedir reembolso de un comprobante ajeno → 403', async () => {
  await start();
  install([
    {
      match: 'FROM comprobantes WHERE id = $1',
      result: () => ({ rows: [{ id: 9, alumno_id: 99, pago_id: null, monto: 800, created_at: new Date().toISOString() }] }),
    },
    { match: 'SELECT id FROM alumnos WHERE id = $1 AND usuario_id = $2', result: () => ({ rows: [] }) },
  ]);
  const res = await request('POST', '/api/reembolsos', {
    token: token('estudiante', 7),
    body: { comprobante_id: 9, motivo: 'Pago duplicado' },
  });
  assert.equal(res.status, 403);
});

test('POST /api/reembolsos: después de 7 días → 400', async () => {
  await start();
  const viejo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  install([
    {
      match: 'FROM comprobantes WHERE id = $1',
      result: () => ({ rows: [{ id: 9, alumno_id: 7, pago_id: null, monto: 800, created_at: viejo }] }),
    },
    { match: 'SELECT id FROM alumnos WHERE id = $1 AND usuario_id = $2', result: () => ({ rows: [{ id: 7 }] }) },
  ]);
  const res = await request('POST', '/api/reembolsos', {
    token: token('estudiante', 7),
    body: { comprobante_id: 9, motivo: 'Pago duplicado' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /7 días/);
});

test('POST /api/reembolsos: comprobante con solicitud previa → 400', async () => {
  await start();
  const { calls } = install([
    {
      match: 'FROM comprobantes WHERE id = $1',
      result: () => ({ rows: [{ id: 9, alumno_id: 7, pago_id: null, monto: 800, created_at: new Date().toISOString() }] }),
    },
    { match: 'SELECT id FROM alumnos WHERE id = $1 AND usuario_id = $2', result: () => ({ rows: [{ id: 7 }] }) },
    { match: 'SELECT id FROM solicitudes_reembolso WHERE comprobante_id = $1', result: () => ({ rows: [{ id: 5 }] }) },
  ]);
  const res = await request('POST', '/api/reembolsos', {
    token: token('estudiante', 7),
    body: { comprobante_id: 9, motivo: 'Pago duplicado' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /ya tiene una solicitud/);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO solicitudes_reembolso')), 'no debe insertar');
});

test('POST /api/reembolsos: sin motivo → 400', async () => {
  await start();
  install();
  const res = await request('POST', '/api/reembolsos', {
    token: token('estudiante', 7),
    body: { comprobante_id: 9 },
  });
  assert.equal(res.status, 400);
});

test('PUT /api/reembolsos/editar/:id: profesor sin permiso → 403; admin → 200', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const noPermiso = await request('PUT', '/api/reembolsos/editar/1', {
    token: token('profesor'),
    body: { motivo: 'Nuevo motivo' },
  });
  assert.equal(noPermiso.status, 403);

  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'UPDATE solicitudes_reembolso', result: () => ({ rows: [{ id: 1, motivo: 'Nuevo motivo' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/editar/1', {
    token: token('admin'),
    body: { motivo: 'Nuevo motivo', monto: 500 },
  });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('UPDATE solicitudes_reembolso'));
  assert.equal(update.params[0], 'Nuevo motivo');
  assert.equal(update.params[1], 500);
});

test('PUT /api/reembolsos/:id/aprobar: profesor con permiso por defecto aprueba pendiente → 200', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SET estado = \'aprobada\'', result: () => ({ rows: [{ id: 1, estado: 'aprobada' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/1/aprobar', { token: token('profesor') });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('SET estado'));
  assert.match(update.text, /AND estado = 'pendiente'/);
  assert.equal(update.params[1], '1');
});

test('PUT /api/reembolsos/:id/aprobar: estudiante no puede aprobar → 403', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('PUT', '/api/reembolsos/1/aprobar', { token: token('estudiante', 7) });
  assert.equal(res.status, 403);
});

test('PUT /api/reembolsos/:id/aprobar: solicitud ya revisada → 400', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'SET estado = \'aprobada\'', result: () => ({ rows: [] }) },
    { match: 'SELECT estado FROM solicitudes_reembolso WHERE id = $1', result: () => ({ rows: [{ estado: 'aprobada' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/1/aprobar', { token: token('profesor') });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /pendientes/);
});

test('PUT /api/reembolsos/:id/rechazar: profesor rechaza con motivo → 200', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SET estado = \'rechazada\'', result: () => ({ rows: [{ id: 1, estado: 'rechazada' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/1/rechazar', {
    token: token('profesor'),
    body: { motivo_rechazo: 'Comprobante inválido' },
  });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('SET estado'));
  assert.equal(update.params[0], 'Comprobante inválido');
});

test('PUT /api/reembolsos/:id/rechazar: sin motivo → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('PUT', '/api/reembolsos/1/rechazar', { token: token('profesor'), body: {} });
  assert.equal(res.status, 400);
});

test('PUT /api/reembolsos/:id/reabrir: admin reabre una solicitud revisada → 200', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: "SET estado = 'pendiente'", result: () => ({ rows: [{ id: 1, estado: 'pendiente' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/1/reabrir', { token: token('admin') });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('SET estado'));
  assert.match(update.text, /estado IN \('aprobada', 'rechazada'\)/);
  assert.equal(update.params[0], '1');
});

test('PUT /api/reembolsos/:id/reabrir: profesor sin permiso de editar → 403', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('PUT', '/api/reembolsos/1/reabrir', { token: token('profesor') });
  assert.equal(res.status, 403);
});

test('PUT /api/reembolsos/:id/reabrir: solicitud ya pendiente → 400', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: "SET estado = 'pendiente'", result: () => ({ rows: [] }) },
    { match: 'SELECT estado FROM solicitudes_reembolso WHERE id = $1', result: () => ({ rows: [{ estado: 'pendiente' }] }) },
  ]);
  const res = await request('PUT', '/api/reembolsos/1/reabrir', { token: token('admin') });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /aprobadas o rechazadas/);
});

test('DELETE /api/reembolsos/eliminar/:id: profesor sin permiso → 403; admin → 200', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const noPermiso = await request('DELETE', '/api/reembolsos/eliminar/1', { token: token('profesor') });
  assert.equal(noPermiso.status, 403);

  install([
    PERMISOS_VACIO,
    { match: 'DELETE FROM solicitudes_reembolso WHERE id = $1 RETURNING id', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('DELETE', '/api/reembolsos/eliminar/1', { token: token('admin') });
  assert.equal(res.status, 200);
});
