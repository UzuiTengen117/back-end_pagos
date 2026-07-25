const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const SELECT_COMPROBANTES = `
  SELECT c.*, a.nombre, a.primer_apellido, a.segundo_apellido,
         pg.mes AS pago_mes, pg.estado AS pago_estado, pg.monto_final AS pago_monto_final
  FROM comprobantes c
  JOIN alumnos a ON c.alumno_id = a.id
  LEFT JOIN pagos pg ON c.pago_id = pg.id
`;

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`${SELECT_COMPROBANTES} ORDER BY c.id DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query(`${SELECT_COMPROBANTES} ORDER BY c.id DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`${SELECT_COMPROBANTES} WHERE c.id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`${SELECT_COMPROBANTES} WHERE c.id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar', async (req, res) => {
  try {
    const { alumno_id, pago_id, concepto, monto, metodo_pago, observaciones } = req.body;

    if (!alumno_id || !concepto || !monto || !metodo_pago) {
      return res.status(400).json({ message: 'Alumno, concepto, monto y método de pago son requeridos' });
    }

    if (pago_id) {
      const pagoCheck = await pool.query('SELECT id FROM pagos WHERE id = $1', [pago_id]);
      if (pagoCheck.rows.length === 0) {
        return res.status(400).json({ message: 'El pago no existe' });
      }
    }

    const result = await pool.query(
      'INSERT INTO comprobantes (alumno_id, pago_id, concepto, monto, metodo_pago, observaciones) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [alumno_id, pago_id || null, concepto, monto, metodo_pago, observaciones || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { alumno_id, pago_id, concepto, monto, metodo_pago, observaciones } = req.body;

    if (!alumno_id || !concepto || !monto || !metodo_pago) {
      return res.status(400).json({ message: 'Alumno, concepto, monto y método de pago son requeridos' });
    }

    if (pago_id) {
      const pagoCheck = await pool.query('SELECT id FROM pagos WHERE id = $1', [pago_id]);
      if (pagoCheck.rows.length === 0) {
        return res.status(400).json({ message: 'El pago no existe' });
      }
    }

    const result = await pool.query(
      'INSERT INTO comprobantes (alumno_id, pago_id, concepto, monto, metodo_pago, observaciones) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [alumno_id, pago_id || null, concepto, monto, metodo_pago, observaciones || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, pago_id, concepto, monto, metodo_pago, observaciones } = req.body;

    if (pago_id) {
      const pagoCheck = await pool.query('SELECT id FROM pagos WHERE id = $1', [pago_id]);
      if (pagoCheck.rows.length === 0) {
        return res.status(400).json({ message: 'El pago no existe' });
      }
    }

    const result = await pool.query(
      'UPDATE comprobantes SET alumno_id = $1, pago_id = $2, concepto = $3, monto = $4, metodo_pago = $5, observaciones = $6 WHERE id = $7 RETURNING *',
      [alumno_id, pago_id || null, concepto, monto, metodo_pago, observaciones, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, pago_id, concepto, monto, metodo_pago, observaciones } = req.body;

    if (pago_id) {
      const pagoCheck = await pool.query('SELECT id FROM pagos WHERE id = $1', [pago_id]);
      if (pagoCheck.rows.length === 0) {
        return res.status(400).json({ message: 'El pago no existe' });
      }
    }

    const result = await pool.query(
      'UPDATE comprobantes SET alumno_id = $1, pago_id = $2, concepto = $3, monto = $4, metodo_pago = $5, observaciones = $6 WHERE id = $7 RETURNING *',
      [alumno_id, pago_id || null, concepto, monto, metodo_pago, observaciones, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM comprobantes WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json({ message: 'Comprobante eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM comprobantes WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comprobante no encontrado' });
    }
    res.json({ message: 'Comprobante eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
