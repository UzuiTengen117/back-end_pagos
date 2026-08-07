const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign(
    { id, username: 'u', rol, token_version: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const USUARIO_BASE = {
  id: 1,
  nombre: 'Test',
  primer_apellido: 'Ap',
  segundo_apellido: null,
  username: 'test',
  email: 't@t.com',
  rol: 'estudiante',
  foto: null,
  created_at: new Date(),
  token_version: 0,
};

test('registro: sin token → 401', async () => {
  await start();
  const res = await request('POST', '/api/usuarios/registro', {
    body: { nombre: 'x', username: 'x', email: 'x@x.com', password: '123456', rol: 'admin' },
  });
  assert.equal(res.status, 401);
});

test('registro: estudiante autenticado → 403', async () => {
  await start();
  install();
  const res = await request('POST', '/api/usuarios/registro', {
    token: token('estudiante'),
    body: { nombre: 'x', username: 'x', email: 'x@x.com', password: '123456', rol: 'admin' },
  });
  assert.equal(res.status, 403);
});

test('registro: admin con rol inválido → 400', async () => {
  await start();
  install();
  const res = await request('POST', '/api/usuarios/registro', {
    token: token('admin'),
    body: { nombre: 'x', username: 'x', email: 'x@x.com', password: '123456', rol: 'superadmin' },
  });
  assert.equal(res.status, 400);
});

test('registro: admin → 201 y crea el usuario', async () => {
  await start();
  install([
    {
      match: 'INSERT INTO usuarios',
      result: () => ({ rows: [{ ...USUARIO_BASE, rol: 'profesor', token_version: 0 }] }),
    },
  ]);
  const res = await request('POST', '/api/usuarios/registro', {
    token: token('admin'),
    body: { nombre: 'x', username: 'x', email: 'x@x.com', password: '123456', rol: 'profesor' },
  });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  assert.equal(res.data.usuario.rol, 'profesor');
});

test('reset-password: sin token → 401', async () => {
  await start();
  const res = await request('POST', '/api/usuarios/reset-password', {
    body: { userId: 1, newPassword: 'nueva123' },
  });
  assert.equal(res.status, 401);
});

test('reset-password: no-admin → 403', async () => {
  await start();
  install();
  const res = await request('POST', '/api/usuarios/reset-password', {
    token: token('estudiante'),
    body: { userId: 1, newPassword: 'nueva123' },
  });
  assert.equal(res.status, 403);
});

test('reset-password: admin → 200', async () => {
  await start();
  install([
    {
      match: 'UPDATE usuarios SET password',
      result: () => ({ rows: [{ id: 1 }] }),
    },
  ]);
  const res = await request('POST', '/api/usuarios/reset-password', {
    token: token('admin'),
    body: { userId: 1, newPassword: 'nueva123' },
  });
  assert.equal(res.status, 200);
});

test('buscar: sin token → 401 y no-admin → 403', async () => {
  await start();
  install();
  const anon = await request('GET', '/api/usuarios/buscar?username=admin');
  assert.equal(anon.status, 401);
  const estudiante = await request('GET', '/api/usuarios/buscar?username=admin', {
    token: token('estudiante'),
  });
  assert.equal(estudiante.status, 403);
});

test('editar otro usuario: no-admin → 403', async () => {
  await start();
  install();
  const res = await request('PUT', '/api/usuarios/editar/2', {
    token: token('estudiante', 1),
    body: { nombre: 'x', primer_apellido: '', segundo_apellido: '', username: 'x', email: 'x@x.com', rol: 'admin' },
  });
  assert.equal(res.status, 403);
});

test('editar propio intentando cambiar rol: el rol se fuerza', async () => {
  await start();
  const { calls } = install([
    {
      match: 'UPDATE usuarios SET nombre',
      result: () => ({ rows: [{ ...USUARIO_BASE }] }),
    },
  ]);
  const res = await request('PUT', '/api/usuarios/editar/1', {
    token: token('estudiante', 1),
    body: { nombre: 'x', primer_apellido: '', segundo_apellido: '', username: 'x', email: 'x@x.com', rol: 'admin' },
  });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('UPDATE usuarios SET nombre'));
  assert.ok(update.params.includes('estudiante'), 'el rol debe ser el del usuario');
  assert.ok(!update.params.includes('admin'), 'no debe poder escalar a admin');
});

test('editar propio con password sin currentPassword → 400', async () => {
  await start();
  install();
  const res = await request('PUT', '/api/usuarios/editar/1', {
    token: token('estudiante', 1),
    body: { nombre: 'x', primer_apellido: '', segundo_apellido: '', username: 'x', email: 'x@x.com', rol: 'estudiante', password: 'nueva123' },
  });
  assert.equal(res.status, 400);
});

test('editar propio con password y currentPassword incorrecta → 400', async () => {
  await start();
  const hash = await bcrypt.hash('realpass', 4);
  install([
    {
      match: 'SELECT password FROM usuarios WHERE id = $1',
      result: () => ({ rows: [{ password: hash }] }),
    },
  ]);
  const res = await request('PUT', '/api/usuarios/editar/1', {
    token: token('estudiante', 1),
    body: {
      nombre: 'x', primer_apellido: '', segundo_apellido: '',
      username: 'x', email: 'x@x.com', rol: 'estudiante',
      password: 'nueva123', currentPassword: 'wrong',
    },
  });
  assert.equal(res.status, 400);
});

test('eliminar: no-admin → 403; admin a otro → 200; admin a sí mismo → 400', async () => {
  await start();
  install([
    {
      match: 'DELETE FROM usuarios WHERE id = $1',
      result: () => ({ rows: [{ id: 2 }] }),
    },
  ]);
  const noAdmin = await request('DELETE', '/api/usuarios/eliminar/2', { token: token('estudiante') });
  assert.equal(noAdmin.status, 403);

  const adminSelf = await request('DELETE', '/api/usuarios/eliminar/1', { token: token('admin', 1) });
  assert.equal(adminSelf.status, 400);

  const admin = await request('DELETE', '/api/usuarios/eliminar/2', { token: token('admin', 1) });
  assert.equal(admin.status, 200);
});

test('login: mensaje idéntico para usuario inexistente y contraseña incorrecta', async () => {
  await start();
  const hash = await bcrypt.hash('correcta', 4);

  install([
    { match: 'FROM usuarios WHERE username = $1', result: () => ({ rows: [] }) },
  ]);
  const inexistente = await request('POST', '/api/usuarios/login', {
    body: { username: 'nadie', password: 'x' },
  });
  assert.equal(inexistente.status, 401);

  install([
    {
      match: 'FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ id: 1, username: 'test', password: hash, rol: 'estudiante', last_login_at: null, token_version: 0, locked_until: null }] }),
    },
    {
      match: 'UPDATE usuarios SET failed_attempts = failed_attempts + 1',
      result: () => ({ rows: [] }),
    },
  ]);
  const malPass = await request('POST', '/api/usuarios/login', {
    body: { username: 'test', password: 'incorrecta' },
  });
  assert.equal(malPass.status, 401);
  assert.equal(inexistente.data.message, malPass.data.message);
});

test('login exitoso → 200 con token', async () => {
  await start();
  const hash = await bcrypt.hash('correcta', 4);
  install([
    {
      match: 'FROM usuarios WHERE username = $1',
      result: () => ({ rows: [{ id: 1, username: 'test', password: hash, rol: 'estudiante', last_login_at: null, token_version: 0, locked_until: null }] }),
    },
    { match: 'UPDATE usuarios SET failed_attempts = 0', result: () => ({ rows: [] }) },
    { match: 'UPDATE usuarios SET token_version = token_version + 1', result: () => ({ rows: [{ token_version: 1 }] }) },
  ]);
  const res = await request('POST', '/api/usuarios/login', {
    body: { username: 'test', password: 'correcta' },
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.token);
  assert.equal(res.data.usuario.rol, 'estudiante');
});

test('login: 5 fallos consecutivos bloquean la cuenta (429)', async () => {
  await start();
  const hash = await bcrypt.hash('correcta', 4);
  const state = { failures: 0 };
  const MAX = 5;

  install([
    {
      match: 'FROM usuarios WHERE username = $1',
      result: () => {
        if (state.failures >= MAX) {
          return { rows: [{ id: 1, username: 'test', password: hash, rol: 'estudiante', last_login_at: null, token_version: 0, failed_attempts: MAX, locked_until: new Date(Date.now() + 3600e3) }] };
        }
        return { rows: [{ id: 1, username: 'test', password: hash, rol: 'estudiante', last_login_at: null, token_version: 0, failed_attempts: state.failures, locked_until: null }] };
      },
    },
    {
      match: 'SET failed_attempts = failed_attempts + 1',
      result: () => {
        state.failures += 1;
        return { rows: [] };
      },
    },
  ]);

  let status = 0;
  for (let i = 0; i < 5; i += 1) {
    status = (await request('POST', '/api/usuarios/login', { body: { username: 'test', password: 'mala' } })).status;
  }
  assert.equal(status, 401);
  const sexto = await request('POST', '/api/usuarios/login', { body: { username: 'test', password: 'mala' } });
  assert.equal(sexto.status, 429);
});

test('GET /api/usuarios: no-admin solo ve su propio registro', async () => {
  await start();
  const { calls } = install([
    {
      match: 'FROM usuarios WHERE id = $1',
      result: () => ({ rows: [{ ...USUARIO_BASE }] }),
    },
  ]);
  const res = await request('GET', '/api/usuarios', { token: token('estudiante', 7) });
  assert.equal(res.status, 200);
  const query = calls.find((c) => c.text.includes('FROM usuarios WHERE id'));
  assert.ok(query, 'no-admin debe consultar con filtro por id');
  assert.deepEqual(query.params, [7]);
});
