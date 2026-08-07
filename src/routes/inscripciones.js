const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authorize } = require('../middleware/auth');
const { alumnoScope } = require('../middleware/scope');
const { internalError } = require('../utils/httpError');

router.get('/', async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause}` : '';
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ${where}
      ORDER BY i.id DESC
    `, scope.params);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause}` : '';
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ${where}
      ORDER BY i.id DESC
    `, scope.params);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const scope = alumnoScope(req);
    const where = scope.clause ? ` WHERE ${scope.clause} AND i.id = $2` : ' WHERE i.id = $1';
    const params = scope.clause ? [...scope.params, id] : [id];
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ${where}
    `, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
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
    const where = scope.clause ? ` WHERE ${scope.clause} AND i.id = $2` : ' WHERE i.id = $1';
    const params = scope.clause ? [...scope.params, id] : [id];
    const result = await pool.query(`
      SELECT i.*, a.nombre AS alumno_nombre, a.primer_apellido AS alumno_primer_apellido,
             a.segundo_apellido AS alumno_segundo_apellido, a.grado AS alumno_grado
      FROM inscripciones i
      JOIN alumnos a ON i.alumno_id = a.id
      ${where}
    `, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', authorize('admin', 'profesor'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.post('/', authorize('admin', 'profesor'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.put('/editar/:id', authorize('admin', 'profesor'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.put('/:id', authorize('admin', 'profesor'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM inscripciones WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json({ message: 'Inscripción eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/:id', authorize('admin', 'profesor'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM inscripciones WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Inscripción no encontrada' });
    }
    res.json({ message: 'Inscripción eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
