const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authorize } = require('../middleware/auth');
const { internalError } = require('../utils/httpError');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM becas ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM becas ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
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
    internalError(res, error);
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
    internalError(res, error);
  }
});

router.post('/agregar', authorize('admin'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.post('/', authorize('admin'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.put('/editar/:id', authorize('admin'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.put('/:id', authorize('admin'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM becas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json({ message: 'Beca eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM becas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Beca no encontrada' });
    }
    res.json({ message: 'Beca eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
