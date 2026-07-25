const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/disponibles', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol,
             b.nombre AS beca_nombre, b.porcentaje AS beca_porcentaje
      FROM alumnos a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN becas b ON a.beca_id = b.id
      WHERE a.usuario_id IS NULL
      ORDER BY a.nombre ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol,
             b.nombre AS beca_nombre, b.porcentaje AS beca_porcentaje
      FROM alumnos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN becas b ON a.beca_id = b.id
      ORDER BY a.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol,
             b.nombre AS beca_nombre, b.porcentaje AS beca_porcentaje
      FROM alumnos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN becas b ON a.beca_id = b.id
      ORDER BY a.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol,
             b.nombre AS beca_nombre, b.porcentaje AS beca_porcentaje
      FROM alumnos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN becas b ON a.beca_id = b.id
      WHERE a.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.rol,
             b.nombre AS beca_nombre, b.porcentaje AS beca_porcentaje
      FROM alumnos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN becas b ON a.beca_id = b.id
      WHERE a.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar', async (req, res) => {
  try {
    const { nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id } = req.body;

    if (!nombre || !primer_apellido || !usuario_id || !email || !grado) {
      return res.status(400).json({ message: 'Nombre, primer apellido, usuario_id, email y grado son requeridos' });
    }

    const userCheck = await pool.query('SELECT id FROM usuarios WHERE id = $1', [usuario_id]);
    if (userCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El usuario no existe' });
    }

    if (beca_id) {
      const becaCheck = await pool.query('SELECT id FROM becas WHERE id = $1', [beca_id]);
      if (becaCheck.rows.length === 0) {
        return res.status(400).json({ message: 'La beca no existe' });
      }
    }

    const result = await pool.query(
      'INSERT INTO alumnos (nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [nombre, primer_apellido, segundo_apellido || null, usuario_id, email, telefono || null, grado, beca_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id } = req.body;

    if (!nombre || !primer_apellido || !usuario_id || !email || !grado) {
      return res.status(400).json({ message: 'Nombre, primer apellido, usuario_id, email y grado son requeridos' });
    }

    const userCheck = await pool.query('SELECT id FROM usuarios WHERE id = $1', [usuario_id]);
    if (userCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El usuario no existe' });
    }

    if (beca_id) {
      const becaCheck = await pool.query('SELECT id FROM becas WHERE id = $1', [beca_id]);
      if (becaCheck.rows.length === 0) {
        return res.status(400).json({ message: 'La beca no existe' });
      }
    }

    const result = await pool.query(
      'INSERT INTO alumnos (nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [nombre, primer_apellido, segundo_apellido || null, usuario_id, email, telefono || null, grado, beca_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id } = req.body;

    if (beca_id) {
      const becaCheck = await pool.query('SELECT id FROM becas WHERE id = $1', [beca_id]);
      if (becaCheck.rows.length === 0) {
        return res.status(400).json({ message: 'La beca no existe' });
      }
    }

    const result = await pool.query(
      'UPDATE alumnos SET nombre = $1, primer_apellido = $2, segundo_apellido = $3, usuario_id = $4, email = $5, telefono = $6, grado = $7, beca_id = $8 WHERE id = $9 RETURNING *',
      [nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id } = req.body;

    if (beca_id) {
      const becaCheck = await pool.query('SELECT id FROM becas WHERE id = $1', [beca_id]);
      if (becaCheck.rows.length === 0) {
        return res.status(400).json({ message: 'La beca no existe' });
      }
    }

    const result = await pool.query(
      'UPDATE alumnos SET nombre = $1, primer_apellido = $2, segundo_apellido = $3, usuario_id = $4, email = $5, telefono = $6, grado = $7, beca_id = $8 WHERE id = $9 RETURNING *',
      [nombre, primer_apellido, segundo_apellido, usuario_id, email, telefono, grado, beca_id || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM alumnos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json({ message: 'Alumno eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM alumnos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    res.json({ message: 'Alumno eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
