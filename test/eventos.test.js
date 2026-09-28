const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, stop } = require('./helpers/http');
const { install } = require('./helpers/mockPool');

after(() => stop());

function token(rol, id = 1) {
  return jwt.sign({ id, username: 'u', rol, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// El mockPool despacha por coincidencia de texto y devuelve filas cocidas: nunca
// mira los parametros. Esta asercion si los mira, y es la unica red contra un
// $N sin su parametro o un placeholder de mas, que en Postgres es un 500 en
// produccion y un test verde aqui.
function assertPlaceholders(call) {
  const numeros = [...call.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const maximo = numeros.length > 0 ? Math.max(...numeros) : 0;
  assert.equal(
    call.params.length,
    maximo,
    `esperaba ${maximo} parametros para "${call.text.slice(0, 90)}..." y llegaron ${call.params.length}`
  );
}

// Sin filas explicitas el middleware cae a DEFAULTS segun el rol, que es justo
// lo que estos tests quieren comprobar.
const PERMISOS_VACIO = { match: 'FROM permisos_usuario WHERE usuario_id = $1', result: () => ({ rows: [] }) };

const PERMISOS_CON = (permisos) => ({
  match: 'FROM permisos_usuario WHERE usuario_id = $1',
  result: () => ({
    rows: permisos.map((p) => {
      const idx = p.indexOf(':');
      return { modulo: p.slice(0, idx), accion: p.slice(idx + 1) };
    }),
  }),
});

const EVENTO_VALIDO = {
  nombre: 'Torneo Regional AMTKD',
  tipo: 'torneo',
  fecha_inicio: '2026-10-15T18:00:00.000Z',
  sede: 'Progreso',
  lugar: 'Gimnasio Municipal',
  categorias: 'Cobre, Azul',
  descripcion: 'Categorias infantil y juvenil',
  precio_inscripcion: 250,
  cupo_maximo: 60,
  link_registro: 'https://ejemplo.com/registro',
  estado: 'programado',
};

const FUTURO = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

// --- Receta de la inscripcion: la transaccion hace siempre estas consultas en
// este orden, y el mock necesita un handler para cada una o explota.
const SIN_ALUMNO = { match: 'FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 22 }] }) };
// El match tiene que ser MAS ESPECIFICO que la columna: el mock despacha por
// subcadena, y un match genérico sobre eventos_inscripciones se tragaria tambien
// el COUNT del cupo, que es una consulta distinta.
const SIN_INSCRIPCION = { match: 'SELECT id, estado FROM eventos_inscripciones', result: () => ({ rows: [] }) };
const SIN_CUPO = { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '0' }] }) };

// `extra` se antepone a proposito: el mock toma el PRIMER handler que coincide,
// asi que un override (cupo lleno, evento cancelado) tiene que ganar al default.
function handlersInscripcion(extra = []) {
  return [
    SIN_ALUMNO,
    ...extra,
    { match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 60 }] }) },
    SIN_INSCRIPCION,
    SIN_CUPO,
    { match: 'INSERT INTO eventos_inscripciones', result: () => ({ rows: [{ id: 1, alumno_id: 22 }] }) },
  ];
}

// --- Validacion de alta ---

test('crear evento → 201 y el INSERT viaja parametrizado', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO eventos', result: () => ({ rows: [{ id: 7, ...EVENTO_VALIDO }] }) },
  ]);

  const res = await request('POST', '/api/eventos/agregar', {
    token: token('admin'),
    body: EVENTO_VALIDO,
  });

  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO eventos'));
  assert.ok(insert, 'debe haberse ejecutado el INSERT');
  assert.ok(insert.params.includes('Torneo Regional AMTKD'), 'el nombre debe ir en los parametros');
  assert.equal(insert.params.at(-1), 1, 'creado_por debe ser el id del usuario del token');
  assertPlaceholders(insert);
});

