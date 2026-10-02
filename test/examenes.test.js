const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { start, request, requestRaw, stop } = require('./helpers/http');
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

const EXAMEN_VALIDO = {
  nombre: 'Examen de Cinta Amarilla',
  fecha_examen: '2026-10-15T18:00:00.000Z',
  sede: 'Progreso',
  lugar: 'Gimnasio Municipal',
  niveles: 'Blanca, Amarilla',
  descripcion: 'Examen de promocion infantil y juvenil',
  precio_inscripcion: 250,
  cupo_maximo: 60,
  estado: 'programado',
};

const FUTURO = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

// --- Receta de la inscripcion: la transaccion hace siempre estas consultas en
// este orden, y el mock necesita un handler para cada una o explota.
const SIN_ALUMNO = { match: 'FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 22 }] }) };
// El match tiene que ser MAS ESPECIFICO que la columna: el mock despacha por
// subcadena, y un match genérico sobre examenes_inscripciones se tragaria tambien
// el COUNT del cupo, que es una consulta distinta.
const SIN_INSCRIPCION = { match: 'SELECT id, estado FROM examenes_inscripciones', result: () => ({ rows: [] }) };
const SIN_CUPO = { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '0' }] }) };

// `extra` se antepone a proposito: el mock toma el PRIMER handler que coincide,
// asi que un override (cupo lleno, examen cancelado) tiene que ganar al default.
function handlersInscripcion(extra = []) {
  return [
    SIN_ALUMNO,
    ...extra,
    { match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 60 }] }) },
    SIN_INSCRIPCION,
    SIN_CUPO,
    { match: 'INSERT INTO examenes_inscripciones', result: () => ({ rows: [{ id: 1, alumno_id: 22 }] }) },
  ];
}

// Datos que el alumno escribe en el modal antes de inscribirse. El backend los
// exige: nombre, paterno, grado y escuela son obligatorios, la edad opcional.
const DATOS_INSCRIPCION = {
  nombre: 'Juan Carlos',
  primer_apellido: 'García',
  segundo_apellido: 'Hernández',
  edad: 12,
  grado: '4to',
  escuela: 'Escuela Primaria Federal',
};

// --- Validacion de alta ---

test('crear examen → 201 y el INSERT viaja parametrizado', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 7, ...EXAMEN_VALIDO }] }) },
  ]);

  const res = await request('POST', '/api/examenes/agregar', {
    token: token('admin'),
    body: EXAMEN_VALIDO,
  });

  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes'));
  assert.ok(insert, 'debe haberse ejecutado el INSERT');
  assert.ok(insert.params.includes('Examen de Cinta Amarilla'), 'el nombre debe ir en los parametros');
  assert.equal(insert.params.at(-2), 1, 'creado_por debe ser el id del usuario del token');
  assertPlaceholders(insert);
});

test('crear examen guarda la hoja por defecto sin que nadie la suba', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 7, ...EXAMEN_VALIDO }] }) },
  ]);

  await request('POST', '/api/examenes/agregar', { token: token('admin'), body: EXAMEN_VALIDO });

  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes'));
  // La hoja va en el MISMO INSERT, no en una llamada aparte: asi la fila nunca
  // existe sin hoja y un alumno no alcanza a verla sin el boton de descargar.
  assert.match(insert.text, /hoja_inscripcion/, 'la hoja tiene que ir en el INSERT de alta');

  const { HOJA_POR_DEFECTO_BASE64 } = require('../src/config/hojaPorDefecto');
  assert.equal(insert.params.at(-1), HOJA_POR_DEFECTO_BASE64,
    'debe mandar la hoja empaquetada, no un null');
  assert.ok(Buffer.from(insert.params.at(-1), 'base64').subarray(0, 5).toString('latin1') === '%PDF-',
    'lo que se guarda tiene que ser el PDF real');
});

test('sin nombre, fecha invalida o ausente → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const sinNombre = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, nombre: '   ' },
  });
  assert.equal(sinNombre.status, 400);
  assert.match(sinNombre.data.message, /nombre/i);

  const fechaMala = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, fecha_examen: 'no-es-una-fecha' },
  });
  assert.equal(fechaMala.status, 400);

  const { fecha_examen, ...sinFecha } = EXAMEN_VALIDO;
  const sinFechaResp = await request('POST', '/api/examenes/agregar', { token: token('admin'), body: sinFecha });
  assert.equal(sinFechaResp.status, 400);
  assert.match(sinFechaResp.data.message, /fecha y hora de inicio/i);
});

// Sin zona horaria, new Date() resuelve con la del SERVIDOR: el mismo body se
// guardaria a una hora distinta en local (UTC-6) y en Vercel (UTC).
test('fecha de inicio sin zona horaria → 400 en vez de adivinar', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const res = await request('POST', '/api/examenes/agregar', {
    token: token('admin'),
    body: { ...EXAMEN_VALIDO, fecha_examen: '2026-10-15T18:00' },
  });

  assert.equal(res.status, 400);
  assert.match(res.data.message, /zona horaria/i);
});

test('valores que desbordarian la columna → 400 y no 500', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const cupo = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, cupo_maximo: 1e9 },
  });
  assert.equal(cupo.status, 400);
  assert.match(cupo.data.message, /cupo m/i);

  // NUMERIC(10,2) admite 8 digitos enteros; 1e30 llegaria como 22003.
  const precio = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, precio_inscripcion: 1e30 },
  });
  assert.equal(precio.status, 400);
  assert.match(precio.data.message, /precio/i);

  const largo = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, sede: 'a'.repeat(80) },
  });
  assert.equal(largo.status, 400);
  assert.match(largo.data.message, /sede/i);

  const nombreLargo = await request('POST', '/api/examenes/agregar', {
    token: token('admin'), body: { ...EXAMEN_VALIDO, nombre: 'a'.repeat(300) },
  });
  assert.equal(nombreLargo.status, 400);
  assert.match(nombreLargo.data.message, /nombre/i);
});

test('el profesor crea examenes por default, el estudiante no', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 1 }] }) }]);

  const ok = await request('POST', '/api/examenes/agregar', { token: token('profesor'), body: EXAMEN_VALIDO });
  assert.equal(ok.status, 201, 'el profesor debe poder crear examenes');

  install([PERMISOS_VACIO]);
  const no = await request('POST', '/api/examenes/agregar', { token: token('estudiante'), body: EXAMEN_VALIDO });
  assert.equal(no.status, 403, 'el estudiante no debe poder crear examenes');
});

// --- Consulta ---

// El frontend llama GET /api/examenes, sin sufijo. Este test pega a la URL
// EXACTA que usa examenesService.loadAll: con el servicio en /ver y la ruta en
// /, la suite daba verde con la pagina muerta.
test('el listado NO pide la imagen completa, solo el thumbnail', async () => {
  await start();
  const { calls } = install([{ match: 'FROM examenes e', result: () => ({ rows: [{ id: 1 }] }) }]);

  const res = await request('GET', '/api/examenes', { token: token('estudiante') });
  assert.equal(res.status, 200, 'GET /api/examenes debe existir: es la ruta que usa el servicio');

  const list = calls.find((c) => c.text.includes('FROM examenes e'));
  assert.ok(list.text.includes('e.imagen_thumb AS imagen'), 'debe servir el thumbnail bajo el alias');
  assert.ok(!/\be\.imagen\b/.test(list.text), 'no debe mencionar la columna imagen completa, ni como fallback');
  assert.ok(list.text.includes('ORDER BY e.fecha_examen ASC'), 'debe ordenar por fecha, no por id');
  assert.ok(list.text.includes("estado = 'inscrito'"), 'el conteo de inscritos solo cuenta los activos');
  assertPlaceholders(list);

  // El alias de lectura que usa el resto del repo.
  install([{ match: 'FROM examenes e', result: () => ({ rows: [] }) }]);
  const alias = await request('GET', '/api/examenes/ver', { token: token('estudiante') });
  assert.equal(alias.status, 200);
});

