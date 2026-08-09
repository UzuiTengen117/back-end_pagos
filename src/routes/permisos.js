const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authorize } = require('../middleware/auth');
const {
  MODULOS_ACCIONES,
  DEFAULTS,
  todasLasAcciones,
  obtenerPermisosUsuario,
  reemplazarPermisos,
} = require('../middleware/permisos');
const { internalError } = require('../utils/httpError');

// Estructura de módulos y acciones para construir la pantalla de permisos.
router.get('/modulos', async (req, res) => {
  res.json(MODULOS_ACCIONES);
});

// Permisos por defecto de un rol (para precargar la pantalla al crear usuario).
router.get('/defaults/:rol', async (req, res) => {
  const { rol } = req.params;
  if (rol === 'admin') {
    return res.json({ permisos: todasLasAcciones() });
  }
  if (!DEFAULTS[rol]) {
    return res.status(400).json({ message: 'Rol no válido' });
  }
  res.json({ permisos: [...DEFAULTS[rol]] });
});

// Permisos efectivos del usuario autenticado (para ocultar/mostrar acciones en la UI).
router.get('/mis', async (req, res) => {
  try {
    const permisos = await obtenerPermisosUsuario(req.user.id, req.user.rol);
    res.json({ permisos, rol: req.user.rol });
  } catch (error) {
    internalError(res, error);
  }
});

// Permisos efectivos de un usuario (solo admin).
router.get('/usuario/:id', authorize('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'El id del usuario es requerido' });
    }
    const target = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    const permisos = await obtenerPermisosUsuario(id, target.rows[0].rol);
    res.json({ permisos });
  } catch (error) {
    internalError(res, error);
  }
});

// Reemplaza el conjunto de permisos de un usuario (solo admin).
router.put('/usuario/:id', authorize('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'El id del usuario es requerido' });
    }
    const { permisos } = req.body;
    if (!Array.isArray(permisos)) {
      return res.status(400).json({ message: 'El campo permisos debe ser un arreglo' });
    }
    const target = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    await reemplazarPermisos(id, permisos, target.rows[0].rol);
    res.json({ message: 'Permisos actualizados' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
