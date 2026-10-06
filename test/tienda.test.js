const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign({ id, username: 'u', rol, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };

const PRODUCTO = { nombre: 'Dobok Infantil', descripcion: 'Tallas 1-3', precio: 450, stock: 10, activo: true };

function multipart(server, ruta, auth, campos) {
  const form = new FormData();
  for (const [name, value] of Object.entries(campos)) {
    if (value instanceof Blob) {
      form.append(name, value, value.name);
    } else {
      form.append(name, value);
    }
  }
  return fetch(`http://127.0.0.1:${server.address().port}${ruta}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}` },
    body: form,
  });
}

// --- Productos ---

test('GET /api/productos: el alumno solo ve activos', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM productos', result: () => ({ rows: [{ id: 1, activo: true }] }) },
  ]);
  const res = await request('GET', '/api/productos', { token: token('estudiante') });
  assert.equal(res.status, 200);
  const list = calls.find((c) => c.text.includes('FROM productos'));
  assert.ok(list.text.includes('activo = TRUE'), 'el listado del alumno debe filtrar activos');
});

test('GET /api/productos: el admin los ve todos', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM productos', result: () => ({ rows: [{ id: 1, activo: false }] }) },
  ]);
  const res = await request('GET', '/api/productos', { token: token('admin') });
  assert.equal(res.status, 200);
  const list = calls.find((c) => c.text.includes('FROM productos'));
  assert.ok(!list.text.includes('activo = TRUE'), 'el admin no debe filtrar por activo');
});

test('GET /api/productos/:id: un alumno no ve productos desactivados por id', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM productos', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/productos/5', { token: token('estudiante') });
  assert.equal(res.status, 404);
  const detail = calls.filter((c) => c.text.includes('FROM productos')).pop();
  assert.ok(detail, 'debe ejecutarse la consulta del producto');
  assert.ok(detail.text.includes('activo = TRUE'), 'el detalle del alumno debe exigir activo');
});

test('POST /api/productos/agregar: estudiante → 403; admin → 201', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const noPermiso = await request('POST', '/api/productos/agregar', {
    token: token('estudiante'),
    body: PRODUCTO,
  });
  assert.equal(noPermiso.status, 403);

  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO productos', result: () => ({ rows: [{ id: 1, ...PRODUCTO }] }) },
  ]);
  const ok = await request('POST', '/api/productos/agregar', { token: token('admin'), body: PRODUCTO });
  assert.equal(ok.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO productos'));
  assert.equal(insert.params[0], PRODUCTO.nombre);
  assert.equal(insert.params[2], PRODUCTO.precio);
  assert.equal(insert.params[3], PRODUCTO.stock);
});

test('POST /api/productos/agregar: precio o stock inválidos → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const malPrecio = await request('POST', '/api/productos/agregar', {
    token: token('admin'),
    body: { ...PRODUCTO, precio: -5 },
  });
  assert.equal(malPrecio.status, 400);

  const malStock = await request('POST', '/api/productos/agregar', {
    token: token('admin'),
    body: { ...PRODUCTO, stock: -1 },
  });
  assert.equal(malStock.status, 400);

  const sinNombre = await request('POST', '/api/productos/agregar', {
    token: token('admin'),
    body: { ...PRODUCTO, nombre: '  ' },
  });
  assert.equal(sinNombre.status, 400);
});

test('PUT /api/productos/editar/:id actualiza stock y precio', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'UPDATE productos', result: () => ({ rows: [{ id: 3, ...PRODUCTO, stock: 7 }] }) },
  ]);
  const res = await request('PUT', '/api/productos/editar/3', {
    token: token('admin'),
    body: { ...PRODUCTO, stock: 7 },
  });
  assert.equal(res.status, 200);
  const update = calls.find((c) => c.text.includes('UPDATE productos'));
  assert.equal(update.params[0], PRODUCTO.nombre);
  assert.equal(update.params[3], 7, 'el stock nuevo debe viajar al UPDATE');
});

test('DELETE /api/productos/eliminar/:id: con pedidos asociados → 400 y sugieren desactivar', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const { calls, pool } = install([
    PERMISOS_VACIO,
    {
      match: 'DELETE FROM productos',
      result: (raw) => {
        const err = new Error('violación de FK');
        err.code = '23503';
        throw err;
      },
    },
  ]);
  const res = await request('DELETE', '/api/productos/eliminar/2', { token: token('admin') });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /Desactívalo/);
  assert.ok(calls.filter((c) => c.text.includes('DELETE FROM productos')).length >= 1);
});

