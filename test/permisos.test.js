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

function targetRol(rol) {
  return { match: 'SELECT rol FROM usuarios WHERE id = $1', result: () => ({ rows: [{ rol }] }) };
}

test('GET /api/permisos/modulos expone exactamente las 12 categorías', async () => {
  await start();
  install();
  const res = await request('GET', '/api/permisos/modulos', { token: token('admin') });
  assert.equal(res.status, 200);

  const esperados = [
    'pagos', 'inscripciones', 'comprobantes', 'alumnos',
    'usuarios', 'solicitudes_reembolso', 'precios', 'becas', 'asistencias', 'eventos', 'examenes', 'tienda',
  ];
  for (const mod of esperados) {
    assert.ok(res.data[mod], `debe existir el módulo ${mod}`);
  }
  assert.equal(Object.keys(res.data).length, 12, 'deben ser exactamente 12 categorías');

  assert.ok(res.data.asistencias.subcategorias.tomar_asistencia.acciones.registrar);
  assert.ok(res.data.asistencias.subcategorias.reporte_asistencias.acciones.reportar, 'debe existir la acción reportar');
  assert.equal(Object.keys(res.data.asistencias.subcategorias).length, 2);

  // Examenes replica la division de eventos: gestionar la convocatoria y leer
  // la hoja de resultados son permisos distintos, y confundirlos abriria la
  // hoja de resultados de todos los alumnos a quien solo organiza examenes.
  assert.equal(Object.keys(res.data.examenes.subcategorias).length, 2);
  assert.ok(res.data.examenes.subcategorias.examenes.acciones.crear);
  assert.ok(res.data.examenes.subcategorias.reporte_examenes.acciones.ver);
  assert.ok(!res.data.examenes.acciones, 'examenes debe usar subcategorias, no acciones planas');

  assert.ok(res.data.comprobantes.acciones.crear);
  assert.ok(res.data.comprobantes.acciones.editar);
  assert.ok(res.data.comprobantes.acciones.eliminar);

  assert.ok(res.data.solicitudes_reembolso.acciones.ver);
  assert.ok(res.data.solicitudes_reembolso.acciones.aprobar);
  assert.ok(res.data.solicitudes_reembolso.acciones.rechazar);
  assert.ok(res.data.solicitudes_reembolso.acciones.editar);
  assert.ok(res.data.solicitudes_reembolso.acciones.eliminar);

  assert.ok(!res.data.permisos, 'no debe existir un módulo de administración de permisos');
  assert.ok(!res.data.historial, 'no debe existir un módulo de historial');
});

test('GET /api/permisos/modulos: subcategorías del registro de usuarios', async () => {
  await start();
  install();
  const res = await request('GET', '/api/permisos/modulos', { token: token('admin') });
  assert.equal(res.status, 200);

  const usuarios = res.data.usuarios;
  assert.ok(usuarios.subcategorias, 'el módulo usuarios debe tener subcategorías');
  assert.ok(usuarios.subcategorias.estudiantes.acciones.crear);
  assert.ok(usuarios.subcategorias.estudiantes.acciones.editar);
  assert.ok(usuarios.subcategorias.estudiantes.acciones.eliminar);
  assert.ok(usuarios.subcategorias.profesores.acciones.ver);
  assert.ok(usuarios.subcategorias.profesores.acciones.crear);
  assert.ok(usuarios.subcategorias.administradores.acciones.ver);
  assert.ok(usuarios.subcategorias.administradores.acciones.crear);

  const bloqueadas = usuarios.bloqueadas || [];
  assert.ok(!bloqueadas.includes('ver:administradores'), 'ver administradores sí puede asignarse a no-admins');
  assert.ok(bloqueadas.includes('crear:administradores'));
  assert.ok(bloqueadas.includes('editar:administradores'));
  assert.ok(bloqueadas.includes('eliminar:administradores'));
});