test('sin nombre, tipo fuera de catalogo, fecha invalida o ausente → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const sinNombre = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, nombre: '   ' },
  });
  assert.equal(sinNombre.status, 400);
  assert.match(sinNombre.data.message, /nombre/i);

  const tipoMalo = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, tipo: 'olimpiada' },
  });
  assert.equal(tipoMalo.status, 400);
  assert.match(tipoMalo.data.message, /Tipo no v/i);

  const fechaMala = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, fecha_inicio: 'no-es-una-fecha' },
  });
  assert.equal(fechaMala.status, 400);

  const { fecha_inicio, ...sinFecha } = EVENTO_VALIDO;
  const sinFechaResp = await request('POST', '/api/eventos/agregar', { token: token('admin'), body: sinFecha });
  assert.equal(sinFechaResp.status, 400);
  assert.match(sinFechaResp.data.message, /fecha y hora de inicio/i);
});

// Sin zona horaria, new Date() resuelve con la del SERVIDOR: el mismo body se
// guardaria a una hora distinta en local (UTC-6) y en Vercel (UTC).
test('fecha de inicio sin zona horaria → 400 en vez de adivinar', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const res = await request('POST', '/api/eventos/agregar', {
    token: token('admin'),
    body: { ...EVENTO_VALIDO, fecha_inicio: '2026-10-15T18:00' },
  });

  assert.equal(res.status, 400);
  assert.match(res.data.message, /zona horaria/i);
});

test('valores que desbordarian la columna → 400 y no 500', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const cupo = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, cupo_maximo: 1e9 },
  });
  assert.equal(cupo.status, 400);
  assert.match(cupo.data.message, /cupo m/i);

  // NUMERIC(10,2) admite 8 digitos enteros; 1e30 llegaria como 22003.
  const precio = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, precio_inscripcion: 1e30 },
  });
  assert.equal(precio.status, 400);
  assert.match(precio.data.message, /precio/i);

  const largo = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, sede: 'a'.repeat(80) },
  });
  assert.equal(largo.status, 400);
  assert.match(largo.data.message, /sede/i);

  const nombreLargo = await request('POST', '/api/eventos/agregar', {
    token: token('admin'), body: { ...EVENTO_VALIDO, nombre: 'a'.repeat(300) },
  });
  assert.equal(nombreLargo.status, 400);
  assert.match(nombreLargo.data.message, /nombre/i);
});

test('el profesor crea eventos por default, el estudiante no', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'INSERT INTO eventos', result: () => ({ rows: [{ id: 1 }] }) }]);

  const ok = await request('POST', '/api/eventos/agregar', { token: token('profesor'), body: EVENTO_VALIDO });
  assert.equal(ok.status, 201, 'el profesor debe poder crear eventos');

  install([PERMISOS_VACIO]);
  const no = await request('POST', '/api/eventos/agregar', { token: token('estudiante'), body: EVENTO_VALIDO });
  assert.equal(no.status, 403, 'el estudiante no debe poder crear eventos');
});

// --- Consulta ---

// El frontend llama GET /api/eventos, sin sufijo. Este test pega a la URL
// EXACTA que usa EventosService.loadAll: con el servicio en /ver y la ruta en
// /, la suite daba verde con la pagina muerta.
test('el listado NO pide la imagen completa, solo el thumbnail', async () => {
  await start();
  const { calls } = install([{ match: 'FROM eventos e', result: () => ({ rows: [{ id: 1 }] }) }]);

  const res = await request('GET', '/api/eventos', { token: token('estudiante') });
  assert.equal(res.status, 200, 'GET /api/eventos debe existir: es la ruta que usa el servicio');

  const list = calls.find((c) => c.text.includes('FROM eventos e'));
  assert.ok(list.text.includes('e.imagen_thumb AS imagen'), 'debe servir el thumbnail bajo el alias');
  assert.ok(!/\be\.imagen\b/.test(list.text), 'no debe mencionar la columna imagen completa, ni como fallback');
  assert.ok(list.text.includes('ORDER BY e.fecha_inicio ASC'), 'debe ordenar por fecha, no por id');
  assert.ok(list.text.includes("estado = 'inscrito'"), 'el conteo de inscritos solo cuenta los activos');
  assertPlaceholders(list);

  // El alias de lectura que usa el resto del repo.
  install([{ match: 'FROM eventos e', result: () => ({ rows: [] }) }]);
  const alias = await request('GET', '/api/eventos/ver', { token: token('estudiante') });
  assert.equal(alias.status, 200);
});

