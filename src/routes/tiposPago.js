const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authorize } = require('../middleware/auth');
const { internalError } = require('../utils/httpError');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_pago ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_pago ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM tipos_pago WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM tipos_pago WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', authorize('admin'), async (req, res) => {
  try {
    const { concepto, monto, tipo } = req.body;

    if (!concepto || !monto || !tipo) {
      return res.status(400).json({ message: 'Concepto, monto y tipo son requeridos' });
    }

    const tiposPermitidos = ['mensualidad', 'semanal', 'otro'];
    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ message: 'Tipo no válido. Tipos permitidos: mensualidad, semanal, otro' });
    }

    const result = await pool.query(
      'INSERT INTO tipos_pago (concepto, monto, tipo) VALUES ($1, $2, $3) RETURNING *',
      [concepto, monto, tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/', authorize('admin'), async (req, res) => {
  try {
    const { concepto, monto, tipo } = req.body;

    if (!concepto || !monto || !tipo) {
      return res.status(400).json({ message: 'Concepto, monto y tipo son requeridos' });
    }

    const tiposPermitidos = ['mensualidad', 'semanal', 'otro'];
    if (!tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ message: 'Tipo no válido. Tipos permitidos: mensualidad, semanal, otro' });
    }

    const result = await pool.query(
      'INSERT INTO tipos_pago (concepto, monto, tipo) VALUES ($1, $2, $3) RETURNING *',
      [concepto, monto, tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { concepto, monto, tipo } = req.body;

    const tiposPermitidos = ['mensualidad', 'semanal', 'otro'];
    if (tipo && !tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ message: 'Tipo no válido. Tipos permitidos: mensualidad, semanal, otro' });
    }

    const result = await pool.query(
      'UPDATE tipos_pago SET concepto = $1, monto = $2, tipo = $3 WHERE id = $4 RETURNING *',
      [concepto, monto, tipo, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { concepto, monto, tipo } = req.body;

    const tiposPermitidos = ['mensualidad', 'semanal', 'otro'];
    if (tipo && !tiposPermitidos.includes(tipo)) {
      return res.status(400).json({ message: 'Tipo no válido. Tipos permitidos: mensualidad, semanal, otro' });
    }

    const result = await pool.query(
      'UPDATE tipos_pago SET concepto = $1, monto = $2, tipo = $3 WHERE id = $4 RETURNING *',
      [concepto, monto, tipo, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tipos_pago WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json({ message: 'Tipo de pago eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tipos_pago WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json({ message: 'Tipo de pago eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