test('GET /api/permisos/defaults/:rol devuelve los permisos base', async () => {
  await start();
  install();

  const admin = await request('GET', '/api/permisos/defaults/admin', { token: token('admin') });
  assert.equal(admin.status, 200);
  assert.ok(admin.data.permisos.includes('comprobantes:crear'));
  assert.ok(admin.data.permisos.includes('usuarios:crear:administradores'));

  const prof = await request('GET', '/api/permisos/defaults/profesor', { token: token('admin') });
  assert.equal(prof.status, 200);
  for (const p of ['pagos:crear', 'comprobantes:editar', 'alumnos:eliminar', 'precios:crear', 'becas:crear']) {
    assert.ok(prof.data.permisos.includes(p), `profesor debe tener ${p}`);
  }
  assert.ok(!prof.data.permisos.includes('solicitudes_reembolso:editar'));
  assert.ok(!prof.data.permisos.includes('solicitudes_reembolso:eliminar'));
  assert.ok(prof.data.permisos.includes('asistencias:reportar:reporte_asistencias'), 'profesor debe poder generar reportes');
  assert.ok(prof.data.permisos.includes('usuarios:crear:estudiantes'));
  assert.ok(prof.data.permisos.includes('usuarios:ver:profesores'));
  assert.ok(prof.data.permisos.includes('usuarios:ver:administradores'), 'el profesor puede ver administradores');
  assert.ok(!prof.data.permisos.includes('usuarios:crear:profesores'));
  assert.ok(!prof.data.permisos.includes('usuarios:crear:administradores'));

  const invalido = await request('GET', '/api/permisos/defaults/superadmin', { token: token('admin') });
  assert.equal(invalido.status, 400);
});

test('GET /api/permisos/mis: admin sin filas ve todas las acciones', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('GET', '/api/permisos/mis', { token: token('admin') });
  assert.equal(res.status, 200);
  assert.ok(res.data.permisos.includes('solicitudes_reembolso:ver'));
  assert.ok(res.data.permisos.includes('comprobantes:crear'));
  assert.ok(res.data.permisos.includes('usuarios:eliminar:administradores'));
});

test('GET /api/permisos/mis: admin con filas explícitas usa esas filas', async () => {
  await start();
  install([
    {
      match: 'FROM permisos_usuario WHERE usuario_id = $1',
      result: () => ({ rows: [{ modulo: 'pagos', accion: 'crear' }] }),
    },
  ]);
  const res = await request('GET', '/api/permisos/mis', { token: token('admin') });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.permisos, ['pagos:crear']);
});

test('GET /api/permisos/mis: profesor sin filas usa permisos por defecto', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const res = await request('GET', '/api/permisos/mis', { token: token('profesor') });
  assert.equal(res.status, 200);
  assert.ok(res.data.permisos.includes('solicitudes_reembolso:ver'));
  assert.ok(res.data.permisos.includes('solicitudes_reembolso:aprobar'));
  assert.ok(res.data.permisos.includes('solicitudes_reembolso:rechazar'));
  assert.ok(!res.data.permisos.includes('solicitudes_reembolso:editar'));
  assert.ok(!res.data.permisos.includes('solicitudes_reembolso:eliminar'));
  assert.ok(res.data.permisos.includes('usuarios:ver:administradores'), 'el profesor ve administradores');
  assert.ok(!res.data.permisos.includes('usuarios:crear:administradores'));
});

test('GET /api/permisos/mis: permisos explícitos reemplazan los por defecto', async () => {
  await start();
  install([
    {
      match: 'FROM permisos_usuario WHERE usuario_id = $1',
      result: () => ({ rows: [{ modulo: 'solicitudes_reembolso', accion: 'editar' }] }),
    },
  ]);
  const res = await request('GET', '/api/permisos/mis', { token: token('profesor', 9) });
  assert.equal(res.status, 200);
  assert.ok(res.data.permisos.includes('solicitudes_reembolso:editar'));
  assert.ok(!res.data.permisos.includes('solicitudes_reembolso:aprobar'), 'no debe incluir defaults si hay filas explícitas');
});

test('GET /api/permisos/usuario/:id: no-admin → 403; admin ve los permisos del objetivo', async () => {
  await start();
  install();
  const noAdmin = await request('GET', '/api/permisos/usuario/5', { token: token('profesor') });
  assert.equal(noAdmin.status, 403);

  install([targetRol('profesor'), PERMISOS_VACIO]);
  const admin = await request('GET', '/api/permisos/usuario/5', { token: token('admin') });
  assert.equal(admin.status, 200);
  assert.ok(admin.data.permisos.includes('solicitudes_reembolso:ver'));
  assert.ok(admin.data.permisos.includes('pagos:crear'));
  assert.ok(!admin.data.permisos.includes('solicitudes_reembolso:editar'));
});