test('el detalle si trae la imagen completa', async () => {
  await start();
  const { calls } = install([{ match: 'FROM eventos e', result: () => ({ rows: [{ id: 1, imagen: 'data:image/png;base64,AAA' }] }) }]);

  const res = await request('GET', '/api/eventos/ver/1', { token: token('estudiante') });
  assert.equal(res.status, 200);
  assert.equal(res.data.imagen, 'data:image/png;base64,AAA');

  const detail = calls.find((c) => c.text.includes('FROM eventos e'));
  assertPlaceholders(detail);
});

// Un id de ruta no numerico era 22P02 -> 500 con stack en el log, alcanzable por
// cualquier sesion iniciada.
test('id de ruta no numerico → 404 y no 500', async () => {
  await start();
  install([{ match: 'FROM eventos e', result: () => ({ rows: [] }) }]);

  for (const ruta of ['/api/eventos/ver/abc', '/api/eventos/ver/-1', '/api/eventos/ver/1.5', '/api/eventos/ver/0']) {
    const res = await request('GET', ruta, { token: token('estudiante') });
    assert.equal(res.status, 404, `${ruta} debe devolver 404`);
  }
});

// --- Edicion y borrado ---

test('editar requiere el permiso editar y devuelve 404 si no existe', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'UPDATE eventos SET', result: () => ({ rows: [] }) }]);

  const res = await request('PUT', '/api/eventos/editar/999', { token: token('profesor'), body: EVENTO_VALIDO });
  assert.equal(res.status, 404);

  install([PERMISOS_CON(['eventos:ver_inscritos'])]);
  const sinPermiso = await request('PUT', '/api/eventos/editar/1', { token: token('profesor'), body: EVENTO_VALIDO });
  assert.equal(sinPermiso.status, 403, 'sin eventos:editar debe rebotar');
});

test('editar existente → 200, refresca updated_at y no toca la imagen', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'UPDATE eventos SET', result: () => ({ rows: [{ id: 3, ...EVENTO_VALIDO }] }) },
  ]);

  const res = await request('PUT', '/api/eventos/editar/3', { token: token('profesor'), body: EVENTO_VALIDO });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('UPDATE eventos SET'));
  assert.ok(update.text.includes('updated_at = NOW()'), 'debe refrescar updated_at');
  assert.ok(!update.text.includes('imagen'), 'la imagen va en su propia ruta, no en el PUT');
  assertPlaceholders(update);
});

test('eliminar evento inexistente → 404, existente → mensaje', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'DELETE FROM eventos', result: () => ({ rows: [] }) }]);
  const noExiste = await request('DELETE', '/api/eventos/eliminar/5', { token: token('admin') });
  assert.equal(noExiste.status, 404);

  install([PERMISOS_VACIO, { match: 'DELETE FROM eventos', result: () => ({ rows: [{ id: 5 }] }) }]);
  const ok = await request('DELETE', '/api/eventos/eliminar/5', { token: token('admin') });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.message, 'Evento eliminado');
});

test('quitar la imagen la borra de verdad', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SET imagen = NULL', result: () => ({ rows: [{ id: 5 }] }) },
  ]);

  const res = await request('DELETE', '/api/eventos/5/imagen', { token: token('profesor') });
  assert.equal(res.status, 200);
  assert.ok(calls.find((c) => c.text.includes('SET imagen = NULL')), 'debe nullar ambas columnas');
});

// --- Inscripcion ---

test('el alumno se inscribe en un evento programado → 201', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante', 3) });
  assert.equal(res.status, 201);

  const insert = calls.find((c) => c.text.includes('INSERT INTO eventos_inscripciones'));
  // parseId normaliza el id de ruta a entero, asi que ya no llega como texto.
  assert.deepEqual(insert.params, [5, 22, 3], 'el alumno_id se resuelve del token, no del body');
  assert.ok(calls.some((c) => c.text.includes('FOR UPDATE')), 'el cupo se bloquea con FOR UPDATE');
});

test('el alumno no puede forjar el alumno_id desde el body', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  await request('POST', '/api/eventos/5/inscribirse', {
    token: token('estudiante', 3),
    body: { alumno_id: 999 },
  });

  const insert = calls.find((c) => c.text.includes('INSERT INTO eventos_inscripciones'));
  assert.ok(!insert.params.includes(999), 'el alumno_id del body debe ignorarse');
  assert.equal(insert.params[1], 22, 'debe usarse el alumno ligado al token');
});

