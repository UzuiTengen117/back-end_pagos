const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const { permite } = require('../middleware/permisos');
const { internalError } = require('../utils/httpError');

const TIPOS = ['torneo', 'dual_meet', 'open', 'otro'];
const ESTADOS = ['programado', 'en_curso', 'finalizado', 'cancelado'];
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

// Un thumbnail de 480px a calidad 0.72 pesa ~40KB. 200KB es un techo holgado
// para casos raros y sigue siendo diminuto frente a los 2MB de la original.
const THUMB_MAX_BYTES = 200 * 1024;

// Limites espejo de las columnas en database.sql. Sin esto un nombre largo
// rebota como 22001 y el usuario ve un 500 en vez de un mensaje de campo.
const MAX_NOMBRE = 255;
const MAX_SEDE = 50;
const MAX_LUGAR = 255;
const MAX_CATEGORIAS = 255;
const MAX_LINK = 500;
// NUMERIC(10,2) admite 8 digitos enteros. Pasarse es 22003, tambien un 500.
const MAX_PRECIO = 99999999.99;

// Mismo limite que la foto de perfil. El despliegue es serverless y no hay
// disco: la imagen viaja como data URL dentro de la fila.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// El listado NUNCA pide la imagen completa. A 2MB el base64 ocupa 2.67MB por
// evento y Vercel corta la respuesta a 4.5MB: con dos banners la lista deja de
// llegar y se rompe la pagina entera, no solo la foto. Se manda el thumbnail
// bajo el alias `imagen` para que el frontend muestre lo mismo en las tarjetas
// y solo pida la original al abrir un evento.
//
// Sin COALESCE a la original a proposito: una fila vieja sin thumbnail se
// veria sin cartel, pero re-subirlo lo arregla. El fallback devolveria el
// problema de tamano justo en las filas que no se han vuelto a subir.
const SELECT_EVENTOS = `
  SELECT e.id, e.nombre, e.tipo, e.fecha_inicio, e.sede, e.lugar, e.categorias,
         e.descripcion, e.precio_inscripcion, e.cupo_maximo, e.link_registro,
         e.imagen_thumb AS imagen,
         e.estado, e.created_at, e.updated_at,
         (SELECT COUNT(*) FROM eventos_inscripciones ei
           WHERE ei.evento_id = e.id AND ei.estado = 'inscrito') AS inscritos,
         (SELECT ei.id FROM eventos_inscripciones ei
           WHERE ei.evento_id = e.id AND ei.usuario_id = $1 AND ei.estado = 'inscrito'
           LIMIT 1) AS mi_inscripcion
    FROM eventos e
`;

// Solo el detalle trae la original: una fila unica queda holgadamente bajo el
// limite de 4.5MB, y es la unica vista que necesita la imagen completa. Mantiene
// los mismos conteos que el listado para que la respuesta sea intercambiable.
const SELECT_EVENTO = `
  SELECT e.*,
         (SELECT COUNT(*) FROM eventos_inscripciones ei
           WHERE ei.evento_id = e.id AND ei.estado = 'inscrito') AS inscritos,
         (SELECT ei.id FROM eventos_inscripciones ei
           WHERE ei.evento_id = e.id AND ei.usuario_id = $1 AND ei.estado = 'inscrito'
           LIMIT 1) AS mi_inscripcion
    FROM eventos e
`;

const SELECT_INSCRITOS = `
  SELECT ei.id, ei.estado, ei.created_at,
         a.id AS alumno_id, a.nombre, a.primer_apellido, a.segundo_apellido,
         a.grado, a.sede
    FROM eventos_inscripciones ei
    JOIN alumnos a ON a.id = ei.alumno_id
   WHERE ei.evento_id = $1 AND ei.estado = 'inscrito'
   ORDER BY a.primer_apellido ASC, a.nombre ASC
`;

// Un id de ruta no numerico (letras, signo, decimal) llega hoy a Postgres y
// vuelve como 22P02, un 500 con stack en el log. Se normaliza a 404, que es lo
// que el cliente ya sabe pintar.
function parseId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// El alumno se resuelve por usuario, no por parametro: si el id del alumno
// viajara en el body, un estudiante podria inscribirse en nombre de otro.
async function obtenerAlumno(usuarioId) {
  const result = await pool.query('SELECT id FROM alumnos WHERE usuario_id = $1', [usuarioId]);
  return result.rows.length > 0 ? result.rows[0].id : null;
}

