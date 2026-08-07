const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const pool = require('../config/database');
const { auth, authorize, JWT_SECRET } = require('../middleware/auth');
const { loginLimiter, sensitiveLimiter } = require('../middleware/rateLimiter');
const { internalError } = require('../utils/httpError');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const ROLES_PERMITIDOS = ['admin', 'profesor', 'estudiante'];

const USUARIO_FIELDS = 'id, nombre, primer_apellido, segundo_apellido, username, email, rol, foto, pregunta_secreta, created_at';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function expiresInToMs(value) {
  const match = String(value).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const ms = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return parseInt(match[1], 10) * ms[match[2]];
}

const SESSION_TTL_MS = expiresInToMs(JWT_EXPIRES_IN);

function cleanString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

router.post('/registro', auth, authorize('admin'), sensitiveLimiter, async (req, res) => {
  try {
    const { nombre, primer_apellido, segundo_apellido, username, email, password, rol, pregunta_secreta, respuesta_secreta } = req.body;

    const nombreClean = cleanString(nombre, 255);
    const usernameClean = cleanString(username, 255);
    const emailClean = cleanString(email, 255);
    const passwordClean = String(password || '');
    const apellido1 = cleanString(primer_apellido, 255);
    const apellido2 = cleanString(segundo_apellido, 255);
    const preguntaClean = cleanString(pregunta_secreta, 500);
    const respuestaClean = cleanString(respuesta_secreta, 500);

    if (!nombreClean || !usernameClean || !emailClean || !passwordClean || !rol) {
      return res.status(400).json({ message: 'Nombre, username, email, password y rol son requeridos' });
    }

    if (!ROLES_PERMITIDOS.includes(rol)) {
      return res.status(400).json({ message: 'Rol no válido. Roles permitidos: admin, profesor, estudiante' });
    }

    if (passwordClean.length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
    }

    if ((preguntaClean && !respuestaClean) || (!preguntaClean && respuestaClean)) {
      return res.status(400).json({ message: 'La pregunta y la respuesta de seguridad deben ir juntas' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordClean, salt);
    const hashedRespuesta = respuestaClean ? await bcrypt.hash(respuestaClean, salt) : null;

    const result = await pool.query(
      `INSERT INTO usuarios (nombre, primer_apellido, segundo_apellido, username, email, password, rol, token_version, pregunta_secreta, respuesta_secreta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9) RETURNING ${USUARIO_FIELDS}, token_version`,
      [nombreClean, apellido1 || null, apellido2 || null, usernameClean, emailClean, hashedPassword, rol, preguntaClean || null, hashedRespuesta]
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
    internalError(res, error);
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 255);
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({ message: 'Username y password son requeridos' });
    }

    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
    const user = result.rows[0];

    if (user && user.locked_until) {
      const lockedUntil = new Date(user.locked_until).getTime();
      if (lockedUntil > Date.now()) {
        return res.status(429).json({ message: 'Demasiados intentos fallidos. Intenta de nuevo más tarde.' });
      }
      await pool.query('UPDATE usuarios SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    }

    const validPassword = user ? await bcrypt.compare(password, user.password) : false;

    if (!user || !validPassword) {
      if (user) {
        await pool.query(
          `UPDATE usuarios SET failed_attempts = failed_attempts + 1,
             locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END
           WHERE id = $1`,
          [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES]
        );
      }
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    await pool.query('UPDATE usuarios SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

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
    internalError(res, error);
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

router.get('/pregunta-secreta', sensitiveLimiter, async (req, res) => {
  try {
    const username = cleanString(req.query.username, 255);
    if (!username) {
      return res.status(400).json({ message: 'El parámetro username es requerido' });
    }
    const result = await pool.query(
      'SELECT pregunta_secreta FROM usuarios WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0 || !result.rows[0].pregunta_secreta) {
      return res.status(404).json({ message: 'No se encontró una pregunta de seguridad para este usuario' });
    }
    res.json({ pregunta: result.rows[0].pregunta_secreta });
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/recuperar-contrasena', sensitiveLimiter, async (req, res) => {
  try {
    const username = cleanString(req.body.username, 255);
    const respuesta = cleanString(req.body.respuesta, 500);
    const newPassword = String(req.body.newPassword || '');

    if (!username || !respuesta || !newPassword) {
      return res.status(400).json({ message: 'Username, respuesta y newPassword son requeridos' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const result = await pool.query(
      'SELECT id, respuesta_secreta, locked_until FROM usuarios WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'No se pudo restablecer la contraseña' });
    }
    const user = result.rows[0];
    if (!user.respuesta_secreta) {
      return res.status(400).json({ message: 'No se pudo restablecer la contraseña' });
    }

    const respuestaValida = await bcrypt.compare(respuesta, user.respuesta_secreta);
    if (!respuestaValida) {
      return res.status(400).json({ message: 'La respuesta de seguridad es incorrecta' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.query(
      `UPDATE usuarios
       SET password = $1, token_version = token_version + 1, failed_attempts = 0, locked_until = NULL, last_login_at = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.json({ message: 'Contraseña restablecida exitosamente' });
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const targetId = Number(id);
    const isAdmin = req.user.rol === 'admin';
    const isSelf = targetId === req.user.id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ message: 'No tienes permiso para editar este usuario' });
    }

    const { nombre, primer_apellido, segundo_apellido, username, email, password, currentPassword, rol, foto, pregunta_secreta, respuesta_secreta } = req.body;

    const nombreClean = cleanString(nombre, 255);
    const usernameClean = cleanString(username, 255);
    const emailClean = cleanString(email, 255);
    const apellido1 = cleanString(primer_apellido, 255);
    const apellido2 = cleanString(segundo_apellido, 255);
    const preguntaClean = cleanString(pregunta_secreta, 500);
    const respuestaClean = cleanString(respuesta_secreta, 500);

    if (!nombreClean || !usernameClean || !emailClean) {
      return res.status(400).json({ message: 'Nombre, username y email son requeridos' });
    }

    if (pregunta_secreta !== undefined) {
      if (respuesta_secreta === undefined) {
        return res.status(400).json({ message: 'La pregunta y la respuesta de seguridad deben ir juntas' });
      }
      if (!preguntaClean || !respuestaClean) {
        return res.status(400).json({ message: 'La pregunta y la respuesta de seguridad no pueden estar vacías' });
      }
    }

    const finalRol = isAdmin ? rol : req.user.rol;
    if (finalRol && !ROLES_PERMITIDOS.includes(finalRol)) {
      return res.status(400).json({ message: 'Rol no válido. Roles permitidos: admin, profesor, estudiante' });
    }

    let hashedPassword;
    if (password) {
      if (!isAdmin) {
        if (!currentPassword) {
          return res.status(400).json({ message: 'Debes ingresar tu contraseña actual para cambiarla' });
        }
        const userRow = await pool.query('SELECT password FROM usuarios WHERE id = $1', [targetId]);
        if (userRow.rows.length === 0) {
          return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        const valid = await bcrypt.compare(currentPassword, userRow.rows[0].password);
        if (!valid) {
          return res.status(400).json({ message: 'La contraseña actual es incorrecta' });
        }
      }
      if (String(password).length < 6) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
      }
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    let hashedRespuesta;
    if (respuesta_secreta !== undefined && respuestaClean) {
      hashedRespuesta = await bcrypt.hash(respuestaClean, 10);
    }

    const hasFoto = req.body.foto !== undefined;
    const set = [];
    const p = [];
    set.push(`nombre = $${p.length + 1}`); p.push(nombreClean);
    set.push(`primer_apellido = $${p.length + 1}`); p.push(apellido1 || null);
    set.push(`segundo_apellido = $${p.length + 1}`); p.push(apellido2 || null);
    set.push(`username = $${p.length + 1}`); p.push(usernameClean);
    set.push(`email = $${p.length + 1}`); p.push(emailClean);
    if (hashedPassword) {
      set.push(`password = $${p.length + 1}`); p.push(hashedPassword);
      set.push('last_login_at = NULL');
    }
    set.push(`rol = $${p.length + 1}`); p.push(finalRol);
    if (hasFoto) {
      set.push(`foto = $${p.length + 1}`); p.push(foto);
    }
    if (pregunta_secreta !== undefined) {
      set.push(`pregunta_secreta = $${p.length + 1}`); p.push(preguntaClean);
      set.push(`respuesta_secreta = $${p.length + 1}`); p.push(hashedRespuesta);
    }
    p.push(targetId);
    const query = `UPDATE usuarios SET ${set.join(', ')} WHERE id = $${p.length} RETURNING ${USUARIO_FIELDS}`;

    const result = await pool.query(query, p);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'El username o email ya está registrado' });
    }
    internalError(res, error);
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
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const targetId = Number(id);
    if (targetId === req.user.id) {
      return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
    }
    const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [targetId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/reset-password', auth, authorize('admin'), sensitiveLimiter, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ message: 'userId y newPassword son requeridos' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    const result = await pool.query(
      'UPDATE usuarios SET password = $1, last_login_at = NULL, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING id',
      [hashedPassword, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/buscar', auth, authorize('admin'), async (req, res) => {
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
    internalError(res, error);
  }
});

router.get('/', auth, async (req, res) => {
  try {
    if (req.user.rol === 'admin') {
      const result = await pool.query(`SELECT ${USUARIO_FIELDS} FROM usuarios`);
      return res.json(result.rows);
    }
    const result = await pool.query(`SELECT ${USUARIO_FIELDS} FROM usuarios WHERE id = $1`, [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const targetId = Number(id);
    if (req.user.rol !== 'admin' && targetId !== req.user.id) {
      return res.status(403).json({ message: 'No tienes permiso para ver este usuario' });
    }
    const result = await pool.query(`SELECT ${USUARIO_FIELDS} FROM usuarios WHERE id = $1`, [targetId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
