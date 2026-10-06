const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { permite } = require('../middleware/permisos');
const { internalError } = require('../utils/httpError');

const ESTADOS = ['pendiente', 'preparacion', 'entregado', 'cancelado'];
const METODOS_PAGO = ['efectivo', 'en_linea'];
const MAX_ITEMS = 50;
const MAX_CANTIDAD = 999;
const MAX_NOTAS = 1000;

function parseId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// El pedido se arma siempre a nombre del alumno del usuario de la sesion: el id
// del alumno nunca viaja en el body, asi un estudiante no puede pedir en
// nombre de otro.
async function obtenerAlumno(usuarioId) {
  const result = await pool.query('SELECT id FROM alumnos WHERE usuario_id = $1', [usuarioId]);
  return result.rows.length > 0 ? result.rows[0].id : null;
}

// Normaliza y valida los renglones del carrito. Un producto repetido se fusiona
// en un solo renglon para que el descuento de stock sea de una sola pieza.
function construirItems(body) {
  const crudo = body && Array.isArray(body.items) ? body.items : null;
  if (!crudo || crudo.length === 0) {
    return { error: 'El pedido debe incluir al menos un producto' };
  }
  if (crudo.length > MAX_ITEMS) {
    return { error: `El pedido no puede superar ${MAX_ITEMS} productos distintos` };
  }

  const acumulados = new Map();
  for (const item of crudo) {
    // Se aceptan producto_id (snake) y productoId (camel): el contrato de la UI
    // es camelCase pero otros clientes pueden mandar el nombre de la columna.
    const productoId = item && (parseId(item.producto_id) || parseId(item.productoId));
    const cantidad = item && Number(item.cantidad);
    if (!productoId) {
      return { error: 'Producto no válido' };
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      return { error: 'Cantidad no válida' };
    }
    acumulados.set(productoId, (acumulados.get(productoId) || 0) + cantidad);
  }

  return { items: [...acumulados.entries()].map(([producto_id, cantidad]) => ({ producto_id, cantidad })) };
}

