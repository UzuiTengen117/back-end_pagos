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