test('el detalle si trae la imagen completa', async () => {
  await start();
  const { calls } = install([{ match: 'FROM examenes e', result: () => ({ rows: [{ id: 1, imagen: 'data:image/png;base64,AAA' }] }) }]);

  const res = await request('GET', '/api/examenes/ver/1', { token: token('estudiante') });
  assert.equal(res.status, 200);
  assert.equal(res.data.imagen, 'data:image/png;base64,AAA');

  const detail = calls.find((c) => c.text.includes('FROM examenes e'));
  assertPlaceholders(detail);
});

// Un id de ruta no numerico era 22P02 -> 500 con stack en el log, alcanzable por
// cualquier sesion iniciada.
test('id de ruta no numerico → 404 y no 500', async () => {
  await start();
  install([{ match: 'FROM examenes e', result: () => ({ rows: [] }) }]);

  for (const ruta of ['/api/examenes/ver/abc', '/api/examenes/ver/-1', '/api/examenes/ver/1.5', '/api/examenes/ver/0']) {
    const res = await request('GET', ruta, { token: token('estudiante') });
    assert.equal(res.status, 404, `${ruta} debe devolver 404`);
  }
});

// --- Edicion y borrado ---

test('editar requiere el permiso editar y devuelve 404 si no existe', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'UPDATE examenes SET', result: () => ({ rows: [] }) }]);

  const res = await request('PUT', '/api/examenes/editar/999', { token: token('profesor'), body: EXAMEN_VALIDO });
  assert.equal(res.status, 404);

  install([PERMISOS_CON(['examenes:ver_inscritos'])]);
  const sinPermiso = await request('PUT', '/api/examenes/editar/1', { token: token('profesor'), body: EXAMEN_VALIDO });
  assert.equal(sinPermiso.status, 403, 'sin examenes:editar debe rebotar');
});

test('editar existente → 200, refresca updated_at y no toca la imagen', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'UPDATE examenes SET', result: () => ({ rows: [{ id: 3, ...EXAMEN_VALIDO }] }) },
  ]);

  const res = await request('PUT', '/api/examenes/editar/3', { token: token('profesor'), body: EXAMEN_VALIDO });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('UPDATE examenes SET'));
  assert.ok(update.text.includes('updated_at = NOW()'), 'debe refrescar updated_at');
  assert.ok(!update.text.includes('imagen'), 'la imagen va en su propia ruta, no en el PUT');
  assertPlaceholders(update);
});

test('eliminar examen inexistente → 404, existente → mensaje', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'DELETE FROM examenes', result: () => ({ rows: [] }) }]);
  const noExiste = await request('DELETE', '/api/examenes/eliminar/5', { token: token('admin') });
  assert.equal(noExiste.status, 404);

  install([PERMISOS_VACIO, { match: 'DELETE FROM examenes', result: () => ({ rows: [{ id: 5 }] }) }]);
  const ok = await request('DELETE', '/api/examenes/eliminar/5', { token: token('admin') });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.message, 'examen eliminado');
});

test('quitar la imagen la borra de verdad', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SET imagen = NULL', result: () => ({ rows: [{ id: 5 }] }) },
  ]);

  const res = await request('DELETE', '/api/examenes/5/imagen', { token: token('profesor') });
  assert.equal(res.status, 200);
  assert.ok(calls.find((c) => c.text.includes('SET imagen = NULL')), 'debe nullar ambas columnas');
});

// --- Inscripcion ---

test('el alumno se inscribe en un examen programado → 201', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante', 3), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 201);

const insert = calls.find((c) => c.text.includes('INSERT INTO examenes_inscripciones'));
  // parseId normaliza el id de ruta a entero, asi que ya no llega como texto.
  // Los tres primeros son examen, alumno resuelto del token y usuario. Los cinco
  // siguientes son el snapshot que el alumno escribio. El ultimo NO lo escribio:
  // lo impone el servidor con NOMBRE_ESCUELA, porque todos son de AMTKD.
  //
  // Los doce ultimos son el bloque de la hoja "SOLICITUD DE EXAMEN". Este test
  // manda el cuerpo MINIMO (sin ningun campo de la hoja), asi que los doce van en
  // null: es el caso de una inscripcion vieja o de un cliente que no conoce la
  // hoja, y tiene que seguir siendo valida.
  assert.deepEqual(
    insert.params,
    [
      5, 22, 3,
      'Juan Carlos', 'García', 'Hernández', 12, '4to', 'AMTKD',
      null, null, null,
      null, null, null,
      null, null, null,
      null, null, null,
    ],
    'el alumno_id se resuelve del token, la escuela la impone el servidor y los datos van en su propio orden'
  );
  assert.ok(calls.some((c) => c.text.includes('FOR UPDATE')), 'el cupo se bloquea con FOR UPDATE');
});

// La escuela del cuerpo se ignora en el alta. Sin esto, el backend aceptaria que
// alguien llame la API a mano y guarde cualquier escuela, y la columna empezaria
// a juntar valores que nadie puede ver en el modal.
test('el alta ignora la escuela que mande el cuerpo → guarda AMTKD', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    body: { ...DATOS_INSCRIPCION, escuela: 'Otra Escuela Inventada' },
  });
  assert.equal(res.status, 201);

  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes_inscripciones'));
  assert.equal(insert.params[8], 'AMTKD', 'la escuela del cuerpo no llega al INSERT');
});

test('el alumno no puede forjar el alumno_id desde el body', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    // Los datos validos mas un alumno_id inventado. La validacion del cuerpo no
    // debe filtrarse por el campo sobrante.
    body: { ...DATOS_INSCRIPCION, alumno_id: 999, usuario_id: 77 },
  });

  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes_inscripciones'));
  assert.ok(insert, 'debe haberse insertado');
  assert.ok(!insert.params.includes(999), 'el alumno_id del body debe ignorarse');
  assert.ok(!insert.params.includes(77), 'el usuario_id del body debe ignorarse');
  assert.equal(insert.params[1], 22, 'debe usarse el alumno ligado al token');
  assert.equal(insert.params[2], 3, 'debe usarse el usuario del token');
});

test('cancelado, finalizado o ya ocurrido → 400 sin tocar la inscripcion', async () => {
  await start();

  install(handlersInscripcion([{ match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'cancelado', cupo_maximo: null }] }) }]));
  const cancelado = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(cancelado.status, 400);
  assert.match(cancelado.data.message, /cancelado/i);

  install(handlersInscripcion([{ match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'finalizado', cupo_maximo: null }] }) }]));
  const finalizado = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(finalizado.status, 400);
  assert.match(finalizado.data.message, /ya se lleva a cabo/i);

  // La fecha no se miraba antes: un curl a un examen del mes pasado devolvia 201.
  install(handlersInscripcion([{ match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', fecha_examen: '2020-01-01T00:00:00.000Z', cupo_maximo: null }] }) }]));
  const pasado = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(pasado.status, 400);
  assert.match(pasado.data.message, /ya se llevó a cabo/i);
});

test('inscribirse sin registro de alumno → 404', async () => {
  await start();
  install([{ match: 'FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [] }) }]);

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 404);
  assert.match(res.data.message, /registro de alumno/i);
});

test('cupo lleno → 400 antes de intentar el INSERT', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 1 }] }) },
    { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '1' }] }) },
  ]));

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /lugares disponibles/i);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO examenes_inscripciones')), 'no debe insertar si el cupo esta lleno');
});

