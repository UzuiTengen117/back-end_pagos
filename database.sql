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
-- `sede` NO lleva CHECK como el resto de las tablas: un torneo puede celebrarse
-- fuera de la academia (en otro gimnasio o en otra ciudad), asi que aqui es
-- texto libre y el frontend sugiere las dos sedes propias.
CREATE TABLE IF NOT EXISTS eventos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('torneo', 'dual_meet', 'open', 'otro')),
  -- TIMESTAMPTZ por la misma razon que asistencias.created_at: el instante del
  -- torneo es unico, no una fecha de calendario. El reloj regresivo del alumno
  -- se calcula contra este valor.
  fecha_inicio TIMESTAMPTZ NOT NULL,
  sede VARCHAR(50),
  lugar VARCHAR(255),
  categorias VARCHAR(255),
  descripcion TEXT,
  precio_inscripcion NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cupo_maximo INTEGER,
  link_registro VARCHAR(500),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Un alumno no puede quedar inscrito dos veces en el mismo evento.
CREATE UNIQUE INDEX IF NOT EXISTS eventos_inscripciones_unica
  ON eventos_inscripciones (evento_id, alumno_id);

CREATE INDEX IF NOT EXISTS eventos_inscripciones_alumno_idx ON eventos_inscripciones (alumno_id);
