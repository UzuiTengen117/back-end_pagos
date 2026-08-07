const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authorize } = require('../middleware/auth');
const { alumnoScope } = require('../middleware/scope');
const { internalError } = require('../utils/httpError');

const SELECT_PAGOS = `
  SELECT p.*, a.nombre, a.primer_apellido, a.segundo_apellido,
         tp.concepto, tp.monto AS monto_original, tp.tipo,
         b.nombre AS beca_nombre, p.beca_porcentaje, p.monto_final
  FROM pagos p
  JOIN alumnos a ON p.alumno_id = a.id
  JOIN tipos_pago tp ON p.tipo_pago_id = tp.id
  LEFT JOIN becas b ON p.beca_id = b.id
`;

async function calcularMontoFinal(alumno_id, tipo_pago_id) {
  const alumnoRes = await pool.query('SELECT beca_id FROM alumnos WHERE id = $1', [alumno_id]);
  const alumno = alumnoRes.rows[0];
  const tpRes = await pool.query('SELECT monto FROM tipos_pago WHERE id = $1', [tipo_pago_id]);
  const tp = tpRes.rows[0];

  if (!alumno || !tp) return { beca_id: null, beca_porcentaje: null, monto_final: tp?.monto || 0 };

  if (alumno.beca_id) {
    const becaRes = await pool.query('SELECT id, porcentaje FROM becas WHERE id = $1', [alumno.beca_id]);
    const beca = becaRes.rows[0];
    if (beca) {
      const porcentaje = parseFloat(beca.porcentaje);
      const monto_final = Math.round(tp.monto * (1 - porcentaje / 100) * 100) / 100;
      return { beca_id: beca.id, beca_porcentaje: porcentaje, monto_final };
    }
  }
  return { beca_id: null, beca_porcentaje: null, monto_final: tp.monto };
}