function texto(value, max, campo) {
  const limpio = (value || '').trim();
  if (limpio.length > max) {
    return { error: `${campo} no puede superar ${max} caracteres` };
  }
  return { valor: limpio || null };
}

// Valida y normaliza el cuerpo de alta/edicion. Devuelve { values } o { error }
// para responder 400 sin repetir el mismo bloque en los dos verbos.
function construirEvento(body) {
  const nombre = (body.nombre || '').trim();
  if (!nombre) {
    return { error: 'El nombre del evento es requerido' };
  }
  if (nombre.length > MAX_NOMBRE) {
    return { error: `El nombre no puede superar ${MAX_NOMBRE} caracteres` };
  }

  const tipo = body.tipo || 'torneo';
  if (!TIPOS.includes(tipo)) {
    return { error: 'Tipo no válido. Permitidos: torneo, dual meet, open, otro' };
  }

  const estado = body.estado || 'programado';
  if (!ESTADOS.includes(estado)) {
    return { error: 'Estado no válido. Permitidos: programado, en curso, finalizado, cancelado' };
  }

  if (!body.fecha_inicio) {
    return { error: 'La fecha y hora de inicio son requeridas' };
  }

  // Sin exigir zona horaria, "2026-10-15T18:00" se resuelve con la del SERVIDOR:
  // el mismo body se guardaria a horas distintas en local y en Vercel (UTC). Se
  // rechaza en vez de adivinar, porque un torneo se corre en una hora concreta.
  if (typeof body.fecha_inicio !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(body.fecha_inicio)) {
    return { error: 'La fecha de inicio debe incluir zona horaria (ISO 8601)' };
  }

  const inicio = new Date(body.fecha_inicio);
  if (Number.isNaN(inicio.getTime())) {
    return { error: 'La fecha y hora de inicio no son válidas' };
  }

  // El techo es suficiente para un torneo de dos años y evita que el reloj del
  // alumno muestre miles de dias.
  const cupoCrudo = body.cupo_maximo;
  let cupo = null;
  if (cupoCrudo !== null && cupoCrudo !== undefined && cupoCrudo !== '') {
    cupo = Number(cupoCrudo);
    if (!Number.isInteger(cupo) || cupo <= 0) {
      return { error: 'El cupo máximo debe ser un número entero mayor a 0' };
    }
    if (cupo > 10000) {
      return { error: 'El cupo máximo no puede ser mayor a 10000' };
    }
  }

  const precioCrudo = body.precio_inscripcion;
  let precio = 0;
  if (precioCrudo !== null && precioCrudo !== undefined && precioCrudo !== '') {
    precio = Number(precioCrudo);
    // isFinite y no isNaN: Infinity pasaria el NaN y desborda la columna.
    if (!Number.isFinite(precio) || precio < 0) {
      return { error: 'El precio de inscripción no puede ser negativo' };
    }
    if (precio > MAX_PRECIO) {
      return { error: `El precio de inscripción no puede superar ${MAX_PRECIO}` };
    }
    precio = Math.round(precio * 100) / 100;
  }

  const sede = texto(body.sede, MAX_SEDE, 'La sede');
  if (sede.error) return { error: sede.error };
  const lugar = texto(body.lugar, MAX_LUGAR, 'El lugar');
  if (lugar.error) return { error: lugar.error };
  const categorias = texto(body.categorias, MAX_CATEGORIAS, 'Las categorías');
  if (categorias.error) return { error: categorias.error };
  const link = texto(body.link_registro, MAX_LINK, 'El link de registro');
  if (link.error) return { error: link.error };

  return {
    values: {
      nombre,
      tipo,
      estado,
      fecha_inicio: inicio.toISOString(),
      sede: sede.valor,
      lugar: lugar.valor,
      categorias: categorias.valor,
      descripcion: (body.descripcion || '').trim() || null,
      precio_inscripcion: precio,
      cupo_maximo: cupo,
      link_registro: link.valor,
    },
  };
}