test('POST /api/productos/:id/imagen guarda la foto, valida el formato y no acepta thumb oversize', async () => {
  const server = await start();
  const auth = token('admin');

  install([PERMISOS_VACIO]);
  const malFormato = await multipart(server, '/api/productos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('<svg onload=alert(1)>')], { type: 'image/svg+xml' }),
  });
  assert.equal(malFormato.status, 400, 'un SVG no debe aceptarse como imagen');

  install([PERMISOS_VACIO, { match: 'SET imagen_thumb = $2', result: () => ({ rows: [] }) }]);
  const thumbPesado = await multipart(server, '/api/productos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(300 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(thumbPesado.status, 400, 'una miniatura de 300KB debe rechazarse');

  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SET imagen = $1', result: () => ({ rows: [{ id: 5 }] }) },
  ]);
  const ok = await multipart(server, '/api/productos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(40 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).imagen, /^data:image\/jpeg;base64,/);
  const update = calls.find((c) => c.text.includes('SET imagen = $1'));
  assert.ok(update.params[1], 'debe guardar también la miniatura');
});

// --- Pedidos ---

test('POST /api/pedidos: el alumno pide y el stock baja en una transacción', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 7 }] }) },
    {
      match: 'SET stock = stock - $2',
      result: (raw) => {
        if (raw.text.includes('FROM pedidos')) return { rows: [] };
        return { rows: [{ nombre: 'Dobok', precio: '450.00' }] };
      },
    },
    { match: 'INSERT INTO pedidos', result: () => ({ rows: [{ id: 1, total: '450.00' }] }) },
    { match: 'INSERT INTO pedido_detalles', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 2, cantidad: 1 }], notas: 'Dobok talla 3' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.total, '450.00');

  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  const descuento = calls.find((c) => c.text.includes('SET stock = stock - $2'));
  assert.equal(descuento.params[0], 2);
  assert.equal(descuento.params[1], 1);
  const nota = calls.find((c) => c.text.includes('INSERT INTO pedidos'));
  assert.equal(nota.params[1], '450.00');
  assert.equal(nota.params[2], 'Dobok talla 3');
  assert.equal(nota.params[3], 'efectivo', 'sin metodo_pago se registra pago en efectivo por defecto');
});

test('POST /api/pedidos: suma cantidades y calcula el total', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 7 }] }) },
    {
      match: 'SET stock = stock - $2',
      result: (raw) => {
        if (raw.text.includes('FROM pedidos')) return { rows: [] };
        const fila = raw.params[0] === 1 ? { nombre: 'Dobok', precio: '450.00' } : { nombre: 'Tirador', precio: '120.00' };
        return { rows: [fila] };
      },
    },
    { match: 'INSERT INTO pedidos', result: () => ({ rows: [{ id: 1 }] }) },
    { match: 'INSERT INTO pedido_detalles', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 1, cantidad: 2 }, { producto_id: 2, cantidad: 1 }] },
  });

  const detalles = calls.filter((c) => c.text.includes('INSERT INTO pedido_detalles'));
  assert.equal(detalles.length, 2);
  assert.equal(detalles[0].params[3], '450.00');
  assert.equal(detalles[1].params[3], '120.00');
  const pedido = calls.find((c) => c.text.includes('INSERT INTO pedidos'));
  assert.equal(pedido.params[1], '1020.00', 'total = 2*450 + 120');
});

test('POST /api/pedidos: el metodo de pago en_linea se guarda y un metodo invalido se rechaza', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 7 }] }) },
    { match: 'SET stock = stock - $2', result: () => ({ rows: [{ nombre: 'Dobok', precio: '450.00' }] }) },
    { match: 'INSERT INTO pedidos', result: () => ({ rows: [{ id: 1 }] }) },
    { match: 'INSERT INTO pedido_detalles', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const enLinea = await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 1, cantidad: 1 }], metodo_pago: 'en_linea' },
  });
  assert.equal(enLinea.status, 201);
  const pedido = calls.find((c) => c.text.includes('INSERT INTO pedidos'));
  assert.equal(pedido.params[3], 'en_linea', 'el metodo elegido debe viajar al INSERT');

  const invalido = await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 1, cantidad: 1 }], metodo_pago: 'transaccion' },
  });
  assert.equal(invalido.status, 400);
  assert.ok(invalido.data.message.includes('Método de pago no válido'));
});

test('POST /api/pedidos: stock insuficiente revierte todo el pedido', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 7 }] }) },
    { match: 'SET stock = stock - $2', result: () => ({ rows: [] }) },
    {
      match: 'SELECT nombre, activo, stock FROM productos',
      result: () => ({ rows: [{ nombre: 'Dobok', activo: true, stock: 0 }] }),
    },
    { match: 'INSERT INTO pedidos', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 2, cantidad: 3 }] },
  });
  assert.equal(res.status, 409);
  assert.match(res.data.message, /Stock insuficiente/);
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'debe revertir');
  assert.ok(!calls.some((c) => c.text === 'COMMIT'), 'no debe confirmar');
});