// Con el cupo ya lleno, el alumno que YA tiene lugar recibia "ya no hay lugares".
test('quien ya esta inscrito recibe 200, no el error de cupo lleno', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'FROM examenes WHERE id = $1 FOR UPDATE', result: () => ({ rows: [{ id: 5, estado: 'programado', cupo_maximo: 1 }] }) },
    { match: 'SELECT id, estado FROM examenes_inscripciones', result: () => ({ rows: [{ id: 8, estado: 'inscrito' }] }) },
    { match: 'SELECT COUNT(*) AS total', result: () => ({ rows: [{ total: '1' }] }) },
  ]));

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.text.includes('SELECT COUNT(*)')), 'no debe contar el cupo si ya tiene lugar');
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO examenes_inscripciones')), 'no debe duplicar la fila');
});

test('doble inscripcion simultanea (23505) → 400 con mensaje entendible', async () => {
  await start();
  const err = new Error('duplicate key');
  err.code = '23505';
  install(handlersInscripcion([{ match: 'INSERT INTO examenes_inscripciones', result: () => { throw err; } }]));

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /ya est/i);
});

test('reinscribirse tras cancelar reactiva la fila en vez de duplicar', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'SELECT id, estado FROM examenes_inscripciones', result: () => ({ rows: [{ id: 9, estado: 'cancelada' }] }) },
    // El match va sobre `UPDATE examenes_inscripciones SET` y no sobre
    // `estado = 'inscrito'`: el mockPool compara subcadenas, y el COUNT del cupo
    // tambien termina en `AND estado = 'inscrito'`, asi que un match laxo se
    // tragaria esa consulta y devolveria filas de la reactivacion para el conteo.
    { match: 'UPDATE examenes_inscripciones SET', result: () => ({ rows: [{ id: 9 }] }) },
  ]));

  const res = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: DATOS_INSCRIPCION });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, 9);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO examenes_inscripciones')), 'no debe crear una segunda fila');
});

test('cancelar inscripcion → mensaje; sin inscripcion activa → 404', async () => {
  await start();
  install([
    SIN_ALUMNO,
    { match: "SET estado = 'cancelada'", result: () => ({ rows: [{ id: 4 }] }) },
  ]);
  const ok = await request('DELETE', '/api/examenes/5/inscribirse', { token: token('estudiante') });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.message, 'Inscripción cancelada');

  install([
    SIN_ALUMNO,
    { match: "SET estado = 'cancelada'", result: () => ({ rows: [] }) },
  ]);
  const nada = await request('DELETE', '/api/examenes/5/inscribirse', { token: token('estudiante') });
  assert.equal(nada.status, 404);
});

// --- Datos del alumno al inscribirse ---

// El endpoint acepta un cuerpo vacio desde cualquier sesion de estudiante, y lo
// que valida mal acaba impreso en la lista de asistencia del torneo: una fila
// sin nombre no se nota en la base, se nota el dia del examen.
test('inscribirse sin datos → 400 y sin tocar la base', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  const vacio = await request('POST', '/api/examenes/5/inscribirse', { token: token('estudiante'), body: {} });
  assert.equal(vacio.status, 400);
  assert.match(vacio.data.message, /nombre/i);
  assert.ok(!calls.some((c) => c.text.includes('INSERT INTO examenes_inscripciones')), 'no debe insertar');

  // `escuela` no va en la lista: el alta la impone el servidor, asi que mandarla
  // en blanco ya no es un dato faltante. Ver el test de mas abajo, que sigue
  // exigiendola en la correccion del entrenador.
  for (const campo of ['primer_apellido', 'grado']) {
    install(handlersInscripcion());
    const res = await request('POST', '/api/examenes/5/inscribirse', {
      token: token('estudiante'),
      body: { ...DATOS_INSCRIPCION, [campo]: '   ' },
    });
    assert.equal(res.status, 400, `sin ${campo} debe rebotar`);
  }
});

// El trainer sigue pudiendo corregir la escuela de una inscripcion vieja. Por eso
// el alta ignora el campo pero esta ruta no: es el unico camino para arreglar un
// expediente con el nombre mal escrito.
test('corregir sin escuela → 400; corregir con escuela → la guarda', async () => {
  await start();

  // El PATCH exige `editar:examenes`; sin este handler el permiso falla con 403
  // y el test pasaria por el motivo equivocado.
  const editar = ['examenes:editar:examenes'];

  install([PERMISOS_CON(editar)]);
  const sin = await request('PATCH', '/api/examenes/5/inscritos/9', {
    token: token('profesor'),
    body: { ...DATOS_INSCRIPCION, escuela: '   ' },
  });
  assert.equal(sin.status, 400, 'la correccion si exige la escuela');

  const { calls } = install([
    PERMISOS_CON(editar),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 9 }] }) },
  ]);
  const con = await request('PATCH', '/api/examenes/5/inscritos/9', {
    token: token('profesor'),
    body: { ...DATOS_INSCRIPCION, escuela: 'Escuela Corregida' },
  });
  assert.equal(con.status, 200);
  const update = calls.find((c) => c.text.includes('UPDATE examenes_inscripciones'));
  assert.ok(update.params.includes('Escuela Corregida'), 'el trainer si puede corregir la escuela');
});

test('edad fuera de rango o no entera → 400; vacia o valida → pasa', async () => {
  await start();

  for (const edad of [3, 100, 12.5, 'doce', -1]) {
    install(handlersInscripcion());
    const res = await request('POST', '/api/examenes/5/inscribirse', {
      token: token('estudiante'),
      body: { ...DATOS_INSCRIPCION, edad },
    });
    assert.equal(res.status, 400, `edad ${JSON.stringify(edad)} debe rebotar`);
    assert.match(res.data.message, /edad/i);
  }

  // La edad es la unica opcional: un alumno que no la tiene a mano deja el
  // hueco en vez de que el backend le invente un numero.
  for (const edad of [null, undefined, '']) {
    install(handlersInscripcion());
    const res = await request('POST', '/api/examenes/5/inscribirse', {
      token: token('estudiante'),
      body: { ...DATOS_INSCRIPCION, edad },
    });
    assert.equal(res.status, 201, `edad ${JSON.stringify(edad)} deberia aceptarse como vacia`);
  }
});