test('cancelado, finalizado o ya ocurrido → 400 sin tocar la inscripcion', async () => {
  await start();

  install(handlersInscripcion([{ match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'cancelado', cupo_maximo: null }] }) }]));
  const cancelado = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(cancelado.status, 400);
  assert.match(cancelado.data.message, /cancelado/i);

  install(handlersInscripcion([{ match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'finalizado', cupo_maximo: null }] }) }]));
  const finalizado = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(finalizado.status, 400);
  assert.match(finalizado.data.message, /ya se lleva a cabo/i);

  // La fecha no se miraba antes: un curl a un evento del mes pasado devolvia 201.
  install(handlersInscripcion([{ match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', fecha_inicio: '2020-01-01T00:00:00.000Z', cupo_maximo: null }] }) }]));
  const pasado = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(pasado.status, 400);
  assert.match(pasado.data.message, /ya se llevó a cabo/i);
});

test('inscribirse sin registro de alumno → 404', async () => {
  await start();
  install([{ match: 'FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [] }) }]);

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(res.status, 404);
  assert.match(res.data.message, /registro de alumno/i);
});

test('cupo lleno → 400 antes de intentar el INSERT', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 1 }] }) },
    { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '1' }] }) },
  ]));

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /lugares disponibles/i);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO eventos_inscripciones')), 'no debe insertar si el cupo esta lleno');
});

// Con el cupo ya lleno, el alumno que YA tiene lugar recibia "ya no hay lugares".
test('quien ya esta inscrito recibe 200, no el error de cupo lleno', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'FROM eventos WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 1 }] }) },
    { match: 'SELECT id, estado FROM eventos_inscripciones', result: () => ({ rows: [{ id: 8, estado: 'inscrito' }] }) },
    { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '1' }] }) },
  ]));

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.text.includes('SELECT COUNT(*)')), 'no debe contar el cupo si ya tiene lugar');
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO eventos_inscripciones')), 'no debe duplicar la fila');
});

test('doble inscripcion simultanea (23505) → 400 con mensaje entendible', async () => {
  await start();
  const err = new Error('duplicate key');
  err.code = '23505';
  install(handlersInscripcion([{ match: 'INSERT INTO eventos_inscripciones', result: () => { throw err; } }]));

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /ya est/i);
});

test('reinscribirse tras cancelar reactiva la fila en vez de duplicar', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'SELECT id, estado FROM eventos_inscripciones', result: () => ({ rows: [{ id: 9, estado: 'cancelada' }] }) },
    { match: "SET estado = 'inscrito', created_at = NOW()", result: () => ({ rows: [{ id: 9 }] }) },
  ]));

  const res = await request('POST', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, 9);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO eventos_inscripciones')), 'no debe crear una segunda fila');
});

test('cancelar inscripcion → mensaje; sin inscripcion activa → 404', async () => {
  await start();
  install([
    SIN_ALUMNO,
    { match: "SET estado = 'cancelada'", result: () => ({ rows: [{ id: 4 }] }) },
  ]);
  const ok = await request('DELETE', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.message, 'Inscripción cancelada');

  install([
    SIN_ALUMNO,
    { match: "SET estado = 'cancelada'", result: () => ({ rows: [] }) },
  ]);
  const nada = await request('DELETE', '/api/eventos/5/inscribirse', { token: token('estudiante') });
  assert.equal(nada.status, 404);
});

// --- Inscritos ---

// La tarjeta contaba solo activos y el modal listaba todos: 3 cancelados
// inflaban la lista y el profesor llamaba a familias que ya habian salido.
test('ver inscritos solo trae los activos y exige el permiso', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM eventos WHERE id = $1', result: () => ({ rows: [{ id: 5 }] }) },
    { match: 'JOIN alumnos a ON a.id = ei.alumno_id', result: () => ({ rows: [] }) },
  ]);

  const res = await request('GET', '/api/eventos/5/inscritos', { token: token('profesor') });
  assert.equal(res.status, 200, 'el profesor lo tiene por default');

  const query = calls.find((c) => c.text.includes('JOIN alumnos a ON a.id = ei.alumno_id'));
  assert.ok(query.text.includes("ei.estado = 'inscrito'"), 'debe filtrar los cancelados');
  assertPlaceholders(query);

  install([PERMISOS_CON(['eventos:crear'])]);
  const sinPermiso = await request('GET', '/api/eventos/5/inscritos', { token: token('profesor') });
  assert.equal(sinPermiso.status, 403);
});

