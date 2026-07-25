const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM becas ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM becas ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM becas WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM becas WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar', async (req, res) => {
  try {
    const { nombre, porcentaje, estado, descripcion } = req.body;

    if (!nombre || !porcentaje) {
      return res.status(400).json({ message: 'Nombre y porcentaje son requeridos' });
    }

    const becasPermitidas = [25, 50, 75, 100];
    if (!becasPermitidas.includes(Number(porcentaje))) {
      return res.status(400).json({ message: 'Porcentaje no válido. Permitidos: 25, 50, 75, 100' });
    }

    const result = await pool.query(
      'INSERT INTO becas (nombre, porcentaje, estado, descripcion) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, porcentaje, estado || 'activa', descripcion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, porcentaje, estado, descripcion } = req.body;

    if (!nombre || !porcentaje) {
      return res.status(400).json({ message: 'Nombre y porcentaje son requeridos' });
    }

    const becasPermitidas = [25, 50, 75, 100];
    if (!becasPermitidas.includes(Number(porcentaje))) {
      return res.status(400).json({ message: 'Porcentaje no válido. Permitidos: 25, 50, 75, 100' });
    }

    const result = await pool.query(
      'INSERT INTO becas (nombre, porcentaje, estado, descripcion) VALUES ($1, $2, $3, $4) RETURNING *',
      [nombre, porcentaje, estado || 'activa', descripcion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, porcentaje, estado, descripcion } = req.body;

    if (porcentaje) {
      const becasPermitidas = [25, 50, 75, 100];
      if (!becasPermitidas.includes(Number(porcentaje))) {
        return res.status(400).json({ message: 'Porcentaje no válido. Permitidos: 25, 50, 75, 100' });
      }
    }

    const result = await pool.query(
      'UPDATE becas SET nombre = $1, porcentaje = $2, estado = $3, descripcion = $4 WHERE id = $5 RETURNING *',
      [nombre, porcentaje, estado, descripcion, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, porcentaje, estado, descripcion } = req.body;

    if (porcentaje) {
      const becasPermitidas = [25, 50, 75, 100];
      if (!becasPermitidas.includes(Number(porcentaje))) {
        return res.status(400).json({ message: 'Porcentaje no válido. Permitidos: 25, 50, 75, 100' });
      }
    }

    const result = await pool.query(
      'UPDATE becas SET nombre = $1, porcentaje = $2, estado = $3, descripcion = $4 WHERE id = $5 RETURNING *',
      [nombre, porcentaje, estado, descripcion, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM becas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json({ message: 'Beca eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM becas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json({ message: 'Beca eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
