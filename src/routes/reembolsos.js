const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { permite } = require('../middleware/permisos');
const { alumnoScope } = require('../middleware/scope');
const { internalError } = require('../utils/httpError');

const DIAS_LIMITE = 7;

const SELECT_REEMBOLSOS = `
  SELECT s.id, s.alumno_id, s.pago_id, s.comprobante_id, s.monto, s.motivo,
         s.estado, s.motivo_rechazo, s.motivo_aprobacion, s.revisado_por, s.creada_por, s.created_at, s.updated_at,
         a.nombre, a.primer_apellido, a.segundo_apellido,
         c.concepto AS comprobante_concepto, c.metodo_pago AS comprobante_metodo_pago,
         c.created_at AS comprobante_fecha, c.folio,
         pg.mes AS pago_mes,
         r.nombre AS revisado_por_nombre
  FROM solicitudes_reembolso s
  JOIN alumnos a ON s.alumno_id = a.id
  LEFT JOIN comprobantes c ON s.comprobante_id = c.id
  LEFT JOIN pagos pg ON s.pago_id = pg.id
  LEFT JOIN usuarios r ON s.revisado_por = r.id
`;

function ordenar(rows) {
  return rows.sort((x, y) => y.id - x.id);
}

router.get('/', permite('solicitudes_reembolso', 'ver'), async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause}` : '';
    const result = await pool.query(`${SELECT_REEMBOLSOS}${where}`, scope.params);
    res.json(ordenar(result.rows));
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/pendientes', permite('solicitudes_reembolso', 'ver'), async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause} AND s.estado = $2` : ' WHERE s.estado = $1';
    const params = scope.clause ? [...scope.params, 'pendiente'] : ['pendiente'];
    const result = await pool.query(`${SELECT_REEMBOLSOS}${where}`, params);
    res.json(ordenar(result.rows));
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/historial', permite('solicitudes_reembolso', 'ver'), async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause
      ? ` WHERE ${scope.clause} AND s.estado IN ($2, $3)`
      : ' WHERE s.estado IN ($1, $2)';
    const params = scope.clause ? [...scope.params, 'aprobada', 'rechazada'] : ['aprobada', 'rechazada'];
    const result = await pool.query(`${SELECT_REEMBOLSOS}${where}`, params);
    res.json(ordenar(result.rows));
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id', permite('solicitudes_reembolso', 'ver'), async (req, res) => {
  try {
    const { id } = req.params;
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause} AND s.id = $2` : ' WHERE s.id = $1';
    const params = scope.clause ? [...scope.params, id] : [id];
    const result = await pool.query(`${SELECT_REEMBOLSOS}${where}`, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const { comprobante_id, pago_id, monto, motivo } = req.body;

    if (!comprobante_id) {
      return res.status(400).json({ message: 'El comprobante es requerido' });
    }
    if (!motivo || !String(motivo).trim()) {
      return res.status(400).json({ message: 'El motivo es requerido' });
    }

    const comprobante = await pool.query(
      'SELECT id, alumno_id, pago_id, monto, created_at FROM comprobantes WHERE id = $1',
      [comprobante_id]
    );
    if (comprobante.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    const c = comprobante.rows[0];

    // El estudiante solo puede solicitar reembolsos sobre sus propios comprobantes.
    if (req.user.rol === 'estudiante') {
      const alumno = await pool.query(
        'SELECT id FROM alumnos WHERE id = $1 AND usuario_id = $2',
        [c.alumno_id, req.user.id]
      );
      if (alumno.rows.length === 0) {
        return res.status(403).json({ message: 'No puedes solicitar un reembolso para este comprobante' });
      }
    }

    // Solo se puede solicitar dentro de la ventana de 7 días desde la emisión.
    const fechaEmision = new Date(c.created_at).getTime();
    const limite = Date.now() - DIAS_LIMITE * 24 * 60 * 60 * 1000;
    if (fechaEmision < limite) {
      return res.status(400).json({
        message: `No puedes solicitar un reembolso después de ${DIAS_LIMITE} días desde el pago`,
      });
    }

    // Un comprobante solo admite una solicitud de reembolso.
    const dup = await pool.query(
      'SELECT id FROM solicitudes_reembolso WHERE comprobante_id = $1',
      [comprobante_id]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ message: 'Este comprobante ya tiene una solicitud de reembolso' });
    }

    const montoFinal = monto !== undefined && monto !== null && Number(monto) > 0 ? Number(monto) : Number(c.monto);
    const pagoFinal = pago_id || c.pago_id || null;

    const result = await pool.query(
      `INSERT INTO solicitudes_reembolso (alumno_id, pago_id, comprobante_id, monto, motivo, creada_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [c.alumno_id, pagoFinal, comprobante_id, montoFinal, String(motivo).trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', permite('solicitudes_reembolso', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo, monto } = req.body;

    if (!motivo || !String(motivo).trim()) {
      return res.status(400).json({ message: 'El motivo es requerido' });
    }
    if (monto !== undefined && monto !== null && Number(monto) <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0' });
    }

    const result = await pool.query(
      `UPDATE solicitudes_reembolso
       SET motivo = $1, monto = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [String(motivo).trim(), Number(monto) || 0, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/:id/aprobar', permite('solicitudes_reembolso', 'aprobar'), async (req, res) => {
  try {
    const { id } = req.params;
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) {
      return res.status(400).json({ message: 'El motivo de la aprobación es requerido' });
    }
    const result = await pool.query(
      `UPDATE solicitudes_reembolso
       SET estado = 'aprobada', motivo_aprobacion = $1, motivo_rechazo = NULL, revisado_por = $2, updated_at = NOW()
       WHERE id = $3 AND estado = 'pendiente' RETURNING *`,
      [motivo, req.user.id, id]
    );
    if (result.rows.length === 0) {
      const check = await pool.query('SELECT estado FROM solicitudes_reembolso WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ message: 'Solicitud no encontrada' });
      }
      return res.status(400).json({ message: 'Solo se pueden aprobar solicitudes pendientes' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/:id/rechazar', permite('solicitudes_reembolso', 'rechazar'), async (req, res) => {
  try {
    const { id } = req.params;
    const motivoRechazo = String(req.body.motivo_rechazo || '').trim();
    if (!motivoRechazo) {
      return res.status(400).json({ message: 'El motivo del rechazo es requerido' });
    }

    const result = await pool.query(
      `UPDATE solicitudes_reembolso
       SET estado = 'rechazada', motivo_rechazo = $1, motivo_aprobacion = NULL, revisado_por = $2, updated_at = NOW()
       WHERE id = $3 AND estado = 'pendiente' RETURNING *`,
      [motivoRechazo, req.user.id, id]
    );
    if (result.rows.length === 0) {
      const check = await pool.query('SELECT estado FROM solicitudes_reembolso WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ message: 'Solicitud no encontrada' });
      }
      return res.status(400).json({ message: 'Solo se pueden rechazar solicitudes pendientes' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/:id/reabrir', permite('solicitudes_reembolso', 'editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE solicitudes_reembolso
       SET estado = 'pendiente', motivo_rechazo = NULL, motivo_aprobacion = NULL, revisado_por = NULL, updated_at = NOW()
       WHERE id = $1 AND estado IN ('aprobada', 'rechazada') RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      const check = await pool.query('SELECT estado FROM solicitudes_reembolso WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ message: 'Solicitud no encontrada' });
      }
      return res.status(400).json({ message: 'Solo se pueden reabrir solicitudes aprobadas o rechazadas' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', permite('solicitudes_reembolso', 'eliminar'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM solicitudes_reembolso WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }
    res.json({ message: 'Solicitud eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