test('ver inscritos de un evento inexistente → 404', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'SELECT id FROM eventos WHERE id = $1', result: () => ({ rows: [] }) }]);

  const res = await request('GET', '/api/eventos/77/inscritos', { token: token('admin') });
  assert.equal(res.status, 404);
});

// --- Seguridad ---

test('SQLi: un nombre malicioso viaja en los parametros, no concatenado', async () => {
  await start();
  const payload = "'; DROP TABLE eventos;--";
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO eventos', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('POST', '/api/eventos/agregar', {
    token: token('admin'),
    body: { ...EVENTO_VALIDO, nombre: payload },
  });

  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO eventos'));
  assert.ok(!insert.text.includes(payload), 'el payload no debe aparecer en el SQL');
  assert.ok(insert.params.includes(payload), 'el payload debe ir parametrizado');
});

// Las rutas alias duplicadas (POST /, PUT /:id, DELETE /:id) se eliminaron a
// proposito: no las usa el frontend y cada copia duplicada es una superficie de
// 403 que mantener.

// --- Imagen: multipart a mano ---
//
// El thumbnail es lo que consume el listado. Sin validarlo, un caller con
// eventos:editar puede reintroducir por la puerta de atras los 2.67MB por
// evento que tumban la respuesta de Vercel, y escribir bytes arbitrarios en una
// columna que la app despues pinta como <img src>.
//
// El helper `request` solo envia JSON, asi que este caso arma el multipart a
// mano contra el mismo server. `start()` devuelve el listener.
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

test('el thumbnail se valida por tipo y por peso antes de guardarse', async () => {
  const server = await start();
  const auth = token('profesor');

  // Un SVG o un HTML disfrazado de imagen no debe poder llegar a la columna.
  install([PERMISOS_VACIO]);
  const tipoMalo = await multipart(server, '/api/eventos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.from('<svg onload=alert(1)>')], { type: 'image/svg+xml' }),
  });
  assert.equal(tipoMalo.status, 400, 'un SVG no debe aceptarse como miniatura');
  assert.match((await tipoMalo.json()).message, /miniatura/i);

  // El peso del thumbnail tiene su propio techo: 400KB pasaria el limite
  // generico de multer (2MB por archivo) y volveria al listado igual.
  install([PERMISOS_VACIO]);
  const pesoMalo = await multipart(server, '/api/eventos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(400 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(pesoMalo.status, 400, 'una miniatura de 400KB debe rechazarse');
  assert.match((await pesoMalo.json()).message, /miniatura/i);

  // Y el camino feliz guarda ambas columnas.
  install([PERMISOS_VACIO, { match: 'SET imagen = $1', result: () => ({ rows: [{ id: 5, imagen_thumb: 'data:image/jpeg;base64,AAA' }] }) }]);
  const ok = await multipart(server, '/api/eventos/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(40 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(ok.status, 200, 'una miniatura valida debe aceptarse');
});

test('la imagen exige contenido: sin archivo → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);

  // Sin cuerpo multipart multer deja req.files vacio y el handler responde 400.
  const res = await request('POST', '/api/eventos/5/imagen', { token: token('profesor') });
  assert.equal(res.status, 400);
});

test('las rutas alias de escritura ya no existen', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'UPDATE eventos SET', result: () => ({ rows: [{ id: 1 }] }) }]);

  const put = await request('PUT', '/api/eventos/1', { token: token('admin'), body: EVENTO_VALIDO });
  assert.equal(put.status, 404, 'PUT /:id no debe existir');

  install([PERMISOS_VACIO]);
  const post = await request('POST', '/api/eventos', { token: token('admin'), body: EVENTO_VALIDO });
  assert.equal(post.status, 404, 'POST / no debe existir');
});
