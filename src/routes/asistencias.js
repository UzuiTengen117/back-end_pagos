const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { permite } = require('../middleware/permisos');
const { authorize } = require('../middleware/auth');
const { isEstudiante, alumnoScope } = require('../middleware/scope');
const { internalError } = require('../utils/httpError');
const { emitirTokenQr, verificarTokenQr } = require('../utils/qrToken');

const SEDES = ['Progreso', 'Morelos'];

// La clase se define por sede, no por grupo: el profesor abre la sede y
// registra a quien llegue, sea del grado que sea. La columna grado se conserva
// con este valor en vez de dejarla NULL para no romper el indice unico parcial
// (en Postgres los NULL no se consideran duplicados entre si, asi que el indice
// dejaria de proteger) ni los reportes ya hechos. Si el grado guardado es
// distinto a GRADO_TODOS, la sesion se trata como clase de un solo grupo, que es
// lo que hai en las clases abiertas antes de este cambio.
const GRADO_TODOS = 'Todos';

function norm(s) { return (s || '').trim().toLowerCase(); }

// Compara por color base: "Cinta Roja avanzada" coincide con "Cinta Roja",
// "cinta negra 1er dan" con "Cinta Negra 1er Dan", etc. Permite que existan
// variaciones en la BD sin bloquear el escaneo.
function colorBase(s) {
  const str = norm(s);
  const match = str.match(/cinta\s+(blanca|amarilla|naranja|verde|azul|roja|negra)/);
  return match ? match[1] : str;
}