router.post('/', async (req, res) => {
  try {
    const alumnoId = await obtenerAlumno(req.user.id);
    if (alumnoId === null) {
      return res.status(400).json({ message: 'No tienes un alumno registrado para hacer pedidos' });
    }

    const construido = construirItems(req.body);
    if (construido.error) {
      return res.status(400).json({ message: construido.error });
    }
    const items = construido.items;

    const notas = req.body.notas ? String(req.body.notas).trim().slice(0, MAX_NOTAS) : null;

    const metodoPago = req.body && req.body.metodo_pago ? String(req.body.metodo_pago).trim() : 'efectivo';
    if (!METODOS_PAGO.includes(metodoPago)) {
      return res.status(400).json({ message: 'Método de pago no válido. Permitidos: efectivo, en_linea' });
    }

    const client = await pool.connect();
    let pedido;
    try {
      await client.query('BEGIN');

      const detalles = [];
      for (const item of items) {
        // El WHERE stock >= cantidad es la candada: dos pedidos simultaneos no
        // pueden bajar el stock por debajo de cero. Si no hay, no hay fila y se
        // revierte todo el pedido, no solo el renglon.
        const prod = await client.query(
          `UPDATE productos
              SET stock = stock - $2, updated_at = NOW()
            WHERE id = $1 AND activo = TRUE AND stock >= $2
           RETURNING nombre, precio`,
          [item.producto_id, item.cantidad]
        );
        if (prod.rows.length === 0) {
          const existe = await client.query('SELECT nombre, activo, stock FROM productos WHERE id = $1', [
            item.producto_id,
          ]);
          if (existe.rows.length === 0) {
            throw { status: 404, message: 'Un producto del pedido ya no existe' };
          }
          const p = existe.rows[0];
          if (!p.activo) {
            throw { status: 409, message: `El producto "${p.nombre}" ya no está disponible` };
          }
          throw { status: 409, message: `Stock insuficiente para "${p.nombre}" (disponible: ${p.stock})` };
        }
        detalles.push({ producto_id: item.producto_id, cantidad: item.cantidad, precio: prod.rows[0].precio });
      }

      const total = detalles.reduce((suma, d) => suma + Number(d.precio) * d.cantidad, 0);

      const pedidoResult = await client.query(
        `INSERT INTO pedidos (alumno_id, estado, total, notas, metodo_pago)
         VALUES ($1, 'pendiente', $2, $3, $4)
         RETURNING *`,
        [alumnoId, total.toFixed(2), notas, metodoPago]
      );
      pedido = pedidoResult.rows[0];

      for (const d of detalles) {
        await client.query(
          'INSERT INTO pedido_detalles (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
          [pedido.id, d.producto_id, d.cantidad, d.precio]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json(pedido);
  } catch (error) {
    internalError(res, error);
  }
});

// Listado del administrador: todos los pedidos con el nombre del alumno.
router.get('/', permite('tienda', 'ver'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.alumno_id, p.estado, p.total, p.notas, p.metodo_pago, p.created_at, p.updated_at,
             a.nombre || ' ' || a.primer_apellido ||
             COALESCE(' ' || NULLIF(a.segundo_apellido, ''), '') AS alumno
        FROM pedidos p
        JOIN alumnos a ON a.id = p.alumno_id
       ORDER BY p.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// Los pedidos propios: el filtro va por el usuario de la sesion, no por un id
// del body, asi que un estudiante jamas ve pedidos ajenos.
router.get('/mis', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.alumno_id, p.estado, p.total, p.notas, p.metodo_pago, p.created_at, p.updated_at
         FROM pedidos p
         JOIN alumnos a ON a.id = p.alumno_id
        WHERE a.usuario_id = $1
        ORDER BY p.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// Detalle con renglones. Un estudiante solo puede ver los suyos.
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }

    const esEstudiante = req.user.rol === 'estudiante';
    const scope = esEstudiante ? ' AND a.usuario_id = $1' : '';
    const params = esEstudiante ? [id, req.user.id] : [id];

    const result = await pool.query(
      `SELECT p.id, p.alumno_id, p.estado, p.total, p.notas, p.metodo_pago, p.created_at, p.updated_at,
              a.nombre || ' ' || a.primer_apellido ||
              COALESCE(' ' || NULLIF(a.segundo_apellido, ''), '') AS alumno
         FROM pedidos p
         JOIN alumnos a ON a.id = p.alumno_id
        WHERE p.id = $1${scope}`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }

    const detalles = await pool.query(
      `SELECT d.id, d.producto_id, d.cantidad, d.precio_unitario, pr.nombre
         FROM pedido_detalles d
         JOIN productos pr ON pr.id = d.producto_id
        WHERE d.pedido_id = $1
        ORDER BY d.id`,
      [id]
    );

    res.json({ ...result.rows[0], detalles: detalles.rows });
  } catch (error) {
    internalError(res, error);
  }
});

// Cambio de estado por el administrador. Cancelar devuelve el stock; salir de
// cancelado lo vuelve a descontar (y si ya no hay, se rechaza con 409).
router.put('/:id/estado', permite('tienda', 'editar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }
    const estado = req.body && req.body.estado;
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ message: `Estado no válido. Permitidos: ${ESTADOS.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // FOR UPDATE: dos administradores cambiando el mismo pedido a la vez no
      // pueden aplicar la devolucion de stock dos veces.
      const pedidoResult = await client.query('SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
      if (pedidoResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      const anterior = pedidoResult.rows[0].estado;

      if (anterior !== estado) {
        if (estado === 'cancelado') {
          await client.query(
            `UPDATE productos p
                SET stock = p.stock + d.cantidad, updated_at = NOW()
               FROM pedido_detalles d
              WHERE d.pedido_id = $1 AND p.id = d.producto_id`,
            [id]
          );
        } else if (anterior === 'cancelado') {
          const detalles = await client.query('SELECT producto_id, cantidad FROM pedido_detalles WHERE pedido_id = $1', [
            id,
          ]);
          for (const d of detalles.rows) {
            const prod = await client.query(
              `UPDATE productos
                  SET stock = stock - $2, updated_at = NOW()
                WHERE id = $1 AND stock >= $2
               RETURNING id`,
              [d.producto_id, d.cantidad]
            );
            if (prod.rows.length === 0) {
              throw { status: 409, message: 'No hay stock suficiente para reactivar este pedido' };
            }
          }
        }
      }

      const result = await client.query(
        `UPDATE pedidos
            SET estado = $1, atendido_por = $2, updated_at = NOW()
          WHERE id = $3
       RETURNING *`,
        [estado, req.user.id, id]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
