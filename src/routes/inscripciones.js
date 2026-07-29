const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ORDER BY i.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ORDER BY i.id DESC
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
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      WHERE i.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
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
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      WHERE i.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agregar', async (req, res) => {
  try {
    const { alumno_id, fecha_inscripcion, ciclo_escolar, grado, monto_inscripcion } = req.body;

    if (!alumno_id || !fecha_inscripcion || !ciclo_escolar) {
      return res.status(400).json({ message: 'alumno_id, fecha_inscripcion y ciclo_escolar son requeridos' });
    }

    const alumnoCheck = await pool.query('SELECT id FROM alumnos WHERE id = $1', [alumno_id]);
    if (alumnoCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El alumno no existe' });
    }

    const result = await pool.query(
      `INSERT INTO inscripciones (alumno_id, fecha_inscripcion, ciclo_escolar, grado, monto_inscripcion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [alumno_id, fecha_inscripcion, ciclo_escolar, grado || null, monto_inscripcion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { alumno_id, fecha_inscripcion, ciclo_escolar, grado, monto_inscripcion } = req.body;

    if (!alumno_id || !fecha_inscripcion || !ciclo_escolar) {
      return res.status(400).json({ message: 'alumno_id, fecha_inscripcion y ciclo_escolar son requeridos' });
    }

    const alumnoCheck = await pool.query('SELECT id FROM alumnos WHERE id = $1', [alumno_id]);
    if (alumnoCheck.rows.length === 0) {
      return res.status(400).json({ message: 'El alumno no existe' });
    }

    const result = await pool.query(
      `INSERT INTO inscripciones (alumno_id, fecha_inscripcion, ciclo_escolar, grado, monto_inscripcion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [alumno_id, fecha_inscripcion, ciclo_escolar, grado || null, monto_inscripcion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, fecha_inscripcion, ciclo_escolar, grado, estado, monto_inscripcion } = req.body;

    const result = await pool.query(
      `UPDATE inscripciones SET alumno_id = $1, fecha_inscripcion = $2, ciclo_escolar = $3,
       grado = $4, estado = $5, monto_inscripcion = $6 WHERE id = $7 RETURNING *`,
      [alumno_id, fecha_inscripcion, ciclo_escolar, grado, estado, monto_inscripcion, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { alumno_id, fecha_inscripcion, ciclo_escolar, grado, estado, monto_inscripcion } = req.body;

    const result = await pool.query(
      `UPDATE inscripciones SET alumno_id = $1, fecha_inscripcion = $2, ciclo_escolar = $3,
       grado = $4, estado = $5, monto_inscripcion = $6 WHERE id = $7 RETURNING *`,
      [alumno_id, fecha_inscripcion, ciclo_escolar, grado, estado, monto_inscripcion, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM inscripciones WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json({ message: 'Inscripción eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM inscripciones WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json({ message: 'Inscripción eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