// El alumno pide el token de su QR. Se renueva solo desde el frontend,
// por eso la vigencia es corta y vive en qrToken.js.
router.get('/mi-qr', async (req, res) => {
  if (!isEstudiante(req)) {
    return res.status(403).json({ message: 'Solo los estudiantes pueden generar su QR de asistencia' });
  }
  try {
    const result = await pool.query(
      `SELECT a.id, a.nombre, a.primer_apellido, a.segundo_apellido, a.grado, a.sede,
              a.email, u.username, u.foto
       FROM alumnos a
       JOIN usuarios u ON a.usuario_id = u.id
       WHERE a.usuario_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No se encontro el registro de alumno de este usuario' });
    }
    const alumno = result.rows[0];
    res.json({
      token: emitirTokenQr(alumno.id),
      alumno: {
        id: alumno.id,
        nombre: alumno.nombre,
        primer_apellido: alumno.primer_apellido,
        segundo_apellido: alumno.segundo_apellido,
        username: alumno.username,
        grado: alumno.grado,
        sede: alumno.sede,
        email: alumno.email,
        foto: alumno.foto,
      },
    });
  } catch (error) {
    internalError(res, error);
  }
});

// Historial del alumno. El scope impide que un estudiante vea el de otro.
router.get('/mis-asistencias', async (req, res) => {
  if (!isEstudiante(req)) {
    return res.status(403).json({ message: 'Solo los estudiantes pueden ver su propio historial' });
  }
  try {
    const result = await pool.query(
      `SELECT s.id, s.grado, s.sede, s.fecha, s.abierta,
              a.id AS registro_id, a.metodo, a.created_at AS registrado_at
       FROM asistencias a
       JOIN asistencia_sesiones s ON a.sesion_id = s.id
       JOIN alumnos al ON a.alumno_id = al.id
       WHERE al.usuario_id = $1
       ORDER BY s.fecha DESC, a.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// El profesor abre la clase del dia. Se elige la sede: el grupo lo determinan
// los alumnos que llegan, no el select. Reutiliza la sesion abierta de la misma
// sede en vez de crear otra, para no fragmentar el registro.
router.post('/abrir-sesion', permite('asistencias', 'registrar:tomar_asistencia'), async (req, res) => {
  try {
    const { sede } = req.body;
    if (!SEDES.includes(sede)) {
      return res.status(400).json({ message: 'La sede debe ser Progreso o Morelos' });
    }

    // El filtro es solo por sede, no por grado: asi una sesion heredada de un
    // grupo especifico tambien se reutiliza en vez de quedar abierta en
    // paralelo y partir el registro de la sede en dos.
    const abierta = await pool.query(
      `SELECT * FROM asistencia_sesiones
       WHERE profesor_id = $1 AND sede = $2 AND abierta = TRUE`,
      [req.user.id, sede]
    );
    if (abierta.rows.length > 0) {
      return res.json(abierta.rows[0]);
    }

    const creada = await pool.query(
      `INSERT INTO asistencia_sesiones (grado, sede, profesor_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [GRADO_TODOS, sede, req.user.id]
    );
    res.status(201).json(creada.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/cerrar-sesion/:id', permite('asistencias', 'registrar:tomar_asistencia'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE asistencia_sesiones
       SET abierta = FALSE, cerrada_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND profesor_id = $2
       RETURNING *`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Sesion no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

// Sesion abierta actual del profesor, para que el frontend la recupere
// al recargar en lugar de perderla.
router.get('/sesion-actual', permite('asistencias', 'ver:tomar_asistencia'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM asistencia_sesiones
       WHERE profesor_id = $1 AND abierta = TRUE
       ORDER BY id DESC`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (error) {
    internalError(res, error);
  }
});

// Listado de clases de todas las sedes, que es la base del reporte.
// Va con su propio permiso (`reportar`) para que ver una clase en vivo no
// implica poder ver el historial completo de la escuela.
router.get('/sesiones', permite('asistencias', 'reportar:reporte_asistencias'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.nombre AS profesor_nombre, u.primer_apellido AS profesor_apellido,
              COUNT(a.id)::int AS total_asistencias
       FROM asistencia_sesiones s
       JOIN usuarios u ON s.profesor_id = u.id
       LEFT JOIN asistencias a ON a.sesion_id = s.id
       GROUP BY s.id, u.nombre, u.primer_apellido
        ORDER BY s.fecha DESC, s.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// Borrar una clase del reporte. Solo administradores: la clase arrastra sus
// asistencias por ON DELETE CASCADE, asi que la decision no se delega a un
// permiso granular.
router.delete('/sesiones/:id', authorize('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'El id de la sesion es requerido' });
    }
    const result = await pool.query(
      `DELETE FROM asistencia_sesiones
       WHERE id = $1
       RETURNING id, grado, sede, fecha,
                 (SELECT COUNT(*)::int FROM asistencias a WHERE a.sesion_id = $1) AS asistencias_borradas`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Clase no encontrada' });
    }
    const b = result.rows[0];
    res.json({
      message: `Clase del ${b.fecha} eliminada junto con ${b.asistencias_borradas} asistencias`,
      asistencias_eliminadas: b.asistencias_borradas,
    });
  } catch (error) {
    internalError(res, error);
  }
});

// Alumnos esperados en la sesion con su estado de asistencia. El profesor ve
// tambien a quien no ha llegado todavia. Como la clase es por sede, entra
// todo alumno de esa sede; el filtro por grado solo se aplica a las clases
// heredadas que si se crearon por grupo.
router.get('/sesion/:id/alumnos', permite('asistencias', 'ver:tomar_asistencia'), async (req, res) => {
  try {
    const { id } = req.params;
    const sesion = await pool.query(
      'SELECT * FROM asistencia_sesiones WHERE id = $1',
      [id]
    );
    if (sesion.rows.length === 0) {
      return res.status(404).json({ message: 'Sesion no encontrada' });
    }
    const { grado, sede } = sesion.rows[0];
    const soloSede = String(grado).toLowerCase() === GRADO_TODOS.toLowerCase();

    const result = await pool.query(
      `SELECT a.id, a.nombre, a.primer_apellido, a.segundo_apellido, a.grado, a.sede,
              u.foto, asis.id AS asistencia_id, asis.metodo, asis.created_at AS registrado_at
       FROM alumnos a
       JOIN usuarios u ON a.usuario_id = u.id
       LEFT JOIN asistencias asis ON asis.alumno_id = a.id AND asis.sesion_id = $1
       WHERE a.sede = $2
         ${soloSede ? '' : 'AND LOWER(a.grado) = LOWER($3)'}
       ORDER BY a.primer_apellido ASC, a.nombre ASC`,
      soloSede ? [id, sede] : [id, sede, grado]
    );
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// Registro por escaneo de QR o por captura manual. El cuerpo es el mismo
// para ambos: cambia solo de donde sale el alumnoId.
router.post('/registrar', permite('asistencias', 'registrar:tomar_asistencia'), async (req, res) => {
  try {
    const { token, alumno_id, sesion_id } = req.body;
    if (!sesion_id) {
      return res.status(400).json({ message: 'El sesion_id es requerido' });
    }

    let alumnoId = alumno_id;
    if (token) {
      let verificado;
      try {
        verificado = verificarTokenQr(token);
      } catch (error) {
        const expirado = error.message === 'Qr expirado';
        return res.status(expirado ? 410 : 400).json({ message: error.message });
      }
      alumnoId = verificado.alumnoId;
    }
    if (!alumnoId) {
      return res.status(400).json({ message: 'Se requiere el token QR o el alumno_id' });
    }

    // La sesion debe estar abierta y pertenecer a quien escanea. Sin esto
    // un profesor podria registrar alumnos en la clase de otro.
    const sesion = await pool.query(
      'SELECT * FROM asistencia_sesiones WHERE id = $1 AND profesor_id = $2',
      [sesion_id, req.user.id]
    );
    if (sesion.rows.length === 0) {
      return res.status(404).json({ message: 'Sesion no encontrada' });
    }
    if (!sesion.rows[0].abierta) {
      return res.status(409).json({ message: 'La sesion ya esta cerrada' });
    }
    const { grado, sede } = sesion.rows[0];

    const alumno = await pool.query(
      `SELECT id, nombre, primer_apellido, segundo_apellido, grado, sede
       FROM alumnos WHERE id = $1`,
      [alumnoId]
    );
    if (alumno.rows.length === 0) {
      return res.status(404).json({ message: 'Alumno no encontrado' });
    }
    const a = alumno.rows[0];
    // La sede siempre se respeta. El grado solo se compara en las clases
    // heredadas, que si eran de un grupo: en una clase por sede entra cualquier
    // alumno de esa sede. Ahi "Cinta Roja avanzada" y "Cinta Roja" se tratan
    // como el mismo grupo, que es lo que permitia el colorBase.
    const soloSede = String(grado).toLowerCase() === GRADO_TODOS.toLowerCase();
    if (norm(a.sede) !== norm(sede) || (!soloSede && colorBase(a.grado) !== colorBase(grado))) {
      return res.status(400).json({
        message: `El alumno es de ${a.grado} / ${a.sede} y esta clase es de ${grado} / ${sede}`,
      });
    }

    const metodo = token ? 'qr' : 'manual';
    // created_at se fija aqui de forma explicita en lugar de confiar en el
    // DEFAULT de la columna: si el despliegue arrastra una tabla creada sin ese
    // default, el registro se guardaba con la hora nula y la lista salia en "-".
    const registro = await pool.query(
      `INSERT INTO asistencias (sesion_id, alumno_id, registrado_por, metodo, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (sesion_id, alumno_id) DO NOTHING
       RETURNING *`,
      [sesion_id, alumnoId, req.user.id, metodo]
    );

    if (registro.rows.length === 0) {
      return res.status(409).json({
        message: 'El alumno ya tiene asistencia registrada en esta clase',
        alumno: a,
        duplicado: true,
      });
    }

    res.status(201).json({ ...registro.rows[0], alumno: a, duplicado: false });
  } catch (error) {
    internalError(res, error);
  }
});

// Quita un registro. Necesario cuando el profesor escanea a la persona
// equivocada y necesita corregirlo durante la misma clase.
router.delete('/:id', permite('asistencias', 'registrar:tomar_asistencia'), async (req, res) => {
  try {
    const { id } = req.params;
    // El borrado se limita a sesiones del propio profesor: sin este filtro
    // cualquiera con el permiso eliminaria asistencias de otra clase.
    const result = await pool.query(
      `DELETE FROM asistencias a
       USING asistencia_sesiones s
       WHERE a.id = $1 AND a.sesion_id = s.id AND s.profesor_id = $2
       RETURNING a.id`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Asistencia no encontrada' });
    }
    res.json({ message: 'Asistencia eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