// Ruta principal del listado. El alias /ver se mantiene solo en lectura, como
// en el resto del repo: duplicar un GET no abre superficie de permisos porque
// ninguno lleva `permite`.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(SELECT_EVENTOS + ' ORDER BY e.fecha_inicio ASC', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query(SELECT_EVENTOS + ' ORDER BY e.fecha_inicio ASC', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    const result = await pool.query(SELECT_EVENTO + ' WHERE e.id = $2', [req.user.id, id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id/inscritos', permite('eventos', 'ver_inscritos'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const evento = await pool.query('SELECT id FROM eventos WHERE id = $1', [id]);
    if (evento.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const result = await pool.query(SELECT_INSCRITOS, [id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// La imagen va en su propia ruta y no dentro del PUT: si llegara en el JSON
// pasaria por el limite de 1mb de express.json y ademas obligaria a reenviar
// todos los campos en cada cambio de foto.
router.post('/:id/imagen', permite('eventos', 'editar'), upload.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'imagen_thumb', maxCount: 1 },
]), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const archivos = req.files || {};
    const original = archivos.imagen && archivos.imagen[0];
    if (!original) {
      return res.status(400).json({ message: 'No se envió ninguna imagen' });
    }

    if (!TIPOS_IMAGEN.includes(original.mimetype)) {
      return res.status(400).json({ message: 'Formato no válido. Solo se permiten JPG, PNG y WEBP' });
    }

    // El thumbnail tambien se valida, y con un techo mucho mas bajo. Es lo que
    // consume el listado, asi que un archivo sin castear aqui permitiria
    // reintroducir por la puerta de atras los 2.67MB por evento que provocan el
    // corte de respuesta, y meter bytes arbitrarios en una columna que se pinta
    // como <img src>.
    const thumb = archivos.imagen_thumb && archivos.imagen_thumb[0];
    let thumbDataUrl = null;
    if (thumb) {
      if (!TIPOS_IMAGEN.includes(thumb.mimetype)) {
        return res.status(400).json({ message: 'Formato no válido para la miniatura. Solo JPG, PNG y WEBP' });
      }
      if (thumb.size > THUMB_MAX_BYTES) {
        return res.status(400).json({ message: 'La miniatura generada es demasiado grande' });
      }
      thumbDataUrl = `data:${thumb.mimetype};base64,${thumb.buffer.toString('base64')}`;
    }

    const dataUrl = `data:${original.mimetype};base64,${original.buffer.toString('base64')}`;

    const result = await pool.query(
      'UPDATE eventos SET imagen = $1, imagen_thumb = $2, updated_at = NOW() WHERE id = $3 RETURNING id, imagen_thumb',
      [dataUrl, thumbDataUrl, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    res.json({ imagen: result.rows[0].imagen_thumb || dataUrl });
  } catch (error) {
    internalError(res, error);
  }
});