router.get('/', async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause}` : '';
    const result = await pool.query(`${SELECT_PAGOS}${where} ORDER BY p.id DESC`, scope.params);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause}` : '';
    const result = await pool.query(`${SELECT_PAGOS}${where} ORDER BY p.id DESC`, scope.params);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause} AND p.id = $2` : ' WHERE p.id = $1';
    const params = scope.clause ? [...scope.params, id] : [id];
    const result = await pool.query(`${SELECT_PAGOS}${where}`, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause} AND p.id = $2` : ' WHERE p.id = $1';
    const params = scope.clause ? [...scope.params, id] : [id];
    const result = await pool.query(`${SELECT_PAGOS}${where}`, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { alumno_id, tipo_pago_id, semana, mes, estado, monto, monto_original, beca_porcentaje, monto_parcial, notas_pendiente, metodo_pago } = req.body;

    if (!alumno_id || !tipo_pago_id || !mes) {
      return res.status(400).json({ message: 'Alumno, tipo de pago y mes son requeridos' });
    }

    const alumnoCheck = await pool.query('SELECT id FROM alumnos WHERE id = $1', [alumno_id]);
    if (alumnoCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El alumno no existe' });
    }

    const tpCheck = await pool.query('SELECT id, concepto FROM tipos_pago WHERE id = $1', [tipo_pago_id]);
    if (tpCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El tipo de pago no existe' });
    }

    let becaSnapshot;
    if (monto) {
      const alumnoRes = await pool.query('SELECT beca_id FROM alumnos WHERE id = $1', [alumno_id]);
      const alumno = alumnoRes.rows[0];
      let beca_id = null;
      let beca_pct = null;
      if (alumno && alumno.beca_id) {
        const becaRes = await pool.query('SELECT id, porcentaje FROM becas WHERE id = $1', [alumno.beca_id]);
        const beca = becaRes.rows[0];
        if (beca) {
          beca_id = beca.id;
          beca_pct = parseFloat(beca.porcentaje);
        }
      }
      becaSnapshot = {
        beca_id,
        beca_porcentaje: beca_pct,
        monto_final: Number(monto),
      };
    } else {
      becaSnapshot = await calcularMontoFinal(alumno_id, tipo_pago_id);
    }

    const pagoResult = await pool.query(
      `INSERT INTO pagos (alumno_id, tipo_pago_id, beca_id, beca_porcentaje, monto_final, monto_parcial, notas_pendiente, semana, mes, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [alumno_id, tipo_pago_id, becaSnapshot.beca_id, becaSnapshot.beca_porcentaje, becaSnapshot.monto_final,
       monto_parcial || null, notas_pendiente || null, semana || null, mes, estado || 'pendiente']
    );

    const pago = pagoResult.rows[0];
    const conceptoTp = tpCheck.rows[0].concepto;
    const montoComprobante = monto_parcial ? Number(monto_parcial) : becaSnapshot.monto_final;
    const metodoPago = metodo_pago || 'efectivo';

    const comprobanteResult = await pool.query(
      `INSERT INTO comprobantes (alumno_id, pago_id, concepto, monto, metodo_pago, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [alumno_id, pago.id, conceptoTp, montoComprobante, metodoPago, null]
    );

    res.status(201).json({ pago, comprobante: comprobanteResult.rows[0] });
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { alumno_id, tipo_pago_id, semana, mes, estado, monto, monto_original, beca_porcentaje, monto_parcial, notas_pendiente, metodo_pago } = req.body;

    if (!alumno_id || !tipo_pago_id || !mes) {
      return res.status(400).json({ message: 'Alumno, tipo de pago y mes son requeridos' });
    }

    const alumnoCheck = await pool.query('SELECT id FROM alumnos WHERE id = $1', [alumno_id]);
    if (alumnoCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El alumno no existe' });
    }

    const tpCheck = await pool.query('SELECT id, concepto FROM tipos_pago WHERE id = $1', [tipo_pago_id]);
    if (tpCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El tipo de pago no existe' });
    }

    let becaSnapshot;
    if (monto) {
      const alumnoRes = await pool.query('SELECT beca_id FROM alumnos WHERE id = $1', [alumno_id]);
      const alumno = alumnoRes.rows[0];
      let beca_id = null;
      let beca_pct = null;
      if (alumno && alumno.beca_id) {
        const becaRes = await pool.query('SELECT id, porcentaje FROM becas WHERE id = $1', [alumno.beca_id]);
        const beca = becaRes.rows[0];
        if (beca) {
          beca_id = beca.id;
          beca_pct = parseFloat(beca.porcentaje);
        }
      }
      becaSnapshot = {
        beca_id,
        beca_porcentaje: beca_pct,
        monto_final: Number(monto),
      };
    } else {
      becaSnapshot = await calcularMontoFinal(alumno_id, tipo_pago_id);
    }

    const pagoResult = await pool.query(
      `INSERT INTO pagos (alumno_id, tipo_pago_id, beca_id, beca_porcentaje, monto_final, monto_parcial, notas_pendiente, semana, mes, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [alumno_id, tipo_pago_id, becaSnapshot.beca_id, becaSnapshot.beca_porcentaje, becaSnapshot.monto_final,
       monto_parcial || null, notas_pendiente || null, semana || null, mes, estado || 'pendiente']
    );

    const pago = pagoResult.rows[0];
    const conceptoTp = tpCheck.rows[0].concepto;
    const montoComprobante = monto_parcial ? Number(monto_parcial) : becaSnapshot.monto_final;
    const metodoPago = metodo_pago || 'efectivo';

    const comprobanteResult = await pool.query(
      `INSERT INTO comprobantes (alumno_id, pago_id, concepto, monto, metodo_pago, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [alumno_id, pago.id, conceptoTp, montoComprobante, metodoPago, null]
    );

    res.status(201).json({ pago, comprobante: comprobanteResult.rows[0] });
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, tipo_pago_id, semana, mes, estado, monto, monto_original, beca_porcentaje, monto_parcial, notas_pendiente } = req.body;

    let becaSnapshot;
    if (monto) {
      const alumnoRes = await pool.query('SELECT beca_id FROM alumnos WHERE id = $1', [alumno_id]);
      const alumno = alumnoRes.rows[0];
      let beca_id = null;
      let beca_pct = null;
      if (alumno && alumno.beca_id) {
        const becaRes = await pool.query('SELECT id, porcentaje FROM becas WHERE id = $1', [alumno.beca_id]);
        const beca = becaRes.rows[0];
        if (beca) {
          beca_id = beca.id;
          beca_pct = parseFloat(beca.porcentaje);
        }
      }
      becaSnapshot = {
        beca_id,
        beca_porcentaje: beca_pct,
        monto_final: Number(monto),
      };
    } else {
      becaSnapshot = await calcularMontoFinal(alumno_id, tipo_pago_id);
    }

    const result = await pool.query(
      `UPDATE pagos SET alumno_id = $1, tipo_pago_id = $2, beca_id = $3, beca_porcentaje = $4,
       monto_final = $5, monto_parcial = $6, notas_pendiente = $7, semana = $8, mes = $9, estado = $10 WHERE id = $11 RETURNING *`,
      [alumno_id, tipo_pago_id, becaSnapshot.beca_id, becaSnapshot.beca_porcentaje, becaSnapshot.monto_final,
       monto_parcial || null, notas_pendiente || null, semana, mes, estado, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, tipo_pago_id, semana, mes, estado, monto, monto_original, beca_porcentaje, monto_parcial, notas_pendiente } = req.body;

    let becaSnapshot;
    if (monto) {
      const alumnoRes = await pool.query('SELECT beca_id FROM alumnos WHERE id = $1', [alumno_id]);
      const alumno = alumnoRes.rows[0];
      let beca_id = null;
      let beca_pct = null;
      if (alumno && alumno.beca_id) {
        const becaRes = await pool.query('SELECT id, porcentaje FROM becas WHERE id = $1', [alumno.beca_id]);
        const beca = becaRes.rows[0];
        if (beca) {
          beca_id = beca.id;
          beca_pct = parseFloat(beca.porcentaje);
        }
      }
      becaSnapshot = {
        beca_id,
        beca_porcentaje: beca_pct,
        monto_final: Number(monto),
      };
    } else {
      becaSnapshot = await calcularMontoFinal(alumno_id, tipo_pago_id);
    }

    const result = await pool.query(
      `UPDATE pagos SET alumno_id = $1, tipo_pago_id = $2, beca_id = $3, beca_porcentaje = $4,
       monto_final = $5, monto_parcial = $6, notas_pendiente = $7, semana = $8, mes = $9, estado = $10 WHERE id = $11 RETURNING *`,
      [alumno_id, tipo_pago_id, becaSnapshot.beca_id, becaSnapshot.beca_porcentaje, becaSnapshot.monto_final,
       monto_parcial || null, notas_pendiente || null, semana, mes, estado, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM pagos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json({ message: 'Pago eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM pagos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pago no encontrado' });
    }
    res.json({ message: 'Pago eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