test('los datos del snapshot se guardan en el INSERT y al reactivar', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'SELECT id, estado FROM examenes_inscripciones', result: () => ({ rows: [{ id: 9, estado: 'cancelada' }] }) },
    // El match va sobre `UPDATE examenes_inscripciones SET` y no sobre
    // `estado = 'inscrito'`: el mockPool compara subcadenas, y el COUNT del cupo
    // tambien termina en `AND estado = 'inscrito'`, asi que un match laxo se
    // tragaria esa consulta y devolveria filas de la reactivacion para el conteo.
    { match: 'UPDATE examenes_inscripciones SET', result: () => ({ rows: [{ id: 9 }] }) },
  ]));

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante'),
    body: { ...DATOS_INSCRIPCION, escuela: 'Otra Escuela' },
  });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('UPDATE examenes_inscripciones SET'));
  assert.ok(update, 'debe reactivar la fila existente');
  assert.ok(update.text.includes('escuela = $7'), 'la reactivacion tambien actualiza el snapshot');
  // La reactivación va por la ruta del alta, asi que tambien lleva la escuela
  // impuesta. Reinscribirse no es el camino para corregir una escuela: ese es el
  // PATCH del entrenador.
  assert.ok(update.params.includes('AMTKD'), 'la escuela la impone el servidor tambien al reactivar');
  assertPlaceholders(update);
});

// --- Hoja "SOLICITUD DE EXAMEN": el bloque del alumno ---

// El bloque completo de la hoja, tal cual lo manda el modal.
const SOLICITUD = {
  numero_examen: '7',
  direccion: 'Calle Reforma 123, Centro, Progreso',
  telefono: '55 1234 5678',
  fecha_nacimiento: '2014-03-11',
  fecha_ingreso: '2019-08-15',
  grado_a_pasar: '5to',
  fecha_examen_anterior: '2025-10-20',
  fecha_ultimo_torneo: '2026-05-09',
  fecha_solicitud: '2026-09-30',
  profesor_autoriza: 'Sensei Arturo Ramírez',
  // Payload inventado pero con la forma que valida el backend: prefijo correcto
  // y solo base64 despues.
  firma_solicitante: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  firma_padre: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
};

test('la hoja se guarda junto con la inscripcion, sin el prefijo de las firmas', async () => {
  await start();
  const { calls } = install(handlersInscripcion());

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    body: { ...DATOS_INSCRIPCION, ...SOLICITUD },
  });
  assert.equal(res.status, 201);

  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes_inscripciones'));
  assertPlaceholders(insert);
  assert.ok(insert.text.includes('numero_examen'), 'la hoja se inserta, no se guarda aparte');

  // La firma entra SIN el prefijo: el prefijo es constante y solo ocupa espacio en
  // cada fila. Si se guardara entero habria que hacer slicing a mano al pintar.
  const indiceFirmaSolicitante = insert.params.indexOf('iVBORw0KGgoAAAANSUhEUg==');
  assert.ok(indiceFirmaSolicitante > 0, 'el payload de la firma llega al INSERT');
  assert.equal(
    insert.params.filter((p) => typeof p === 'string' && p.startsWith('data:')).length,
    0,
    'ninguna firma viaja con el prefijo data:'
  );

  assert.equal(insert.params[9], '7', 'el numero de examen va en su columna');
  assert.equal(insert.params[12], '2014-03-11', 'la fecha de nacimiento va como YYYY-MM-DD');
});

// La validacion de fecha NO puede ser `new Date(valor)`: "2026-02-31" tiene la
// forma correcta y new Date la normaliza en silencio a 3 de marzo, que es una
// fecha que nadie escribio.
test('una fecha que no existe se rechaza en vez de normalizarse', async () => {
  await start();
  install(handlersInscripcion());

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    body: { ...DATOS_INSCRIPCION, ...SOLICITUD, fecha_nacimiento: '2026-02-31' },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /fecha de nacimiento/i);
});

// La lista de prefijos es una lista y no un `startsWith('data:')`. Aceptar
// cualquier tipo MIME guardaria un `data:text/html` en la base, y el dia que eso
// se pinte sin escapar seria XSS servido desde la propia API.
test('una firma que no es imagen se rechaza', async () => {
  await start();
  install(handlersInscripcion());

  for (const firma of [
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'javascript:alert(1)',
  ]) {
    const res = await request('POST', '/api/examenes/5/inscribirse', {
      token: token('estudiante', 3),
      body: { ...DATOS_INSCRIPCION, ...SOLICITUD, firma_solicitante: firma },
    });
    assert.equal(res.status, 400, `debe rechazar ${firma.slice(0, 30)}`);
    assert.match(res.data.message, /firma del solicitante/i);
  }
});

// El prefijo correcto no alcanza: despues tiene que haber base64 y nada mas. Con
// solo validar el prefijo, "data:image/png;base64,<script>alert(1)</script>"
// pasaria y al volver a ponerlo en un <img> no seria una imagen.
test('una firma con prefijo valido pero basura dentro se rechaza', async () => {
  await start();
  install(handlersInscripcion());

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    body: {
      ...DATOS_INSCRIPCION,
      ...SOLICITUD,
      firma_solicitante: 'data:image/png;base64,<script>alert(1)</script>',
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /no es una imagen v/i);
});

// Las firmas viajan en el JSON, y express.json esta en `limit: '1mb'`. Con 300 KB
// por firma las dos caben con el resto del cuerpo, asi que el 413 de Vercel no
// puede aparecer. Con el limite viejo (400 KB) este mismo test lo dispara.
test('el limite de firma deja pasar dos firmas dentro del body de 1mb', async () => {
  await start();
  install(handlersInscripcion());

  const grande = 'A'.repeat(300 * 1024);
  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante', 3),
    body: {
      ...DATOS_INSCRIPCION,
      ...SOLICITUD,
      firma_solicitante: `data:image/png;base64,${grande}`,
      firma_padre: `data:image/png;base64,${grande}`,
    },
  });
  assert.equal(res.status, 201, 'dos firmas del tamano maximo siguen siendo un body valido');
});

// Reinscribirse tras cancelar deja el examen SIN CALIFICAR. Las calificaciones
// que habia eran de la presentacion anterior, y dejarlas pegadas a una inscripcion
// nueva haria que un alumno saliera con el veredicto de un intento que ya no
// existe.
test('reinscribirse borra el bloque de la institucion', async () => {
  await start();
  const { calls } = install(handlersInscripcion([
    { match: 'SELECT id, estado FROM examenes_inscripciones', result: () => ({ rows: [{ id: 9, estado: 'cancelada' }] }) },
    { match: 'UPDATE examenes_inscripciones SET', result: () => ({ rows: [{ id: 9 }] }) },
  ]));

  const res = await request('POST', '/api/examenes/5/inscribirse', {
    token: token('estudiante'),
    body: { ...DATOS_INSCRIPCION, ...SOLICITUD },
  });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('UPDATE examenes_inscripciones SET'));
  assert.ok(update.text.includes('aprobado = NULL'), 'el veredicto anterior se borra');
  assert.ok(update.text.includes('calificado_at = NULL'), 'la marca de calificado se borra');
  assertPlaceholders(update);
});

// --- Bloque "PARA USO EXCLUSIVO DE LA INSTITUCION" ---

const CALIFICACION = {
  record_asistencia: 72.5,
  cal_basicos: 88,
  cal_rompimientos: 90,
  cal_pateo: 85,
  cal_combate_libre: 92,
  cal_formas: 87,
  cal_defensa_personal: 89,
  nota_combate_un_paso: 'Lectura correcta del paso',
  nota_pateo_saltando: 'Buena altura de salto',
  comentarios: 'Alumno destacado',
  aprobado: true,
  firma_examinador: 'data:image/png;base64,iVBORw0KGgo=',
};

