
CREATE TABLE IF NOT EXISTS examenes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  niveles VARCHAR(255),
  fecha_examen TIMESTAMPTZ NOT NULL,
  sede VARCHAR(50) CHECK (
    sede IS NULL
    OR btrim(sede) = ''
    OR btrim(sede) ~ '^(Progreso|Morelos)(, ?(Progreso|Morelos))*$'
  ),
  lugar VARCHAR(255),
  descripcion TEXT,
  precio_inscripcion NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cupo_maximo INTEGER,
  imagen TEXT,
  imagen_thumb TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'en_curso', 'finalizado', 'cancelado')),
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS examenes_fecha_examen_idx ON examenes (fecha_examen);

CREATE TABLE IF NOT EXISTS examenes_inscripciones (
  id SERIAL PRIMARY KEY,
  examen_id INTEGER NOT NULL REFERENCES examenes(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado VARCHAR(20) NOT NULL DEFAULT 'inscrito' CHECK (estado IN ('inscrito', 'cancelada')),
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

