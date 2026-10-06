-- ---------------------------------------------------------------------------
-- Migración: Tienda de productos de taekwondo
--
-- Tablas nuevas:
--   productos         catálogo (nombre, precio, stock, foto, activo)
--   pedidos           pedido de un alumno, pago presencial al recoger
--   pedido_detalles   renglones del pedido con el precio congelado al comprar
--
-- Todo es idempotente (IF NOT EXISTS): se puede correr las veces que haga falta.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  precio NUMERIC(10, 2) NOT NULL DEFAULT 0
    CHECK (precio >= 0),
  stock INTEGER NOT NULL DEFAULT 0
    CHECK (stock >= 0),
  imagen TEXT,
  imagen_thumb TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS productos_activo_idx ON productos (activo);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'preparacion', 'entregado', 'cancelado')),
  total NUMERIC(10, 2) NOT NULL DEFAULT 0
    CHECK (total >= 0),
  notas TEXT,
  metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo'
    CHECK (metodo_pago IN ('efectivo', 'en_linea')),
  pago_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (pago_estado IN ('pendiente', 'aprobado', 'rechazado')),
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  atendido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pedidos_alumno_idx ON pedidos (alumno_id);
CREATE INDEX IF NOT EXISTS pedidos_estado_idx ON pedidos (estado);

CREATE TABLE IF NOT EXISTS pedido_detalles (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10, 2) NOT NULL CHECK (precio_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS pedido_detalles_pedido_idx ON pedido_detalles (pedido_id);

-- ---------------------------------------------------------------------------
-- Para bases que ya tenian la tabla pedidos sin los campos de pago (idempotente).
-- ---------------------------------------------------------------------------
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_estado VARCHAR(20) NOT NULL DEFAULT 'pendiente';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_preference_id TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_metodo_pago_check'
  ) THEN
    ALTER TABLE pedidos
      ADD CONSTRAINT pedidos_metodo_pago_check
      CHECK (metodo_pago IN ('efectivo', 'en_linea'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_pago_estado_check'
  ) THEN
    ALTER TABLE pedidos
      ADD CONSTRAINT pedidos_pago_estado_check
      CHECK (pago_estado IN ('pendiente', 'aprobado', 'rechazado'));
  END IF;
END $$;