test('la calificacion se guarda con el examen y la inscripcion que se le pasaron', async () => {
  await start();
  const { calls } = install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 12, aprobado: true }] }) },
  ]);

  const res = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: CALIFICACION,
  });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('cal_basicos'));
  assertPlaceholders(update);
  assert.ok(update.text.includes('examen_id = $2'), 'el filtro de pertenencia es lo que cierra el acceso cruzado');
  // El orden del UPDATE: $1 inscripcion, $2 examen, $3 record, $4-$9 las seis
  // areas, $10-$12 las tres notas, $13 el veredicto, $14 la firma. Con indice de
  // array son 12 y 13 porque el array es de base cero. `assertPlaceholders` arriba
  // es lo que garantiza que no falte ninguno.
  assert.equal(update.params[0], 12);
  assert.equal(update.params[1], 5);
  assert.equal(update.params[2], 72.5, 'el record llega como numero, no como texto');
  assert.equal(update.params[12], true, 'el veredicto viaja como booleano');
  assert.equal(update.params[13], 'iVBORw0KGgo=', 'la firma llega sin el prefijo data:');
});

// `aprobado` es triestado. Sin esto, un alumno recien inscrito apareceria como
// reprobado en cualquier reporte que leyera el booleano sin mirar si tiene
// calificacion.
test('un alumno sin calificar se guarda con aprobado NULL, no en false', async () => {
  await start();
  const { calls } = install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 12, aprobado: null }] }) },
  ]);

  const res = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: { ...CALIFICACION, aprobado: null },
  });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('cal_basicos'));
  assert.equal(update.params[12], null, 'sin calificar es NULL y no false');
});

// Una nota por encima de 100 no es una nota: es un dedo mal puesto o un payload
// automatizado. Y un 0 SI es valido, asi que el vacio y el cero no se mezclan.
test('las calificaciones se validan entre 0 y 100', async () => {
  await start();
  install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 12 }] }) },
  ]);

  const alta = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: { ...CALIFICACION, cal_basicos: 101 },
  });
  assert.equal(alta.status, 400);
  assert.match(alta.data.message, /básicos/i);

  const texto = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: { ...CALIFICACION, cal_pateo: 'ochenta' },
  });
  assert.equal(texto.status, 400);

  const cero = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: { ...CALIFICACION, cal_pateo: 0 },
  });
  assert.equal(cero.status, 200, 'un 0 es una nota real, no un campo vacio');
});

// Calificar es un juicio del entrenador. Si el alumno pudiera llamar esta ruta se
// aprobaria a si mismo, asi que `editar` y no el permiso de solo ver la lista.
test('calificar exige editar, no basta con ver la lista de inscritos', async () => {
  await start();
  install([
    PERMISOS_CON(['examenes:ver:reporte_examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 12 }] }) },
  ]);

  const res = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('profesor'),
    body: CALIFICACION,
  });
  assert.equal(res.status, 403);
});

test('un estudiante no puede calificar ni a si mismo', async () => {
  await start();
  install([
    PERMISOS_CON(['examenes:ver:reporte_examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 12 }] }) },
  ]);

  const res = await request('PUT', '/api/examenes/5/inscritos/12/calificacion', {
    token: token('estudiante', 3),
    body: CALIFICACION,
  });
  assert.equal(res.status, 403);
});

// El `examen_id = $2` del WHERE no es redundante con el id de la ruta: sin el, un
// profesor con `editar` pasa el id de una inscripcion de CUALQUIER examen y la
// califica. El filtro es lo que cierra eso, y 404 es la respuesta correcta para no
// confirmar siquiera que el id existe.
test('no se puede calificar una inscripcion de otro examen', async () => {
  await start();
  install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [] }) },
  ]);

  const res = await request('PUT', '/api/examenes/5/inscritos/999/calificacion', {
    token: token('profesor'),
    body: CALIFICACION,
  });
  assert.equal(res.status, 404);
});

// --- Resultados del alumno (/mis-resultados) ---

// El alumno ve SUS resultados. La autorizacion no es un permiso: es el WHERE
// armado con `usuario_id = req.user.id`, que sale del token. Por eso el test
// mira el parametro que llego, no solo el status: un 200 con el id equivocado
// seria una fuga de datos ajenos y pasaria igual.
test('mis-resultados devuelve solo las filas del usuario del token', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM examenes_inscripciones ei', result: () => ({ rows: [] }) },
  ]);

  const res = await request('GET', '/api/examenes/mis-resultados', { token: token('estudiante', 3) });
  assert.equal(res.status, 200);

  const select = calls.find((c) => c.text.includes('FROM examenes_inscripciones ei'));
  assert.ok(select, 'la ruta debe consultar examenes_inscripciones');
  assert.ok(select.text.includes('ei.usuario_id = $1'), 'filtra por el usuario de la sesion');
  assert.equal(select.params[0], 3, 'el id sale del token, no de un parametro del request');
  assertPlaceholders(select);
});

// Un alumno sin `ver:reporte_examenes` (que es el default del rol estudiante) tiene
// que poder ver SUS notas. Si esta ruta exigiera ese permiso, caeria en el mismo
// 403 que la lista de inscritos y la pantalla nueva no serviria para nadie.
test('mis-resultados no exige ver:reporte_examenes', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    { match: 'FROM examenes_inscripciones ei', result: () => ({ rows: [] }) },
  ]);

  const res = await request('GET', '/api/examenes/mis-resultados', { token: token('estudiante', 3) });
  assert.equal(res.status, 200, 'un estudiante sin permisos de reporte ve sus propios resultados');
});

// Solo los exámenes con veredicto. Un alumno inscrito que todavía no fue
// calificado no debe ver una hoja vacía presentada como si fuera su resultado:
// `aprobado IS NOT NULL` es "tiene veredicto", y `calificado_at` NO sirve
// porque un alumno que se reinscribió conserva el timestamp viejo con las notas
// ya borradas.
test('mis-resultados filtra por aprobado, no por calificado_at', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM examenes_inscripciones ei', result: () => ({ rows: [] }) },
  ]);

  await request('GET', '/api/examenes/mis-resultados', { token: token('estudiante', 3) });

  const select = calls.find((c) => c.text.includes('FROM examenes_inscripciones ei'));
  assert.ok(select.text.includes('ei.aprobado IS NOT NULL'), 'solo los que tienen veredicto');
  assert.ok(
    !select.text.includes('ei.calificado_at IS NOT NULL'),
    'calificado_at marca el ultimo PUT, no "tiene veredicto"'
  );
  assert.ok(select.text.includes("ei.estado = 'inscrito'"), 'una inscripcion cancelada no sale');
});

// Sin token no hay usuario del que armar el WHERE, asi que 401. Si cayera en el
// 403 del permiso, el mensaje le diria al alumno que le falta un permiso que si
// tiene.
test('mis-resultados exige sesion', async () => {
  await start();
  install([PERMISOS_VACIO]);

  const res = await request('GET', '/api/examenes/mis-resultados');
  assert.equal(res.status, 401);
});

// La ruta esta declarada ANTES de `/:id/inscritos`. Si se moviera despues,
// Express evaluaria `/mis-resultados` contra el `/:id` de esa ruta, `parseId`
// recibiria "mis-resultados" y responderia 404 sin llegar al handler: el endpoint
// existiria en el codigo y devolveria 404 en produccion.
test('mis-resultados no cae en el :id de la ruta de inscritos', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM examenes_inscripciones ei', result: () => ({ rows: [] }) },
  ]);

  const res = await request('GET', '/api/examenes/mis-resultados', { token: token('estudiante', 3) });
  assert.equal(res.status, 200, 'llego al handler, no al parseId de /:id/inscritos');
  assert.ok(calls.some((c) => c.text.includes('FROM examenes_inscripciones ei')));
});