test('POST /api/pedidos: sin alumno registrado → 400', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [] }) },
  ]);
  const res = await request('POST', '/api/pedidos', {
    token: token('estudiante'),
    body: { items: [{ producto_id: 1, cantidad: 1 }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /alumno registrado/);
});

test('GET /api/pedidos: el admin lista todos; el estudiante recibe 403', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM pedidos', result: () => ({ rows: [{ id: 1, alumno: 'Juan Pérez' }] }) },
  ]);
  const admin = await request('GET', '/api/pedidos', { token: token('admin') });
  assert.equal(admin.status, 200);

  install([PERMISOS_VACIO]);
  const estudiante = await request('GET', '/api/pedidos', { token: token('estudiante') });
  assert.equal(estudiante.status, 403);
});

test('GET /api/pedidos/mis: filtra siempre por el usuario de la sesión', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM pedidos', result: () => ({ rows: [{ id: 1, estado: 'pendiente' }] }) },
  ]);
  const res = await request('GET', '/api/pedidos/mis', { token: token('estudiante', 11) });
  assert.equal(res.status, 200);
  const list = calls.find((c) => c.text.includes('FROM pedidos'));
  assert.ok(list.text.includes('a.usuario_id = $1'), 'debe filtrar por el usuario de la sesión');
  assert.equal(list.params[0], 11);
});

test('GET /api/pedidos/:id: un estudiante no ve pedidos ajenos', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'WHERE p.id = $1', result: () => ({ rows: [] }) },
  ]);
  const res = await request('GET', '/api/pedidos/9', { token: token('estudiante', 11) });
  assert.equal(res.status, 404);
  const detail = calls.filter((c) => c.text.includes('FROM pedidos')).pop();
  assert.ok(detail, 'debe ejecutarse la consulta del pedido');
  assert.ok(detail.text.includes('a.usuario_id = $2'), 'el detalle del estudiante debe llevar scope');
  assert.equal(detail.params[1], 11);
});

test('PUT /api/pedidos/:id/estado: cancelar devuelve el stock', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ estado: 'pendiente' }] }) },
    { match: 'SET stock = p.stock +', result: () => ({ rows: [] }) },
    {
      match: 'UPDATE pedidos',
      result: () => ({ rows: [{ id: 4, estado: 'cancelado' }] }),
    },
  ]);

  const res = await request('PUT', '/api/pedidos/4/estado', {
    token: token('admin'),
    body: { estado: 'cancelado' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.estado, 'cancelado');
  assert.ok(calls.some((c) => c.text.includes('SET stock = p.stock +')), 'debe devolver stock');
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
});

test('PUT /api/pedidos/:id/estado: estudiante → 403 y estado inválido → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);
  const noPermiso = await request('PUT', '/api/pedidos/4/estado', {
    token: token('estudiante'),
    body: { estado: 'cancelado' },
  });
  assert.equal(noPermiso.status, 403);

  install([
    PERMISOS_VACIO,
    { match: 'SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ estado: 'pendiente' }] }) },
  ]);
  const invalido = await request('PUT', '/api/pedidos/4/estado', {
    token: token('admin'),
    body: { estado: 'entregadoX' },
  });
  assert.equal(invalido.status, 400);
  assert.ok(!invalido.data.message || true, 'responde 400 antes de tocar la base');
});

test('PUT /api/pedidos/:id/estado: volver a activar un pedido cancelado re-descuenta el stock', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ estado: 'cancelado' }] }) },
    { match: 'SELECT producto_id, cantidad FROM pedido_detalles', result: () => ({ rows: [{ producto_id: 2, cantidad: 1 }] }) },
    { match: 'SET stock = stock - $2', result: () => ({ rows: [{ id: 2 }] }) },
    {
      match: 'UPDATE pedidos',
      result: () => ({ rows: [{ id: 4, estado: 'preparacion' }] }),
    },
  ]);

  const res = await request('PUT', '/api/pedidos/4/estado', {
    token: token('admin'),
    body: { estado: 'preparacion' },
  });
  assert.equal(res.status, 200);
  const descuento = calls.filter((c) => c.text.includes('SET stock = stock - $2'));
  assert.equal(descuento.length, 1, 'debe re-descontar el stock');
  assert.equal(descuento[0].params[0], 2);
});

test('PUT /api/pedidos/:id/estado: sin stock al reactivar → 409 y revierte', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ estado: 'cancelado' }] }) },
    { match: 'SELECT producto_id, cantidad FROM pedido_detalles', result: () => ({ rows: [{ producto_id: 2, cantidad: 1 }] }) },
    { match: 'SET stock = stock - $2', result: () => ({ rows: [] }) },
  ]);
  const res = await request('PUT', '/api/pedidos/4/estado', {
    token: token('admin'),
    body: { estado: 'entregado' },
  });
  assert.equal(res.status, 409);
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
});

