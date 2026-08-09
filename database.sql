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
