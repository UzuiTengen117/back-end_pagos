const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

router.post('/registro', async (req, res) => {
  try {
    const { nombre, username, email, password, rol } = req.body;

    if (!nombre || !username || !email || !password || !rol) {
      return res.status(400).json({ message: 'Nombre, username, email, password y rol son requeridos' });
    }

    const rolesPermitidos = ['admin', 'profesor', 'estudiante'];
    if (!rolesPermitidos.includes(rol)) {
      return res.status(400).json({ message: 'Rol no válido. Roles permitidos: admin, profesor, estudiante' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO usuarios (nombre, username, email, password, rol, token_version) VALUES ($1, $2, $3, $4, $5, 0) RETURNING id, nombre, username, email, rol, token_version, created_at',
      [nombre, username, email, hashedPassword, rol]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol, token_version: user.token_version },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({ token, usuario: user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El username o email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username y password son requeridos' });
    }

    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const updated = await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
      [user.id]
    );
    const tokenVersion = updated.rows[0].token_version;

    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol, token_version: tokenVersion },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        username: user.username,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/editar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, username, email, password, rol } = req.body;

    if (rol) {
      const rolesPermitidos = ['admin', 'profesor', 'estudiante'];
      if (!rolesPermitidos.includes(rol)) {
        return res.status(400).json({ message: 'Rol no válido. Roles permitidos: admin, profesor, estudiante' });
      }
    }

    let query, params;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      query = 'UPDATE usuarios SET nombre = $1, username = $2, email = $3, password = $4, rol = $5 WHERE id = $6 RETURNING id, nombre, username, email, rol, created_at';
      params = [nombre, username, email, hashedPassword, rol, id];
    } else {
      query = 'UPDATE usuarios SET nombre = $1, username = $2, email = $3, rol = $4 WHERE id = $5 RETURNING id, nombre, username, email, rol, created_at';
      params = [nombre, username, email, rol, id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El username o email ya está registrado' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, username, email, rol, created_at FROM usuarios');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT id, nombre, username, email, rol, created_at FROM usuarios WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
