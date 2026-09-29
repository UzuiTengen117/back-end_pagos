CREATE TABLE IF NOT EXISTS pagos (
  id SERIAL PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  tipo_pago_id INTEGER NOT NULL REFERENCES tipos_pago(id) ON DELETE CASCADE,
  beca_id INTEGER REFERENCES becas(id) ON DELETE SET NULL,
  beca_porcentaje DECIMAL(5, 2),
  monto_final DECIMAL(10, 2),
  monto_parcial DECIMAL(10, 2),
  notas_pendiente TEXT,
  semana INTEGER,
  mes VARCHAR(255) NOT NULL,
  estado VARCHAR(50) NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pagos ADD COLUMN IF NOT EXISTS monto_parcial DECIMAL(10, 2);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS notas_pendiente TEXT;
ALTER TABLE pagos ALTER COLUMN mes TYPE VARCHAR(255);

CREATE TABLE IF NOT EXISTS comprobantes (
  id SERIAL PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  pago_id INTEGER REFERENCES pagos(id) ON DELETE SET NULL,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(10, 2) NOT NULL,
  metodo_pago VARCHAR(50) NOT NULL,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tipos_pago (
  id SERIAL PRIMARY KEY,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(10, 2) NOT NULL,
  tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('mensualidad', 'semanal', 'otro')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tipos_pago DROP CONSTRAINT IF EXISTS tipos_pago_tipo_check;
ALTER TABLE tipos_pago ADD CONSTRAINT tipos_pago_tipo_check CHECK (tipo IN ('mensualidad', 'semanal', 'otro'));

CREATE TABLE IF NOT EXISTS becas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  porcentaje DECIMAL(5, 2) NOT NULL,
  estado VARCHAR(50) NOT NULL DEFAULT 'activa',
  descripcion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  rol VARCHAR(50) NOT NULL CHECK (rol IN ('admin', 'profesor', 'estudiante')),
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS primer_apellido VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS segundo_apellido VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pregunta_secreta TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS respuesta_secreta TEXT;

ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS sede VARCHAR(50) CHECK (sede IN ('Progreso', 'Morelos'));
CREATE TABLE IF NOT EXISTS inscripciones (
  id SERIAL PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  fecha_inscripcion DATE NOT NULL,
  ciclo_escolar VARCHAR(50) NOT NULL,
  grado VARCHAR(50),
  estado VARCHAR(50) NOT NULL DEFAULT 'activa',
  monto_inscripcion DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alumnos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  primer_apellido VARCHAR(255) NOT NULL,
  segundo_apellido VARCHAR(255),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  telefono VARCHAR(20),
  grado VARCHAR(50) NOT NULL,
  -- La sede donde esta matriculado el alumno. Misma lista cerrada que
  -- eventos.sede, asi que las dos salen de src/config/sedes.js.
  sede VARCHAR(50) NOT NULL CHECK (sede IN ('Progreso', 'Morelos')),
  beca_id INTEGER REFERENCES becas(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS solicitudes_reembolso (
  id SERIAL PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  pago_id INTEGER REFERENCES pagos(id) ON DELETE SET NULL,
  comprobante_id INTEGER REFERENCES comprobantes(id) ON DELETE SET NULL,
  monto DECIMAL(10, 2) NOT NULL,
  motivo TEXT NOT NULL,
  estado VARCHAR(50) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  motivo_rechazo TEXT,
  motivo_aprobacion TEXT,
  revisado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE solicitudes_reembolso ADD COLUMN IF NOT EXISTS motivo_aprobacion TEXT;

CREATE TABLE IF NOT EXISTS permisos_usuario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo VARCHAR(100) NOT NULL,
  accion VARCHAR(100) NOT NULL,
  UNIQUE (usuario_id, modulo, accion)
);

-- ---------------------------------------------------------------------------
-- Migracion: Eventos pasa a subcategorias (eventos / reporte_eventos)
-- ---------------------------------------------------------------------------
-- Las claves viejas `eventos:ver_inscritos`, `eventos:crear`, `eventos:editar`,
-- `eventos:eliminar` dejan de existir. El nuevo catálogo usa `eventos:ver:reporte_eventos`
-- y `eventos:crear:eventos`, `eventos:editar:eventos`, `eventos:eliminar:eventos`.
--
-- Este bloque es IDEMPOTENTE: solo convierte filas que coincidan con los
-- nombres antiguos y no toca nada que ya tenga la forma nueva.
--
-- 1) `ver_inscritos` → `ver:reporte_eventos`
INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'eventos', 'ver:reporte_eventos'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'ver_inscritos'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

-- 2) `crear` → `crear:eventos`
INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'eventos', 'crear:eventos'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'crear'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

-- 3) `editar` → `editar:eventos`
INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'eventos', 'editar:eventos'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'editar'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

-- 4) `eliminar` → `eliminar:eventos`
INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'eventos', 'eliminar:eventos'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'eliminar'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Fin de la migracion de Eventos
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS alumnos_usuario_id_unique ON alumnos (usuario_id);

-- Asistencia a clases de taekwondo.
-- No hay entidad "clase": una sesion se define por grado + sede + fecha,
-- porque en taekwondo el grupo se forma por grado y sede, no por materia.
CREATE TABLE IF NOT EXISTS asistencia_sesiones (
  id SERIAL PRIMARY KEY,
  grado VARCHAR(50) NOT NULL,
  sede VARCHAR(50) NOT NULL CHECK (sede IN ('Progreso', 'Morelos')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  profesor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  abierta BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cerrada_at TIMESTAMP
);

-- Una sola sesion abierta por profesor, grado y sede. Impide que dos
-- profesores abran la misma clase al mismo tiempo y generen registros duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS asistencia_sesiones_abierta_unica
  ON asistencia_sesiones (profesor_id, grado, sede)
  WHERE abierta = TRUE;

CREATE TABLE IF NOT EXISTS asistencias (
  id SERIAL PRIMARY KEY,
  sesion_id INTEGER NOT NULL REFERENCES asistencia_sesiones(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  metodo VARCHAR(20) NOT NULL DEFAULT 'qr' CHECK (metodo IN ('qr', 'manual')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Un alumno no puede quedar registrado dos veces en la misma sesion.
CREATE UNIQUE INDEX IF NOT EXISTS asistencias_sesion_alumno_unique
  ON asistencias (sesion_id, alumno_id);

CREATE INDEX IF NOT EXISTS asistencias_alumno_idx ON asistencias (alumno_id);

-- Repara despliegues donde la tabla ya existia sin la columna, o con la columna
-- creada sin default. Ambas sentencias son idempotentes: se pueden correr las
-- veces que haga falta sin tocar los registros que ya tienen hora.
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE asistencias ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

-- TIMESTAMPTZ y no TIMESTAMP: Supabase corre la sesion en UTC, y un TIMESTAMP
-- sin zona se interpretaria en la zona del navegador, con la hora corrida por el
-- huso. Con timestamptz el instante es inequivoco y el navegador lo muestra bien.
ALTER TABLE asistencias
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Torneos y dual meets de taekwondo.
-- Un torneo se juega en las sedes de la academia, asi que la lista es cerrada y
-- el CHECK la hace cumplir en la base, no solo en el formulario. Texto libre
-- permitiria eventos en lugares que el resto del sistema no conoce.
CREATE TABLE IF NOT EXISTS eventos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('torneo', 'dual_meet', 'open', 'otro')),
  -- TIMESTAMPTZ por la misma razon que asistencias.created_at: el instante del
  -- torneo es unico, no una fecha de calendario. El reloj regresivo del alumno
  -- se calcula contra este valor.
  fecha_inicio TIMESTAMPTZ NOT NULL,
  -- Un torneo puede jugarse en una o en las dos sedes. Se guarda como texto
  -- separado por comas ("Progreso", "Morelos", "Progreso, Morelos") en vez de
  -- como tabla aparte: nadie consulta eventos por una sede concreta, solo las
  -- muestra, y una tabla hija obligaria a un JOIN en el listado.
  --
  -- El CHECK valida la lista completa con una expresion regular y no con
  -- `sede IN (...)`, que ya no alcanza: un `IN` compara la cadena entera y
  -- dejaria pasar "Progreso, Cholula" sin quejarse. `^...$` exige que sean
  -- sedes conocidas separadas por comas, sin nada antes ni despues.
  -- Ninguna de las dos sedes tiene metacaracteres de regex, asi que no hay que
  -- escaparlas; si se agrega una con un parentesis o un punto, hay que hacerlo.
  -- CHECK si admite `~` porque es una expresion: lo que no admite son subqueries.
  sede VARCHAR(50) CHECK (
    sede IS NULL
    OR btrim(sede) = ''
    OR btrim(sede) ~ '^(Progreso|Morelos)(, ?(Progreso|Morelos))*$'
  ),
  lugar VARCHAR(255),
  categorias VARCHAR(255),
  descripcion TEXT,
  precio_inscripcion NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cupo_maximo INTEGER,
  -- Data URL (igual que usuarios.foto) porque el despliegue es serverless y no
  -- hay disco donde dejar el archivo. Limite de 2MB aplicado por multer.
  imagen TEXT,
  -- Version reducida que genera el navegador antes de subir. El listado NUNCA
  -- pide `imagen`: a 2MB el base64 son 2.67MB por evento y dos carteles ya
  -- reventan el limite de 4.5MB de respuesta de Vercel. Esta columna mantiene
  -- las tarjetas livianas y la original se pide solo al abrir un evento.
  imagen_thumb TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'en_curso', 'finalizado', 'cancelado')),
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- El listado ordena por fecha y no por id, asi que el indice principal es la
-- propia columna del reloj. Los pasados se caen solos del orden.
CREATE INDEX IF NOT EXISTS eventos_fecha_inicio_idx ON eventos (fecha_inicio);

-- Inscripcion del alumno a un evento. Guarda usuario_id ademas de alumno_id
-- para no depender de un JOIN cada vez que se valida "este alumno ya va".
CREATE TABLE IF NOT EXISTS eventos_inscripciones (
  id SERIAL PRIMARY KEY,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado VARCHAR(20) NOT NULL DEFAULT 'inscrito' CHECK (estado IN ('inscrito', 'cancelada')),
  -- Datos que captura el alumno al inscribirse. Es una COPIA congelada de ese
  -- momento, no una vista de `alumnos`: la escuela o el grado pueden cambiar
  -- despues del torneo y la lista impresa debe decir lo que habia al inscribed.
  -- `edad` y `escuela` no existen en alumnos, asi que viven solo aqui.
  nombre VARCHAR(255) NOT NULL,
  primer_apellido VARCHAR(255) NOT NULL,
  segundo_apellido VARCHAR(255),
  edad SMALLINT,
  grado VARCHAR(50) NOT NULL,
  escuela VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Un alumno no puede quedar inscrito dos veces en el mismo evento.
CREATE UNIQUE INDEX IF NOT EXISTS eventos_inscripciones_unica
  ON eventos_inscripciones (evento_id, alumno_id);

CREATE INDEX IF NOT EXISTS eventos_inscripciones_alumno_idx ON eventos_inscripciones (alumno_id);

-- ---------------------------------------------------------------------------
-- EXAMENES
-- ---------------------------------------------------------------------------
-- Tabla propia, no un tipo mas de `eventos`. Se pidio separadas y la razon
-- tecnica es que el modelo NO calza: un evento se ordena por fecha y juega en
-- sede, un examen se ordena por `nivel` (cinta) y ocurre en una sola sede. Meter
-- `nivel` en eventos obligaria a un CHECK de tipos mas largo y a un
-- `tipo = 'examen'` mezclado con torneos en cada listado y cada filtro.
--
-- El resto de la forma (imagen en data URL, thumbnail, precio, cupo, estados) se
-- copia de eventos a proposito: son las mismas decisiones de despliegue
-- serverless, y divergir aqui solo daria dosimplementaciones que divergen.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS examenes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  -- Cintas o grados que se examinan, separados por comas ("Blanca, Amarilla").
  -- Es el equivalente funcional de `eventos.tipo` y va como texto libre, no como
  -- CHECK: los grados se agregan cada temporada y meterlos en el esquema obliga a
  -- una migracion cada vez que la academia abre un nivel nuevo.
  niveles VARCHAR(255),
  -- TIMESTAMPTZ por la misma razon que en eventos: el examen ocurre en un
  -- instante, no en un dia. El reloj regresivo del alumno se calcula contra
  -- este valor.
  fecha_examen TIMESTAMPTZ NOT NULL,
  -- Mismo CHECK que en eventos: solo las dos sedes, separadas por comas, validado
  -- con regex porque `IN` compara la cadena entera.
  sede VARCHAR(50) CHECK (
    sede IS NULL
    OR btrim(sede) = ''
    OR btrim(sede) ~ '^(Progreso|Morelos)(, ?(Progreso|Morelos))*$'
  ),
  lugar VARCHAR(255),
  descripcion TEXT,
  precio_inscripcion NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cupo_maximo INTEGER,
  -- Data URL por la misma razon que en eventos: el despliegue es serverless y
  -- no hay disco. Limite de 2MB aplicado por multer.
  imagen TEXT,
  -- Version reducida que genera el navegador antes de subir. El listado NUNCA
  -- pide `imagen`: a 2MB el base64 son 2.67MB por examen y dos carteles ya
  -- reventan el limite de 4.5MB de respuesta de Vercel.
  imagen_thumb TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'en_curso', 'finalizado', 'cancelado')),
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS examenes_fecha_examen_idx ON examenes (fecha_examen);

-- Inscripcion del alumno a un examen. Guarda usuario_id ademas de alumno_id
-- porque es lo que identifica al actor en el JWT.
CREATE TABLE IF NOT EXISTS examenes_inscripciones (
  id SERIAL PRIMARY KEY,
  examen_id INTEGER NOT NULL REFERENCES examenes(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado VARCHAR(20) NOT NULL DEFAULT 'inscrito' CHECK (estado IN ('inscrito', 'cancelada')),
  -- Snapshot congelado de la identidad, igual que en eventos_inscripciones: la
  -- hoja de resultados de UN examen debe decir lo que mando el alumno ese dia,
  -- aunque despues actualice su escuela o su grado.
  nombre VARCHAR(255) NOT NULL,
  primer_apellido VARCHAR(255) NOT NULL,
  segundo_apellido VARCHAR(255),
  edad SMALLINT,
  grado VARCHAR(50) NOT NULL,
  escuela VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS examenes_inscripciones_unica
  ON examenes_inscripciones (examen_id, alumno_id);

CREATE INDEX IF NOT EXISTS examenes_inscripciones_alumno_idx ON examenes_inscripciones (alumno_id);

INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'examenes', 'crear:examenes'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'crear:eventos'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'examenes', 'editar:examenes'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'editar:eventos'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'examenes', 'eliminar:examenes'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'eliminar:eventos'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'examenes', 'ver:reporte_examenes'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'ver:reporte_eventos'
 ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;



-- ---------------------------------------------------------------------------
-- Migracion: alumnos.sede
-- ---------------------------------------------------------------------------
-- database.sql venia sin esta columna aunque el codigo la usa desde hace tiempo
-- (el INSERT de alumnos la lista y el alta la exige). En una base ya montada la
-- columna existe y esto no hace nada; en una base creada con este mismo archivo
-- sigue siendo la definicion de arriba. El NOT NULL y el CHECK se agregan
-- aparte porque no se pueden poner en un ADD COLUMN sobre una tabla con filas.

ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS sede VARCHAR(50);

-- Solo si ya habia alumnos: sin sede no se puede cumplir el NOT NULL y el
-- comando se aborta. Cada fila se va a 'Progreso', que es la sede por defecto de
-- la academia, y el entrenador la corrige en el registro del alumno.
UPDATE alumnos SET sede = 'Progreso' WHERE sede IS NULL;

ALTER TABLE alumnos ALTER COLUMN sede SET DEFAULT 'Progreso';
ALTER TABLE alumnos ALTER COLUMN sede SET NOT NULL;
ALTER TABLE alumnos DROP CONSTRAINT IF EXISTS alumnos_sede_check;
ALTER TABLE alumnos ADD CONSTRAINT alumnos_sede_valida CHECK (sede IN ('Progreso', 'Morelos'));

-- ---------------------------------------------------------------------------
-- Permisos de eventos para usuarios con configuracion explicita
-- ---------------------------------------------------------------------------
-- ESTA MIGRACION NO ESTA ACTIVA A PROPOSITO. Leela antes de descomentarla.
--
-- El reparto de permisos tiene dos caminos: si el usuario NO tiene filas en
-- `permisos_usuario`, se le aplican los DEFAULTS de su rol desde el backend
-- (permisos.js), y un admin recibe todos. Pero si tiene AL MENOS UNA fila, sus
-- defaults dejan de contar y solo ve esas filas.
--
-- Ese es el problema: cuando se agrego el modulo Eventos, ningun usuario con
-- configuracion explicita recibio `eventos:*`, asi que el menu de Eventos y el
-- Reporte de Inscripciones les salen invisibles aunque su rol sea admin o
-- profesor. No es un bug de codigo, es el modelo de permisos funcionando.
--
-- Primero el diagnostico (este si se puede correr, no cambia nada):

SELECT u.id, u.nombre, u.rol,
       COUNT(p.id) FILTER (WHERE p.modulo = 'eventos') AS permisos_eventos,
       COUNT(p.id)                                        AS permisos_totales
  FROM usuarios u
  JOIN permisos_usuario p ON p.usuario_id = u.id
 WHERE u.rol IN ('admin', 'profesor')
 GROUP BY u.id, u.nombre, u.rol
HAVING COUNT(p.id) FILTER (WHERE p.modulo = 'eventos') = 0
 ORDER BY u.rol, u.nombre;

-- Si la consulta devuelve a alguien, ese usuario no vera nada de Eventos.
--
-- Para arreglarlo descomenta SOLO el bloque de abajo. Se eligió a mano y no
-- viene en la migracion automatica por dos razones:
--
-- 1. `eventos:eliminar` borra el evento Y sus inscripciones. Repartirlo en
--    automatico a quien el administrador decidio dejar sin permisos es una
--    escalada de privilegios, no una correccion.
-- 2. `eventos:ver_inscritos` expone nombre, edad y escuela de cada alumno. Es
--    dato personal de menores, y decide quien lo ve la academia, no el script.
--
-- Empieza solo por `ver_inscritos`, que es el que habilita el reporte, y agrega
-- crear/editar/eliminar solo a quien de verdad organiza torneos.
--
-- INSERT INTO permisos_usuario (usuario_id, modulo, accion)
-- SELECT u.id, 'eventos', 'ver_inscritos'
--   FROM usuarios u
--  WHERE u.rol IN ('admin', 'profesor')
--    AND EXISTS (SELECT 1 FROM permisos_usuario p WHERE p.usuario_id = u.id)
--    AND NOT EXISTS (
--      SELECT 1 FROM permisos_usuario p
--       WHERE p.usuario_id = u.id AND p.modulo = 'eventos'
--    )
-- ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Migracion: sede cerrada, sin link de registro y datos del alumno
-- ---------------------------------------------------------------------------
-- Todo lo de arriba es IF NOT EXISTS, asi que correr el script dos veces es
-- seguro. Esta seccion cubre el caso inverso: que las tablas ya existieran de
-- una version anterior del modulo. Tambien es idempotente.
--
-- Verificar antes de ejecutar:
--   SELECT * FROM information_schema.columns
--    WHERE table_name IN ('eventos','eventos_inscripciones') AND column_name = 'imagen_thumb';

-- El link de registro se elimino: la inscripcion se hace dentro del sistema.
ALTER TABLE eventos DROP COLUMN IF EXISTS link_registro;

-- La sede ahora admite las dos a la vez ("Progreso, Morelos"), asi que el CHECK
-- anterior (sede IN ('Progreso','Morelos')) ya no basta:(IN) compara la
-- cadena completa y rechazaria el par. Se sueltan los dos nombres por los que
-- se los creo (implicito y explicito) antes de poner el nuevo.
--
-- Las filas existentes NO hay que tocarlas: "Progreso" y "Morelos" sueltos ya
-- cumplen el patron nuevo. Solo se normaliza el espacio por si alguien guardo
-- "Progreso , Morelos" a mano.
ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_sede_check;
ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_sede_valida;
ALTER TABLE eventos
  ADD CONSTRAINT eventos_sede_valida CHECK (
    sede IS NULL
    OR btrim(sede) = ''
    OR btrim(sede) ~ '^(Progreso|Morelos)(, ?(Progreso|Morelos))*$'
  );

-- Ordena las sedes en el canonico (Progreso primero) por si una fila quedo con
-- el orden al reves, que el backend ya normaliza en las altas nuevas.
UPDATE eventos SET sede = 'Progreso, Morelos' WHERE btrim(sede) = 'Morelos, Progreso';
UPDATE eventos SET sede = 'Progreso, Morelos' WHERE btrim(sede) = 'Morelos,Progreso';

-- Datos que captura el alumno al inscribirse.
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS primer_apellido VARCHAR(255);
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS segundo_apellido VARCHAR(255);
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS edad SMALLINT;
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS grado VARCHAR(50);
ALTER TABLE eventos_inscripciones ADD COLUMN IF NOT EXISTS escuela VARCHAR(150);

-- Respaldo desde el perfil por si quedaran filas de una version previa. En una
-- base nueva no hay filas y esto no hace nada. 'Sin especificar' es un valor
-- visible y busquable a proposito: un escuela inventada seria peor que un hueco
-- que el entrenador tiene que rellenar antes de imprimir.
UPDATE eventos_inscripciones ei SET
  nombre         = COALESCE(ei.nombre, a.nombre),
  primer_apellido = COALESCE(ei.primer_apellido, a.primer_apellido),
  segundo_apellido = COALESCE(ei.segundo_apellido, a.segundo_apellido),
  grado          = COALESCE(ei.grado, a.grado),
  escuela         = COALESCE(ei.escuela, 'Sin especificar')
  FROM alumnos a
 WHERE a.id = ei.alumno_id
   AND (ei.nombre IS NULL OR ei.primer_apellido IS NULL OR ei.grado IS NULL OR ei.escuela IS NULL);

ALTER TABLE eventos_inscripciones ALTER COLUMN nombre SET NOT NULL;
ALTER TABLE eventos_inscripciones ALTER COLUMN primer_apellido SET NOT NULL;
ALTER TABLE eventos_inscripciones ALTER COLUMN grado SET NOT NULL;
ALTER TABLE eventos_inscripciones ALTER COLUMN escuela SET NOT NULL;
