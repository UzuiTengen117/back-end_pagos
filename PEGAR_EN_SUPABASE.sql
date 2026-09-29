-- ============================================================================
-- PEGAR EN SUPABASE -> SQL Editor -> New query -> Run
-- ============================================================================
-- Todo lo que falta para que el modulo de examenes funcione, INCLUDING la hoja
-- de inscripcion en PDF. Es IDEMPOTENTE: se puede correr las veces que haga
-- falta sin romper nada ni duplicar filas.
-- ============================================================================


-- 1) Tabla de examenes ---------------------------------------------------
-- La columna `hoja_inscripcion` guarda el PDF en base64 pelado, sin el prefijo
-- "data:...;base64," que si usa la imagen, porque este nunca se pinta en un
-- <img>: solo se descarga.
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
  hoja_inscripcion TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'en_curso', 'finalizado', 'cancelado')),
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Para las tablas que YA existan sin esta columna. Es la linea que importa si
-- la tabla examenes se creo antes de que existiera la hoja.
ALTER TABLE examenes ADD COLUMN IF NOT EXISTS hoja_inscripcion TEXT;

CREATE INDEX IF NOT EXISTS examenes_fecha_examen_idx ON examenes (fecha_examen);


-- 2) Tabla de inscripciones ----------------------------------------------
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


-- 3) Permisos del modulo examenes ----------------------------------------
-- POR QUE ESTE BLOQUE NO SE PUDE SALTAR
--
-- El middleware aplica los permisos por defecto del rol SOLO cuando el usuario
-- no tiene NINGUNA fila propia en permisos_usuario. Si el usuario tiene al menos
-- una fila configurada a mano, los defaults se descartan TODOS y solo cuentan
-- las filas explicitas.
--
-- Traducido: si configuraste los permisos del admin a mano en la aplicacion
-- (que es lo normal), y no le diste `examenes:editar:examenes` explicitamente,
-- entonces la subida de la hoja de inscripcion responde 403 aunque el usuario
-- administre eventos sin problema.
--
-- Este bloque copia los permisos de eventos a examenes, que es lo coherente: el
-- que administra eventos administra examenes. Si prefieres otra cosa, cambialo
-- aca y no en la aplicacion.

INSERT INTO permisos_usuario (usuario_id, modulo, accion)
SELECT usuario_id, 'examenes', 'ver:reporte_examenes'
  FROM permisos_usuario
 WHERE modulo = 'eventos' AND accion = 'ver:reporte_eventos'
ON CONFLICT (usuario_id, modulo, accion) DO NOTHING;

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


-- 4) Comprobacion ---------------------------------------------------------
-- Tiene que salir "true". Si sale "false", la tabla examenes todavia no
-- existia y algo fallo antes: revisar los mensajes de arriba.
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_name = 'examenes' AND column_name = 'hoja_inscripcion'
) AS hoja_agregada;