// --- Sede ---


// La sede es una lista cerrada de las dos sedes de la academia, validada en el
// backend y no solo en el <select>: sin esto un POST crudo metería una sede que
// nadie mas conoce. Se pueden marcar las dos (torneo en ambas sedes a la vez),
// asi que se valida cada parte del par, no la cadena entera.
test('sede acepta las dos juntas, normaliza el orden y rechaza lo ajena', async () => {
  await start();

  const alta = (sede) => {
    install([PERMISOS_VACIO, { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 1 }] }) }]);
    return request('POST', '/api/examenes/agregar', { token: token('admin'), body: { ...EXAMEN_VALIDO, sede } });
  };

  // Cualquiera de las dos, o las dos, pasa; vacio tambien (examen sin sede fija).
  for (const sede of ['Progreso', 'Morelos', 'Progreso, Morelos', '']) {
    const res = await alta(sede);
    assert.equal(res.status, 201, `la sede ${JSON.stringify(sede)} deberia aceptarse`);
  }

  // "Progreso, Cholula" NO debe pasar: validar la cadena entera comparandola a
  // "Progreso" daria falso (no son iguales) y la dejaria entrar.
  const ajena = await alta('Progreso, Cholula');
  assert.equal(ajena.status, 400);
  assert.match(ajena.data.message, /cholula/i);

  const tres = await alta('Progreso, Morelos, Progreso');
  assert.equal(tres.status, 400, 'no se pueden marcar mas de dos');

  // Orden canonico: "Morelos , Progreso" se guarda como "Progreso, Morelos", para
  // que el buscador y los filtros no traten dos ordenes como examenes distintos.
  const { calls } = install([PERMISOS_VACIO, { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 1 }] }) }]);
  const res = await request('POST', '/api/examenes/agregar', {
    token: token('admin'),
    body: { ...EXAMEN_VALIDO, sede: 'Morelos , Progreso' },
  });
  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes'));
  assert.equal(insert.params[3], 'Progreso, Morelos', 'la sede se guarda en el orden canonico');
});

// Las categorias son lista ABIERTA: el arbitro de un torneo abierto puede
// arbitrar una cinta que la academia aun no teachings, y bloquearla dejaria al
// entrenador sin poder registrar el examen. Se normalizan (sin duplicados ni
// espacios sueltos), no se restringen.
test('niveles: normaliza, deduplica y acepta cualquier cinta', async () => {
  await start();
  const { calls } = install([PERMISOS_VACIO, { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 1 }] }) }]);

  const res = await request('POST', '/api/examenes/agregar', {
    token: token('admin'),
    body: { ...EXAMEN_VALIDO, niveles: ' Blanca ,  Verde ,blanca , Azul ' },
  });
  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes'));
  assert.equal(insert.params[5], 'Blanca, Verde, Azul', 'espacios y duplicados fuera, orden de llegada');
});

// --- Inscritos ---

// La tarjeta contaba solo activos y el modal listaba todos: 3 cancelados
// inflaban la lista y el profesor llamaba a familias que ya habian salido.
test('ver inscritos solo trae los activos y exige el permiso', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT id FROM examenes WHERE id = $1', result: () => ({ rows: [{ id: 5 }] }) },
    { match: 'FROM examenes_inscripciones ei', result: () => ({ rows: [] }) },
  ]);

  const res = await request('GET', '/api/examenes/5/inscritos', { token: token('profesor') });
  assert.equal(res.status, 200, 'el profesor lo tiene por default');

  const query = calls.find((c) => c.text.includes('FROM examenes_inscripciones ei'));
  assert.ok(query.text.includes("ei.estado = 'inscrito'"), 'debe filtrar los cancelados');
  assertPlaceholders(query);

  install([PERMISOS_CON(['examenes:crear'])]);
  const sinPermiso = await request('GET', '/api/examenes/5/inscritos', { token: token('profesor') });
  assert.equal(sinPermiso.status, 403);
});

test('ver inscritos de un examen inexistente → 404', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'SELECT id FROM examenes WHERE id = $1', result: () => ({ rows: [] }) }]);

  const res = await request('GET', '/api/examenes/77/inscritos', { token: token('admin') });
  assert.equal(res.status, 404);
});

// --- Seguridad ---

test('SQLi: un nombre malicioso viaja en los parametros, no concatenado', async () => {
  await start();
  const payload = "'; DROP TABLE examenes;--";
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'INSERT INTO examenes', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('POST', '/api/examenes/agregar', {
    token: token('admin'),
    body: { ...EXAMEN_VALIDO, nombre: payload },
  });

  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.includes('INSERT INTO examenes'));
  assert.ok(!insert.text.includes(payload), 'el payload no debe aparecer en el SQL');
  assert.ok(insert.params.includes(payload), 'el payload debe ir parametrizado');
});

// Las rutas alias duplicadas (POST /, PUT /:id, DELETE /:id) se eliminaron a
// proposito: no las usa el frontend y cada copia duplicada es una superficie de
// 403 que mantener.

// --- Imagen: multipart a mano ---
//
// El thumbnail es lo que consume el listado. Sin validarlo, un caller con
// examenes:editar puede reintroducir por la puerta de atras los 2.67MB por
// examen que tumban la respuesta de Vercel, y escribir bytes arbitrarios en una
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
  const tipoMalo = await multipart(server, '/api/examenes/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.from('<svg onload=alert(1)>')], { type: 'image/svg+xml' }),
  });
  assert.equal(tipoMalo.status, 400, 'un SVG no debe aceptarse como miniatura');
  assert.match((await tipoMalo.json()).message, /miniatura/i);

  // El peso del thumbnail tiene su propio techo: 400KB pasaria el limite
  // generico de multer (2MB por archivo) y volveria al listado igual.
  install([PERMISOS_VACIO]);
  const pesoMalo = await multipart(server, '/api/examenes/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(400 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(pesoMalo.status, 400, 'una miniatura de 400KB debe rechazarse');
  assert.match((await pesoMalo.json()).message, /miniatura/i);

  // Y el camino feliz guarda ambas columnas.
  install([PERMISOS_VACIO, { match: 'SET imagen = $1', result: () => ({ rows: [{ id: 5, imagen_thumb: 'data:image/jpeg;base64,AAA' }] }) }]);
  const ok = await multipart(server, '/api/examenes/5/imagen', auth, {
    imagen: new Blob([Buffer.from('fake-jpeg')], { type: 'image/jpeg' }),
    imagen_thumb: new Blob([Buffer.alloc(40 * 1024, 1)], { type: 'image/jpeg' }),
  });
  assert.equal(ok.status, 200, 'una miniatura valida debe aceptarse');
});

test('la imagen exige contenido: sin archivo → 400', async () => {
  await start();
  install([PERMISOS_VACIO]);

  // Sin cuerpo multipart multer deja req.files vacio y el handler responde 400.
  const res = await request('POST', '/api/examenes/5/imagen', { token: token('profesor') });
  assert.equal(res.status, 400);
});