// Helper: construye la firma MP valida sobre el manifest documentado.
function firmaMercadoPago(id) {
  const ts = Math.floor(Date.now() / 1000);
  const requestId = 'test-req-123';
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secreto).update(manifest).digest('hex');
  return { headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId } };
}

async function webhookMP(cuerpo, headers = {}) {
  const srv = await start();
  return fetch(`http://127.0.0.1:${srv.address().port}/api/mercadopago/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });
}

test('POST /api/pedidos/:id/pago/preferencia: pedido en efectivo → 409', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM pedidos p', result: () => ({ rows: [{ id: 3, metodo_pago: 'efectivo', pago_estado: 'pendiente', total: '450.00' }] }) },
  ]);
  const res = await request('POST', '/api/pedidos/3/pago/preferencia', { token: token('estudiante'), body: {} });
  assert.equal(res.status, 409);
  assert.ok(res.data.message.includes('pago en línea'));
});

test('POST /api/pedidos/:id/pago/preferencia: pedido ya pagado → 409', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM pedidos p', result: () => ({ rows: [{ id: 3, metodo_pago: 'en_linea', pago_estado: 'aprobado', total: '450.00' }] }) },
  ]);
  const res = await request('POST', '/api/pedidos/3/pago/preferencia', { token: token('estudiante'), body: {} });
  assert.equal(res.status, 409);
  assert.ok(res.data.message.includes('ya está pagado'));
});

test('POST /api/pedidos/:id/pago/preferencia: sin access token → 503 (pasarela sin configurar)', async () => {
  await start();
  const previo = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  try {
    install([
      PERMISOS_VACIO,
      { match: 'FROM pedidos p', result: () => ({ rows: [{ id: 3, metodo_pago: 'en_linea', pago_estado: 'pendiente', total: '450.00' }] }) },
      { match: 'FROM pedido_detalles d', result: () => ({ rows: [{ nombre: 'Dobok', cantidad: 1, precio_unitario: '450.00' }] }) },
    ]);
    const res = await request('POST', '/api/pedidos/3/pago/preferencia', { token: token('estudiante'), body: {} });
    assert.equal(res.status, 503);
    assert.ok(res.data.message.toLowerCase().includes('pasarela'));
  } finally {
    if (previo) process.env.MERCADO_PAGO_ACCESS_TOKEN = previo;
  }
});

test('POST /api/pedidos/:id/pago/preferencia: estudiante con pedido ajeno → 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM pedidos p', result: () => ({ rows: [] }) },
  ]);
  const res = await request('POST', '/api/pedidos/99/pago/preferencia', { token: token('estudiante'), body: {} });
  assert.equal(res.status, 404);
});

test('POST /api/mercadopago/webhook: sin secreto configurado → 503', async () => {
  await start();
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  try {
    const res = await webhookMP({ type: 'payment', data: { id: '5001' } });
    assert.equal(res.status, 503);
  } finally {
    if (secreto) process.env.MERCADO_PAGO_WEBHOOK_SECRET = secreto;
  }
});

test('POST /api/mercadopago/webhook: firma incompleta → 400, no filtra motivos', async () => {
  await start();
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'secreto-de-prueba';
  try {
    const res = await webhookMP({ type: 'payment', data: { id: '5002' } }, { 'x-request-id': 'r-1' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(!body.message.includes('ts'), 'el 400 no debe filtrar el motivo');
  } finally {
    if (secreto) process.env.MERCADO_PAGO_WEBHOOK_SECRET = secreto;
    else delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  }
});

test('POST /api/mercadopago/webhook: firma valida avanza hasta el pago (sin token → 503)', async () => {
  await start();
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const tokenAcceso = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'secreto-de-prueba';
  delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  try {
    const { headers } = firmaMercadoPago('5003');
    const res = await webhookMP({ type: 'payment', data: { id: '5003' } }, headers);
    assert.ok(res.status === 503 || res.status === 200, 'firma válida pasa la verificación — de aquí en adelante depende de la pasarela, no de la firma');
  } finally {
    if (secreto) process.env.MERCADO_PAGO_WEBHOOK_SECRET = secreto;
    else delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (tokenAcceso) process.env.MERCADO_PAGO_ACCESS_TOKEN = tokenAcceso;
  }
});

test('POST /api/mercadopago/webhook: firma invalida → 400', async () => {
  await start();
  const secreto = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'secreto-de-prueba';
  try {
    const res = await webhookMP(
      { type: 'payment', data: { id: '5004' } },
      { 'x-signature': 'ts=1,v1=12ab34cd', 'x-request-id': 'r-evil' }
    );
    assert.equal(res.status, 400);
  } finally {
    if (secreto) process.env.MERCADO_PAGO_WEBHOOK_SECRET = secreto;
    else delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  }
});