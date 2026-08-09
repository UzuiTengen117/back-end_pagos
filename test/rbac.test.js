const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign({ id, username: 'u', rol, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

test('GET /pagos: estudiante solo ve sus pagos; admin ve todo', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM pagos p', result: () => ({ rows: [] }) },
  ]);

  await request('GET', '/api/pagos', { token: token('admin', 1) });
  const adminCall = calls.find((c) => c.text.includes('FROM pagos p'));
  assert.ok(!adminCall.text.includes('usuario_id'), 'admin no debe filtrar por usuario');
  assert.deepEqual(adminCall.params, []);

  calls.length = 0;
  await request('GET', '/api/pagos', { token: token('estudiante', 7) });
  const studentCall = calls.find((c) => c.text.includes('FROM pagos p'));
  assert.match(studentCall.text, /WHERE a\.usuario_id = \$1/);
  assert.deepEqual(studentCall.params, [7]);
});

test('GET /alumnos: estudiante solo ve sus datos', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM alumnos a', result: () => ({ rows: [] }) },
  ]);
  await request('GET', '/api/alumnos', { token: token('estudiante', 7) });
  const call = calls.find((c) => c.text.includes('FROM alumnos a'));
  assert.match(call.text, /WHERE a\.usuario_id = \$1/);
  assert.deepEqual(call.params, [7]);
});

test('GET /comprobantes: estudiante solo ve los suyos', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM comprobantes c', result: () => ({ rows: [] }) },
  ]);
  await request('GET', '/api/comprobantes', { token: token('estudiante', 7) });
  const call = calls.find((c) => c.text.includes('FROM comprobantes c'));
  assert.match(call.text, /WHERE a\.usuario_id = \$1/);
  assert.deepEqual(call.params, [7]);
});

test('GET /inscripciones: estudiante solo ve las suyas', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM inscripciones i', result: () => ({ rows: [] }) },
  ]);
  await request('GET', '/api/inscripciones', { token: token('estudiante', 7) });
  const call = calls.find((c) => c.text.includes('FROM inscripciones i'));
  assert.match(call.text, /WHERE a\.usuario_id = \$1/);
  assert.deepEqual(call.params, [7]);
});

test('GET /becas y /tipos-pago: catálogo accesible sin filtrar por usuario', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM becas', result: () => ({ rows: [] }) },
    { match: 'FROM tipos_pago', result: () => ({ rows: [] }) },
  ]);
  await request('GET', '/api/becas', { token: token('estudiante') });
  await request('GET', '/api/tipos-pago', { token: token('estudiante') });
  const becas = calls.find((c) => c.text.includes('FROM becas'));
  const precios = calls.find((c) => c.text.includes('FROM tipos_pago'));
  assert.ok(!becas.text.includes('usuario_id'));
  assert.ok(!precios.text.includes('usuario_id'));
});

test('escritura de datos: estudiante → 403; profesor con permisos por defecto puede crear', async () => {
  await start();
  const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };
  install([
    PERMISOS_VACIO,
    {
      match: 'SELECT id FROM usuarios WHERE id = $1',
      result: () => ({ rows: [{ id: 5 }] }),
    },
    { match: 'FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO alumnos', result: () => ({ rows: [{ id: 1 }] }) },
    { match: 'INSERT INTO becas', result: () => ({ rows: [{ id: 1 }] }) },
    { match: 'INSERT INTO tipos_pago', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const pagoEst = await request('POST', '/api/pagos', {
    token: token('estudiante'),
    body: { alumno_id: 1, tipo_pago_id: 1, mes: 'Enero' },
  });
  assert.equal(pagoEst.status, 403);

  const alumnoProf = await request('POST', '/api/alumnos', {
    token: token('profesor'),
    body: { nombre: 'A', primer_apellido: 'B', usuario_id: 5, email: 'a@b.com', grado: '1', sede: 'Progreso' },
  });
  assert.equal(alumnoProf.status, 201);

  const becaProf = await request('POST', '/api/becas', {
    token: token('profesor'),
    body: { nombre: 'Beca', porcentaje: 25 },
  });
  assert.equal(becaProf.status, 201);

  const precioProf = await request('POST', '/api/tipos-pago', {
    token: token('profesor'),
    body: { concepto: 'X', monto: 100, tipo: 'otro' },
  });
  assert.equal(precioProf.status, 201);

  const becaEst = await request('POST', '/api/becas', {
    token: token('estudiante'),
    body: { nombre: 'Beca', porcentaje: 25 },
  });
  assert.equal(becaEst.status, 403, 'un estudiante nunca crea becas');
});

test('GET /api/usuarios: profesor por defecto ve el listado completo incluidos los admins', async () => {
  await start();
  const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id, nombre', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/usuarios', { token: token('profesor', 7) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('SELECT id, nombre'));
  assert.ok(call, 'debe ejecutarse la consulta de listado');
  assert.ok(!call.text.includes('WHERE rol'), 'el profesor por defecto ve también a los admins');
});

test('GET /api/usuarios: profesor sin ver:administradores no ve admins', async () => {
  await start();
  const { calls } = install([
    {
      match: 'FROM permisos_usuario WHERE usuario_id = $1',
      result: () => ({ rows: [{ modulo: 'usuarios', accion: 'crear:estudiantes' }] }),
    },
    { match: 'FROM usuarios WHERE rol', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/usuarios', { token: token('profesor', 7) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('FROM usuarios WHERE rol'));
  assert.ok(call, 'debe filtrar a los admins');
  assert.match(call.text, /rol <> 'admin'/);
});

test('GET /api/usuarios: admin ve el listado completo', async () => {
  await start();
  const { calls } = install([
    { match: 'FROM usuarios', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/usuarios', { token: token('admin', 1) });
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.text.includes('SELECT id, nombre'));
  assert.ok(call, 'debe ejecutarse la consulta de listado');
  assert.ok(!call.text.includes('WHERE id = $1'), 'admin no debe filtrar por id');
});