test('PUT /api/permisos/usuario/:id: no-admin → 403; admin reemplaza permisos', async () => {
  await start();
  install();
  const noAdmin = await request('PUT', '/api/permisos/usuario/5', {
    token: token('profesor'),
    body: { permisos: [] },
  });
  assert.equal(noAdmin.status, 403);

  const { calls } = install([
    targetRol('profesor'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO permisos_usuario', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'solicitudes_reembolso', accion: 'editar' },
        { modulo: 'solicitudes_reembolso', accion: 'eliminar' },
      ],
    },
  });
  assert.equal(res.status, 200);
  const inserts = calls.filter((c) => c.text.includes('INSERT INTO permisos_usuario'));
  assert.equal(inserts.length, 2);
});

test('PUT /api/permisos/usuario/:id: acciones inválidas se ignoran', async () => {
  await start();
  const { calls } = install([
    targetRol('profesor'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO permisos_usuario', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'solicitudes_reembolso', accion: 'editar' },
        { modulo: 'historial', accion: 'eliminar' },
        { modulo: 'solicitudes_reembolso', accion: 'hackear' },
      ],
    },
  });
  assert.equal(res.status, 200);
  const inserts = calls.filter((c) => c.text.includes('INSERT INTO permisos_usuario'));
  assert.equal(inserts.length, 1, 'solo se debe insertar la acción válida');
  assert.ok(calls.some((c) => c.text === 'COMMIT'), 'debe confirmar la transacción');
});

test('PUT /api/permisos/usuario/:id: si una inserción falla, revierte todo', async () => {
  await start();
  let inserts = 0;
  const { calls } = install([
    targetRol('profesor'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    {
      match: 'INSERT INTO permisos_usuario',
      result: () => {
        inserts += 1;
        if (inserts === 2) throw new Error('fallo de escritura');
        return { rows: [{ id: 1 }] };
      },
    },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'asistencias', accion: 'registrar:tomar_asistencia' },
        { modulo: 'asistencias', accion: 'reportar:reporte_asistencias' },
      ],
    },
  });
  assert.equal(res.status, 500);
  assert.ok(calls.some((c) => c.text === 'BEGIN'), 'debe abrir la transacción');
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'debe revertir');
  assert.ok(!calls.some((c) => c.text === 'COMMIT'), 'no debe confirmar si algo fallo');
});

test('PUT /api/permisos/usuario/:id: crear/editar/eliminar administradores no se asignan a un no-admin', async () => {
  await start();
  const { calls } = install([
    targetRol('profesor'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO permisos_usuario', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'usuarios', accion: 'ver:administradores' },
        { modulo: 'usuarios', accion: 'crear:administradores' },
        { modulo: 'usuarios', accion: 'editar:administradores' },
        { modulo: 'usuarios', accion: 'eliminar:administradores' },
      ],
    },
  });
  assert.equal(res.status, 200);
  const inserts = calls.filter((c) => c.text.includes('INSERT INTO permisos_usuario'));
  assert.equal(inserts.length, 1, 'solo ver:administradores debe guardarse a un no-admin');
  assert.equal(inserts[0].params[2], 'ver:administradores');
});

test('PUT /api/permisos/usuario/:id: a un estudiante no se le asignan permisos', async () => {
  await start();
  const { calls } = install([
    targetRol('estudiante'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO permisos_usuario', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'pagos', accion: 'crear' },
        { modulo: 'solicitudes_reembolso', accion: 'ver' },
      ],
    },
  });
  assert.equal(res.status, 200);
  const inserts = calls.filter((c) => c.text.includes('INSERT INTO permisos_usuario'));
  assert.equal(inserts.length, 0, 'los estudiantes no reciben permisos asignados');
});

test('PUT /api/permisos/usuario/:id: a un administrador sí se le guardan todas las acciones', async () => {
  await start();
  const { calls } = install([
    targetRol('admin'),
    { match: 'DELETE FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) },
    { match: 'INSERT INTO permisos_usuario', result: () => ({ rows: [{ id: 1 }] }) },
  ]);
  const res = await request('PUT', '/api/permisos/usuario/5', {
    token: token('admin'),
    body: {
      permisos: [
        { modulo: 'usuarios', accion: 'eliminar:administradores' },
        { modulo: 'pagos', accion: 'crear' },
      ],
    },
  });
  assert.equal(res.status, 200);
  const inserts = calls.filter((c) => c.text.includes('INSERT INTO permisos_usuario'));
  assert.equal(inserts.length, 2);
});