// Sin esto "Quitar" en el formulario solo limpiaba la vista previa y el cartel
// viejo seguia vivo para los alumnos.
router.delete('/:id/imagen', permite('eventos', 'editar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const result = await pool.query(
      'UPDATE eventos SET imagen = NULL, imagen_thumb = NULL, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    res.json({ message: 'Imagen eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', permite('eventos', 'crear'), async (req, res) => {
  try {
    const construido = construirEvento(req.body);
    if (construido.error) {
      return res.status(400).json({ message: construido.error });
    }
    const v = construido.values;

    const result = await pool.query(
      `INSERT INTO eventos (nombre, tipo, estado, fecha_inicio, sede, lugar, categorias,
                            descripcion, precio_inscripcion, cupo_maximo, link_registro, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [v.nombre, v.tipo, v.estado, v.fecha_inicio, v.sede, v.lugar, v.categorias,
       v.descripcion, v.precio_inscripcion, v.cupo_maximo, v.link_registro, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', permite('eventos', 'editar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const construido = construirEvento(req.body);
    if (construido.error) {
      return res.status(400).json({ message: construido.error });
    }
    const v = construido.values;

    // La imagen NO se toca aqui a proposito: va en su propia ruta, para que
    // guardar un cambio de texto no obliga a volver a subir 2MB.
    const result = await pool.query(
      `UPDATE eventos SET
         nombre = $1, tipo = $2, estado = $3, fecha_inicio = $4, sede = $5, lugar = $6,
         categorias = $7, descripcion = $8, precio_inscripcion = $9, cupo_maximo = $10,
         link_registro = $11, updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [v.nombre, v.tipo, v.estado, v.fecha_inicio, v.sede, v.lugar, v.categorias,
       v.descripcion, v.precio_inscripcion, v.cupo_maximo, v.link_registro, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/:id/inscribirse', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const alumnoId = await obtenerAlumno(req.user.id);
    if (alumnoId === null) {
      return res.status(404).json({ message: 'No se encontró tu registro de alumno' });
    }

    // Todo el alta ocurre en una transaccion con FOR UPDATE sobre la fila del
    // evento. Sin el bloqueo, dos alumnos que tocan "Inscribirme" a la vez
    // cuentan el mismo cupo y ambos insertan, y el ultimo lugar se vende dos
    // veces.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const evento = await client.query(
        'SELECT nombre, estado, cupo_maximo FROM eventos WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (evento.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Evento no encontrado' });
      }
      const ev = evento.rows[0];

      // El estado se valida aqui y no solo en la UI: un cliente que llame a la
      // API directo tiene que chocar con la misma regla.
      if (ev.estado === 'cancelado') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este evento fue cancelado' });
      }
      if (ev.estado === 'finalizado') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este evento ya se lleva a cabo' });
      }
      if (ev.fecha_inicio && new Date(ev.fecha_inicio).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este evento ya se llevó a cabo' });
      }

      const existente = await client.query(
        `SELECT id, estado FROM eventos_inscripciones
          WHERE evento_id = $1 AND alumno_id = $2 FOR UPDATE`,
        [id, alumnoId]
      );

      if (existente.rows.length > 0 && existente.rows[0].estado === 'inscrito') {
        // Ya tiene el lugar. 200 y no 400: el botón pudo llegar con un render
        // viejo y un doble clic lento, y no es un error del alumno.
        await client.query('COMMIT');
        return res.status(200).json(existente.rows[0]);
      }

      if (ev.cupo_maximo !== null && ev.cupo_maximo !== undefined) {
        const cuenta = await client.query(
          "SELECT COUNT(*) AS total FROM eventos_inscripciones WHERE evento_id = $1 AND estado = 'inscrito'",
          [id]
        );
        if (Number(cuenta.rows[0].total) >= Number(ev.cupo_maximo)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Ya no hay lugares disponibles para este evento' });
        }
      }

      let guardada;
      if (existente.rows.length > 0) {
        // Reinscribirse tras cancelar reactiva la fila. Un segundo INSERT
        // chocaria con el indice unico.
        const reactivada = await client.query(
          `UPDATE eventos_inscripciones SET estado = 'inscrito', created_at = NOW()
            WHERE id = $1 RETURNING *`,
          [existente.rows[0].id]
        );
        guardada = reactivada.rows[0];
      } else {
        const creada = await client.query(
          `INSERT INTO eventos_inscripciones (evento_id, alumno_id, usuario_id)
           VALUES ($1, $2, $3) RETURNING *`,
          [id, alumnoId, req.user.id]
        );
        guardada = creada.rows[0];
      }

      await client.query('COMMIT');
      return res.status(existente.rows.length > 0 ? 200 : 201).json(guardada);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    // El indice unico sigue siendo la garantia real si dos pestanas disparan
    // el clic a la vez desde sesiones distintas.
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Ya estás inscrito en este evento' });
    }
    internalError(res, error);
  }
});

router.delete('/:id/inscribirse', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const alumnoId = await obtenerAlumno(req.user.id);
    if (alumnoId === null) {
      return res.status(404).json({ message: 'No se encontró tu registro de alumno' });
    }

    const result = await pool.query(
      `UPDATE eventos_inscripciones SET estado = 'cancelada'
        WHERE evento_id = $1 AND alumno_id = $2 AND estado = 'inscrito'
        RETURNING id`,
      [id, alumnoId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No estás inscrito en este evento' });
    }

    res.json({ message: 'Inscripción cancelada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', permite('eventos', 'eliminar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const result = await pool.query('DELETE FROM eventos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    // Las inscripciones se van por ON DELETE CASCADE.
    res.json({ message: 'Evento eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