test('las rutas alias de escritura ya no existen', async () => {
  await start();
  install([PERMISOS_VACIO, { match: 'UPDATE examenes SET', result: () => ({ rows: [{ id: 1 }] }) }]);

  const put = await request('PUT', '/api/examenes/1', { token: token('admin'), body: EXAMEN_VALIDO });
  assert.equal(put.status, 404, 'PUT /:id no debe existir');

  install([PERMISOS_VACIO]);
  const post = await request('POST', '/api/examenes', { token: token('admin'), body: EXAMEN_VALIDO });
  assert.equal(post.status, 404, 'POST / no debe existir');
});

// --- Correccion de los datos de una inscripcion ---

test('corregir una inscripcion actualiza el snapshot y exige `editar:examenes`', async () => {
  await start();

  // Con solo `ver:reporte_examenes` se puede mirar la lista pero no escribir en ella.
  install([PERMISOS_CON(['examenes:ver:reporte_examenes']), { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [] }) }]);
  const sinPermiso = await request('PATCH', '/api/examenes/5/inscritos/9', {
    token: token('profesor'),
    body: DATOS_INSCRIPCION,
  });
  assert.equal(sinPermiso.status, 403, 'ver:reporte_examenes no debe alcanza para escribir');

  // Con `editar:examenes` si, y escribe los seis campos.
  const { calls } = install([
    PERMISOS_CON(['examenes:ver:reporte_examenes', 'examenes:editar:examenes']),
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 9 }] }) },
  ]);
  const res = await request('PATCH', '/api/examenes/5/inscritos/9', {
    token: token('profesor'),
    body: { ...DATOS_INSCRIPCION, edad: 12, escuela: 'Escuela Central' },
  });
  assert.equal(res.status, 200);

  const update = calls.find((c) => c.text.includes('UPDATE examenes_inscripciones'));
  assertPlaceholders(update);
  assert.match(update.text, /examen_id = \$2/, 'el UPDATE debe filtrar por examen, no solo por id de inscripcion');
  assert.match(update.text, /edad = \$6/);
  assert.match(update.text, /escuela = \$8/);
  assert.equal(update.params[1], 5, 'el examen de la ruta viaja como parametro');
  assert.equal(update.params[2], DATOS_INSCRIPCION.nombre);
  assert.equal(update.params[7], 'Escuela Central');
});

// La seguridad de esta ruta es el filtro de pertenencia. Sin el, un profesor
// con `editar:examenes` podria pasar el id de una inscripcion de otro torneo y escribirle
// datos, y el id de una inscripcion es un entero correlativo y adivinable.
test('corregir una inscripcion de OTRO examen responde 404 y no escribe', async () => {
  await start();
  const { calls } = install([
    PERMISOS_CON(['examenes:editar:examenes']),
    // Cero filas: es lo que devuelve Postgres cuando el WHERE no casa.
    { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [] }) },
  ]);

  const res = await request('PATCH', '/api/examenes/5/inscritos/999', {
    token: token('profesor'),
    body: DATOS_INSCRIPCION,
  });
  assert.equal(res.status, 404);
  assert.match(res.data.message, /no pertenece/i);

  // El UPDATE si se ejecuto (con un id que no existe); lo que se evita es que
  // devuelva exito. Si el dia de manana se agrega un SELECT de pertenencia
  // previo, esta asercion avisa que el UPDATE paso a no tocarse.
  const update = calls.find((c) => c.text.includes('UPDATE examenes_inscripciones'));
  assert.ok(update, 'el UPDATE debe llevar el filtro de pertenencia, no omitirse');
  assertPlaceholders(update);
});

// La validacion es la misma que al inscribirse, con una diferencia: el alta
// ignora la escuela porque la impone el servidor, y esta correccion no, porque es
// el unico camino para arreglar una inscripcion vieja mal escrita. Por eso
// 'escuela' sigue valiendo aqui.
test('corregir valida los datos igual que al inscribirse', async () => {
  await start();

  const casos = [
    [{ ...DATOS_INSCRIPCION, nombre: '   ' }, 'nombre'],
    [{ ...DATOS_INSCRIPCION, grado: '' }, 'grado'],
    [{ ...DATOS_INSCRIPCION, escuela: '' }, 'escuela'],
    [{ ...DATOS_INSCRIPCION, edad: 3 }, 'edad'],
    [{ ...DATOS_INSCRIPCION, edad: 150 }, 'edad'],
    [{ ...DATOS_INSCRIPCION, edad: 'doce' }, 'edad'],
  ];

  for (const [body, esperado] of casos) {
    install([PERMISOS_CON(['examenes:editar:examenes']), { match: 'UPDATE examenes_inscripciones', result: () => ({ rows: [{ id: 9 }] }) }]);
    const res = await request('PATCH', '/api/examenes/5/inscritos/9', { token: token('profesor'), body });
    assert.equal(res.status, 400, `deberia rechazar ${JSON.stringify(body)}`);
    assert.match(res.data.message, new RegExp(esperado, 'i'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Hoja de inscripcion en PDF. El alumno inscrito la baja, ya rellena.
// ─────────────────────────────────────────────────────────────────────────────

// El PDF de VERDAD, el mismo que embebe el backend. Hace falta el real y no uno
// de mentira porque la descarga no lo copia tal cual: lo abre con pdf-lib,
// rellena los campos del formulario y lo vuelve a guardar. Un PDF minimo con la
// firma "%PDF-" pasa la validacion de subida, pero revienta en cuanto pdf-lib
// intenta buscar el formulario, y el test mediria ese error y no la hoja.
const PDF_VALIDO = require('../src/config/hojaPorDefecto').HOJA_POR_DEFECTO;

// El ataque que justifica la comprobacion de firma: un HTML con la extension
// .pdf. Si el backend solo mirara el mimetype, esto pasaria y al abrirlo el
// navegador lo ejecutaria en el origen de la academia.
const HTML_FINGIDO = Buffer.from('<html><script>alert(document.cookie)</script></html>');

function formConHoja(buffer, { nombre = 'hoja.pdf', tipo = 'application/pdf' } = {}) {
  const form = new FormData();
  form.append('hoja', new Blob([buffer], { type: tipo }), nombre);
  return form;
}

test('el listado manda tiene_hoja, nunca los bytes del PDF', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'FROM examenes e', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('GET', '/api/examenes', { token: token('estudiante') });
  assert.equal(res.status, 200);

  const consulta = calls.find((c) => c.text.includes('FROM examenes e')).text;
  // El listado NO puede seleccionar hoja_inscripcion: 5MB en base64 son 6.7MB
  // por fila y la respuesta revienta el limite de 4.5MB de Vercel.
  assert.ok(!/e\.hoja_inscripcion\s*(,|\n)/.test(consulta),
    'el listado no puede seleccionar hoja_inscripcion: son varios MB por fila');

  // Y `tiene_hoja` ya no puede depender de la columna: la hoja va embebida, asi
  // que un examen creado antes de que existiera tambien la tiene.
  assert.ok(!/e\.hoja_inscripcion IS NOT NULL/.test(consulta),
    'tiene_hoja ya no debe leer la columna: siempre hay hoja');
  assert.match(consulta, /TRUE AS tiene_hoja/,
    'el listado debe decir que siempre hay hoja');
});

test('el detalle tampoco manda los bytes del PDF', async () => {
  await start();
  const { calls } = install([
    PERMISOS_VACIO,
    { match: 'SELECT e.id, e.nombre, e.fecha_examen', result: () => ({ rows: [{ id: 1 }] }) },
  ]);

  const res = await request('GET', '/api/examenes/ver/1', { token: token('estudiante') });
  assert.equal(res.status, 200);

  const consulta = calls.find((c) => c.text.includes('SELECT e.id, e.nombre, e.fecha_examen')).text;
  assert.ok(!/e\.hoja_inscripcion\s*(,|\n)/.test(consulta),
    'el detalle no puede seleccionar hoja_inscripcion');
});

test('subir un PDF valido lo guarda en base64', async () => {
  await start();
  const { calls } = install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes SET hoja_inscripcion = $1', result: () => ({ rows: [{ id: 3 }] }) },
  ]);

  const res = await requestRaw('POST', '/api/examenes/3/hoja', {
    token: token('profesor'),
    form: formConHoja(PDF_VALIDO),
  });
  assert.equal(res.status, 200, `subir un PDF valido no puede fallar: ${res.buffer.toString()}`);

  const call = calls.find((c) => c.text.includes('UPDATE examenes SET hoja_inscripcion = $1'));
  assertPlaceholders(call);
  assert.equal(call.params[0], PDF_VALIDO.toString('base64'),
    'lo guardado debe ser el base64 pelado, sin el prefijo data:');
  assert.equal(call.params[1], 3, 'el id del examen va como segundo parametro');
});

test('rechaza un PDF que en realidad es HTML con la firma correcta', async () => {
  await start();
  const { calls } = install([PERMISOS_CON(['examenes:editar:examenes'])]);

  const res = await requestRaw('POST', '/api/examenes/3/hoja', {
    token: token('profesor'),
    form: formConHoja(HTML_FINGIDO, { nombre: 'hoja.pdf', tipo: 'application/pdf' }),
  });
  assert.equal(res.status, 400, 'el mimetype solo no alcanza: hay que mirar los bytes');
  assert.ok(!calls.some((c) => c.text.includes('UPDATE examenes')),
    'un archivo que no es PDF no debe llegar al UPDATE');
});

test('rechaza un archivo que ni siquiera es PDF', async () => {
  await start();
  install([PERMISOS_CON(['examenes:editar:examenes'])]);

  const res = await requestRaw('POST', '/api/examenes/3/hoja', {
    token: token('profesor'),
    form: formConHoja(Buffer.from('imagen'), { nombre: 'foto.png', tipo: 'image/png' }),
  });
  assert.equal(res.status, 400, 'solo application/pdf');
});

test('sin permiso de editar no se puede subir la hoja', async () => {
  await start();
  install([PERMISOS_CON(['examenes:ver_inscritos'])]);

  const res = await requestRaw('POST', '/api/examenes/3/hoja', {
    token: token('profesor'),
    form: formConHoja(PDF_VALIDO),
  });
  assert.equal(res.status, 403, 'subir la hoja es editar el examen');
});

test('subir la hoja de un examen que no existe da 404', async () => {
  await start();
  // El UPDATE tiene que devolver cero filas: eso es lo que el backend usa para
  // saber que el examen no existe. Sin este handler el mock revienta antes y el
  // test mide 500 por una falta del mock, no el 404 que se quiere comprobar.
  install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes SET hoja_inscripcion = $1', result: () => ({ rows: [] }) },
  ]);

  const res = await requestRaw('POST', '/api/examenes/999/hoja', {
    token: token('profesor'),
    form: formConHoja(PDF_VALIDO),
  });
  assert.equal(res.status, 404);
});

