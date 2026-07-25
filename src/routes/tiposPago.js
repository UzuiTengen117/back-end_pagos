const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_pago ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tipos_pago ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tipos_pago WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json({ message: 'Tipo de pago eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tipos_pago WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Tipo de pago no encontrado' });
    }
    res.json({ message: 'Tipo de pago eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
