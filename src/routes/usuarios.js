const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const pool = require('../config/database');
const { auth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const USUARIO_FIELDS = 'id, nombre, primer_apellido, segundo_apellido, username, email, rol, foto, created_at';

function expiresInToMs(value) {
  const match = String(value).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const ms = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return parseInt(match[1], 10) * ms[match[2]];
}

const SESSION_TTL_MS = expiresInToMs(JWT_EXPIRES_IN);

router.post('/registro', async (req, res) => {
  try {
    const { nombre, primer_apellido, segundo_apellido, username, email, password, rol } = req.body;

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
      `INSERT INTO usuarios (nombre, primer_apellido, segundo_apellido, username, email, password, rol, token_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0) RETURNING ${USUARIO_FIELDS}, token_version`,
      [nombre, primer_apellido || null, segundo_apellido || null, username, email, hashedPassword, rol]
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

    if (user.last_login_at) {
      const lastLogin = new Date(user.last_login_at).getTime();
      if (Date.now() - lastLogin < SESSION_TTL_MS) {
        return res.status(403).json({
          message: 'Ya existe una sesión activa para este usuario. Cierra sesión en el otro dispositivo o espera a que expire.'
        });
      }
    }

    const updated = await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1, last_login_at = NOW() WHERE id = $1 RETURNING token_version',
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
        primer_apellido: user.primer_apellido,
        segundo_apellido: user.segundo_apellido,
        username: user.username,
        email: user.email,
        rol: user.rol,
        foto: user.foto
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token) {
      return res.status(401).json({ message: 'Token de acceso requerido' });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    await pool.query('UPDATE usuarios SET last_login_at = NULL WHERE id = $1', [decoded.id]);
    res.json({ message: 'Sesión cerrada' });
  } catch (error) {
    res.status(401).json({ message: 'Token inválido' });
  }
});

router.put('/editar/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, primer_apellido, segundo_apellido, username, email, password, rol } = req.body;

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
      query = `UPDATE usuarios SET nombre = $1, primer_apellido = $2, segundo_apellido = $3, username = $4, email = $5, password = $6, rol = $7, last_login_at = NULL WHERE id = $8 RETURNING ${USUARIO_FIELDS}`;
      params = [nombre, primer_apellido || null, segundo_apellido || null, username, email, hashedPassword, rol, id];
    } else {
      query = `UPDATE usuarios SET nombre = $1, primer_apellido = $2, segundo_apellido = $3, username = $4, email = $5, rol = $6 WHERE id = $7 RETURNING ${USUARIO_FIELDS}`;
      params = [nombre, primer_apellido || null, segundo_apellido || null, username, email, rol, id];
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

router.post('/upload-photo', auth, upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se envió ninguna imagen' });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: 'Formato no válido. Solo se permiten JPG, PNG y WEBP' });
    }

    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    const userId = req.user.id;
    const result = await pool.query(
      `UPDATE usuarios SET foto = $1 WHERE id = $2 RETURNING ${USUARIO_FIELDS}`,
      [dataUrl, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ url: dataUrl, usuario: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/eliminar/:id', auth, async (req, res) => {
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

router.get('/buscar', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ message: 'El parámetro username es requerido' });
    }
    const result = await pool.query(
      `SELECT ${USUARIO_FIELDS} FROM usuarios WHERE username = $1`,
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${USUARIO_FIELDS} FROM usuarios`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT ${USUARIO_FIELDS} FROM usuarios WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