// La descarga hace DOS consultas: primero resuelve el alumno del usuario, y
// despues pide el snapshot de SU inscripcion. Los mocks tienen que cubrir las
// dos o el mock revienta antes de llegar al PDF y el test mide un 500 del mock,
// no el 200 que quiere comprobar.
const ALUMNO = { match: 'SELECT id FROM alumnos WHERE usuario_id = $1', result: () => ({ rows: [{ id: 55 }] }) };

const HOJA_DE = (nombre) => ({
  match: 'FROM examenes e JOIN examenes_inscripciones ei',
  result: () => ({
    rows: [{ examen_nombre: nombre, hoja_inscripcion: PDF_VALIDO.toString('base64') }],
  }),
});

test('descargar devuelve el PDF con el nombre y los bytes correctos', async () => {
  await start();
  install([PERMISOS_VACIO, ALUMNO, HOJA_DE('Torneo de Verano')]);

  const res = await requestRaw('GET', '/api/examenes/4/hoja', { token: token('estudiante') });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="solicitud-examen-torneo-de-verano.pdf"');
  assert.equal(res.buffer.subarray(0, 5).toString('latin1'), '%PDF-',
    'lo que baja tiene que ser un PDF de verdad');
});

test('el nombre del archivo baja limpio en acentos y simbolos', async () => {
  await start();
  install([PERMISOS_VACIO, ALUMNO, HOJA_DE('Examen "Cinta" Áurea 2026/2')]);

  const res = await requestRaw('GET', '/api/examenes/5/hoja', { token: token('estudiante') });
  assert.equal(res.status, 200);
  // Una comilla sin escapar ahi revienta la cabecera entera y la descarga llega
  // sin nombre o con el nombre cortado.
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="solicitud-examen-examen-cinta-aurea-2026-2.pdf"');
});

test('un examen sin hoja guardada sirve la de por defecto, no un 404', async () => {
  await start();
  install([
    PERMISOS_VACIO,
    ALUMNO,
    {
      // Fila vieja: creada antes de que la hoja por defecto existiera, asi que
      // la columna viene en NULL.
      match: 'FROM examenes e JOIN examenes_inscripciones ei',
      result: () => ({ rows: [{ examen_nombre: 'Examen Antiguo', hoja_inscripcion: null }] }),
    },
  ]);

  const res = await requestRaw('GET', '/api/examenes/6/hoja', { token: token('estudiante') });
  assert.equal(res.status, 200,
    'el alumno tiene derecho a su hoja aunque el examen se creo sin ella');
  assert.equal(res.headers.get('content-type'), 'application/pdf');
});

test('no estando inscrito da 404, sin revelar si el examen existe', async () => {
  await start();
  install([PERMISOS_VACIO, ALUMNO, { match: 'FROM examenes e JOIN examenes_inscripciones ei', result: () => ({ rows: [] }) }]);

  const res = await requestRaw('GET', '/api/examenes/8/hoja', { token: token('estudiante') });
  assert.equal(res.status, 404);
});

test('un alumno sin sesion no descarga la hoja', async () => {
  await start();
  install([PERMISOS_VACIO, ALUMNO, HOJA_DE('X')]);

  const res = await requestRaw('GET', '/api/examenes/8/hoja');
  assert.equal(res.status, 401);
});

test('quitar la hoja la borra de verdad', async () => {
  await start();
  const { calls } = install([
    PERMISOS_CON(['examenes:editar:examenes']),
    { match: 'UPDATE examenes SET hoja_inscripcion = NULL', result: () => ({ rows: [{ id: 7 }] }) },
  ]);

  const res = await request('DELETE', '/api/examenes/7/hoja', { token: token('profesor') });
  assert.equal(res.status, 200);

  const call = calls.find((c) => c.text.includes('UPDATE examenes SET hoja_inscripcion = NULL'));
  assertPlaceholders(call);
});
