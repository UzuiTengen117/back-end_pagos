const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/database');
const { permite } = require('../middleware/permisos');
const { internalError } = require('../utils/httpError');

const ESTADOS = ['programado', 'en_curso', 'finalizado', 'cancelado'];
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

// Un thumbnail de 480px a calidad 0.72 pesa ~40KB. 200KB es un techo holgado
// para casos raros y sigue siendo diminuto frente a los 2MB de la original.
const THUMB_MAX_BYTES = 200 * 1024;

// Limites espejo de las columnas en database.sql. Sin esto un nombre largo
// rebota como 22001 y el usuario ve un 500 en vez de un mensaje de campo.
// Los exámenes se aplican en las sedes de la academia. Lista cerrada en el
// backend, no solo en el <select> del formulario: un POST con "Gimnasio de
// Cholula" debe rebotar con un 400 explicito y no con un 23514 de CHECK.
const { SEDES } = require('../config/sedes');
const { NOMBRE_ESCUELA } = require('../config/escuela');

const MAX_NOMBRE = 255;
const MAX_LUGAR = 255;
const MAX_ESCUELA = 150;
const MAX_GRADO = 50;
// NUMERIC(10,2) admite 8 digitos enteros. Pasarse es 22003, tambien un 500.
const MAX_PRECIO = 99999999.99;
// Un alumno de taekwondo de elite ronda los 12-18. El rango es ancho a
// proposito (un examen abierto admite master) pero corta los 999 de un dedo
// mal puesto o un payload automatizado.
const EDAD_MIN = 4;
const EDAD_MAX = 99;

// Mismo limite que la foto de perfil. El despliegue es serverless y no hay
// disco: la imagen viaja como data URL dentro de la fila.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// La hoja de inscripcion es el PDF que sube el admin y baja el alumno. Techo
// aparte del de la imagen: un PDF escaneado pesa mas que una foto. 5MB en
// base64 son 6.7MB, pero solo viajan en la descarga, nunca en el listado.
const HOJA_MAX_BYTES = 5 * 1024 * 1024;
const uploadHoja = multer({ storage: multer.memoryStorage(), limits: { fileSize: HOJA_MAX_BYTES } });

// multer aborta la subida EN EL MIDDLEWARE, antes de entrar al handler, y lanza
// un MulterError. Sin este envoltorio un PDF de 6MB sale como 500 en vez de un
// 400, y un 500 no le dice a nadie nada: el techo es justo lo que la persona
// que lo esta subiendo necesita leer para saber que hacer.
const soloHoja = (req, res, next) =>
  uploadHoja.single('hoja')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: `El PDF supera el límite de ${HOJA_MAX_BYTES / (1024 * 1024)}MB`,
      });
    }
    return next(err);
  });

// El listado NUNCA pide la imagen completa. A 2MB el base64 ocupa 2.67MB por
// examen y Vercel corta la respuesta a 4.5MB: con dos banners la lista deja de
// llegar y se rompe la pagina entera, no solo la foto. Se manda el thumbnail
// bajo el alias `imagen` para que el frontend muestre lo mismo en las tarjetas
// y solo pida la original al abrir un examen.
//
// Sin COALESCE a la original a proposito: una fila vieja sin thumbnail se
// veria sin cartel, pero re-subirlo lo arregla. El fallback devolveria el
// problema de tamano justo en las filas que no se han vuelto a subir.
const SELECT_EXAMENES = `
  SELECT e.id, e.nombre, e.fecha_examen, e.sede, e.lugar, e.niveles,
         e.descripcion, e.precio_inscripcion, e.cupo_maximo,
         e.imagen_thumb AS imagen,
         e.estado, e.created_at, e.updated_at,
         e.hoja_inscripcion IS NOT NULL AS tiene_hoja,
         (SELECT COUNT(*) FROM examenes_inscripciones ei
           WHERE ei.examen_id = e.id AND ei.estado = 'inscrito') AS inscritos,
         (SELECT ei.id FROM examenes_inscripciones ei
           WHERE ei.examen_id = e.id AND ei.usuario_id = $1 AND ei.estado = 'inscrito'
           LIMIT 1) AS mi_inscripcion
    FROM examenes e
`;

// Solo el detalle trae la original: una fila unica queda holgadamente bajo el
// limite de 4.5MB, y es la unica vista que necesita la imagen completa. Mantiene
// los mismos conteos que el listado para que la respuesta sea intercambiable.
//
// La columna va enumerada A PROPOSITO y no con `e.*`. Con el asterisco,
// agregar la columna hoja_inscripcion —que es el PDF completo en base64— hacia
// que el detalle mandara hasta 6.7MB y rompiera la misma respuesta que aqui se
// esta protegiendo. Cada columna que se agregue a la tabla hay que decidir si
// entra por nombre o se queda afuera; no hay default seguro.
const SELECT_EXAMEN = `
  SELECT e.id, e.nombre, e.fecha_examen, e.sede, e.lugar, e.niveles,
         e.descripcion, e.precio_inscripcion, e.cupo_maximo,
         e.imagen, e.imagen_thumb,
         e.estado, e.created_at, e.updated_at, e.creado_por,
         e.hoja_inscripcion IS NOT NULL AS tiene_hoja,
         (SELECT COUNT(*) FROM examenes_inscripciones ei
           WHERE ei.examen_id = e.id AND ei.estado = 'inscrito') AS inscritos,
         (SELECT ei.id FROM examenes_inscripciones ei
           WHERE ei.examen_id = e.id AND ei.usuario_id = $1 AND ei.estado = 'inscrito'
           LIMIT 1) AS mi_inscripcion
    FROM examenes e
`;

// La lista de inscritos se arma desde el SNAPSHOT de la inscripcion, no desde
// `alumnos`. Es lo que garantiza: si el alumno actualiza su escuela en su
// perfil despues de haberse inscrito, la lista del examen sigue diciendo lo que
// mando al inscribirse. Un JOIN a alumnos daria el dato actual, que no es el que
// se imprimio en la mesa de inscripcion.
const SELECT_INSCRITOS_EXAMEN = `
  SELECT ei.id, ei.alumno_id, ei.estado, ei.created_at,
         ei.nombre, ei.primer_apellido, ei.segundo_apellido,
         ei.edad, ei.grado, ei.escuela
    FROM examenes_inscripciones ei
   WHERE ei.examen_id = $1 AND ei.estado = 'inscrito'
   ORDER BY ei.primer_apellido ASC, ei.nombre ASC
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
function construirExamen(body) {
  const nombre = (body.nombre || '').trim();
  if (!nombre) {
    return { error: 'El nombre del examen es requerido' };
  }
  if (nombre.length > MAX_NOMBRE) {
    return { error: `El nombre no puede superar ${MAX_NOMBRE} caracteres` };
  }

  // Un examen NO lleva `tipo` (que en eventos distingue torneo / dual meet /
// open): eso clasifica COMO se juega un evento, y un examen no se juega. Lo que
  // juega un evento, y un examen no se juega. Lo que lo identifica es `niveles`,
  // la lista de cintas que se presentan.
  const estado = body.estado || 'programado';
  if (!ESTADOS.includes(estado)) {
    return { error: 'Estado no válido. Permitidos: programado, en curso, finalizado, cancelado' };
  }

  if (!body.fecha_examen) {
    return { error: 'La fecha y hora de inicio son requeridas' };
  }

  // Sin exigir zona horaria, "2026-10-15T18:00" se resuelve con la del SERVIDOR:
  // el mismo body se guardaria a horas distintas en local y en Vercel (UTC). Se
  // rechaza en vez de adivinar, porque un examen se corre en una hora concreta.
  if (typeof body.fecha_examen !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(body.fecha_examen)) {
    return { error: 'La fecha de inicio debe incluir zona horaria (ISO 8601)' };
  }

  const inicio = new Date(body.fecha_examen);
  if (Number.isNaN(inicio.getTime())) {
    return { error: 'La fecha y hora de inicio no son válidas' };
  }

  // El techo es suficiente para un examen de dos años y evita que el reloj del
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

  // Sede opcional: hay examenes de alcance general que no se fijan a una sede
  // concreta. Si viene, es una lista separada por comas, porque puede
  // celebrarse en Progreso y Morelos el mismo dia. Cada parte se valida por
  // separado contra SEDES: validar la cadena entera solo comprobaria que
  // "Progreso, Cholula" fuera distinta de "Progreso", asi que pasaria.
  //
  // Se deduplica y se une en el orden de SEDES, no en el que llegó el cliente,
  // para que "Morelos, Progreso" y "Progreso, Morelos" guarden lo mismo y la
  // comparacion en el buscador y en el filtro no los trate como examenes
  // distintos.
  const sede = construirSedes(body.sede);
  if (sede.error) return { error: sede.error };

  const lugar = texto(body.lugar, MAX_LUGAR, 'El lugar');
  if (lugar.error) return { error: lugar.error };
  const niveles = construirNiveles(body.niveles);
  if (niveles.error) return { error: niveles.error };

  return {
    values: {
      nombre,
      estado,
      fecha_examen: inicio.toISOString(),
      sede: sede.valor,
      lugar: lugar.valor,
      niveles: niveles.valor,
      descripcion: (body.descripcion || '').trim() || null,
      precio_inscripcion: precio,
      cupo_maximo: cupo,
    },
  };
}

// Convierte la lista de sedes del cuerpo en el texto que se guarda, o devuelve
// un error. Devuelve `null` cuando no se eligio ninguna: vacio es valido.
function construirSedes(entrada) {
  if (entrada === null || entrada === undefined || String(entrada).trim() === '') {
    return { valor: null };
  }

  const pedidas = String(entrada)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (pedidas.length === 0) {
    return { valor: null };
  }
  if (pedidas.length > SEDES.length) {
    return { error: `Solo puedes marcar hasta ${SEDES.length} sedes` };
  }

  const invalidas = pedidas.filter((s) => !SEDES.includes(s));
  if (invalidas.length > 0) {
    return { error: `Sede no válida: ${invalidas.join(', ')}. Permitidas: ${SEDES.join(', ')}` };
  }

  // Orden canonico segun SEDES, no segun el orden de llegada.
  return { valor: SEDES.filter((s) => pedidas.includes(s)).join(', ') };
}

// Las cintas (niveles) NO son lista cerrada: el examen puede incluir una
// categoria que la academia aun no teaches, y bloquearla dejaria al entrenador
// sin poder registrar el examen. Solo se normaliza el texto y se recorta el
// largo. El placeholder de la columna obliga a 255, pero se acota aqui para que
// "Blanca, Amarilla, ..." no crezca sin limite.
const MAX_NIVELES = 200;

function construirNiveles(entrada) {
  if (entrada === null || entrada === undefined) {
    return { valor: null };
  }

  const partes = String(entrada)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (partes.length === 0) {
    return { valor: null };
  }

  // Se unifica por minusculas para no dejar "Blanca, blanca" como dos niveles.
  const vistas = new Set();
  const unicas = partes.filter((c) => {
    const clave = c.toLowerCase();
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });

  const unido = unicas.join(', ');
  if (unido.length > MAX_NIVELES) {
    return { error: `La lista de categorías es demasiado larga (máximo ${MAX_NIVELES} caracteres)` };
  }
  return { valor: unido };
}

// Datos que el alumno captura al inscribirse. Validar aqui y no solo en el
// formulario: el endpoint es publico para cualquier sesion de estudiante, y un
// cuerpo vacio colaria una fila en blanco que despues sale impresa en la lista
// de asistencia del examen.
//
// `opciones.escuela` sobrescribe el valor del cuerpo. El alta del alumno la pasa
// con NOMBRE_ESCUELA porque todos los alumnos son de AMTKD y no tiene sentido que
// decidan eso; la correccion del entrenador NO la pasa, y ahi si importa lo que
// venga, porque se esta arreglando una inscripcion vieja con el nombre mal
// escrito.
function construirDatosInscripcion(body, opciones = {}) {
  const nombre = (body.nombre || '').trim();
  const primerApellido = (body.primer_apellido || '').trim();
  const grado = (body.grado || '').trim();
  const escuela = opciones.escuela !== undefined
    ? opciones.escuela
    : (body.escuela || '').trim();

  if (!nombre) return { error: 'Escribe tu nombre' };
  if (nombre.length > MAX_NOMBRE) return { error: 'El nombre es demasiado largo' };
  if (!primerApellido) return { error: 'Escribe tu apellido paterno' };
  if (primerApellido.length > MAX_NOMBRE) return { error: 'El apellido paterno es demasiado largo' };
  if (!grado) return { error: 'Escribe tu grado' };
  if (grado.length > MAX_GRADO) return { error: `El grado no puede superar ${MAX_GRADO} caracteres` };
  // Estos dos siguen importando en la correccion del entrenador. En el alta no
  // disparan nunca porque el valor viene forzado, y se dejan puestos para que
  // una constante vacia o enorme en config/escuela.js no se colara en la base.
  if (!escuela) return { error: 'Escribe el nombre de tu escuela' };
  if (escuela.length > MAX_ESCUELA) return { error: 'El nombre de la escuela es demasiado largo' };

  const segundoApellido = (body.segundo_apellido || '').trim();
  if (segundoApellido.length > MAX_NOMBRE) return { error: 'El apellido materno es demasiado largo' };

  // Edad es la unica opcional: no todos los grados la traen a mano, y es
  // preferible un hueco visible a inventar un numero que nadie verifico.
  let edad = null;
  const edadCruda = body.edad;
  if (edadCruda !== null && edadCruda !== undefined && edadCruda !== '') {
    edad = Number(edadCruda);
    if (!Number.isInteger(edad) || edad < EDAD_MIN || edad > EDAD_MAX) {
      return { error: `Ingresa una edad válida (entre ${EDAD_MIN} y ${EDAD_MAX})` };
    }
  }

  return {
    valores: {
      nombre,
      primer_apellido: primerApellido,
      segundo_apellido: segundoApellido || null,
      edad,
      grado,
      escuela,
    },
  };
}

// Ruta principal del listado. El alias /ver se mantiene solo en lectura, como
// en el resto del repo: duplicar un GET no abre superficie de permisos porque
// ninguno lleva `permite`.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(SELECT_EXAMENES + ' ORDER BY e.fecha_examen ASC', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver', async (req, res) => {
  try {
    const result = await pool.query(SELECT_EXAMENES + ' ORDER BY e.fecha_examen ASC', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/ver/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }
    const result = await pool.query(SELECT_EXAMEN + ' WHERE e.id = $2', [req.user.id, id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id/inscritos', permite('examenes', 'ver:reporte_examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const examen = await pool.query('SELECT id FROM examenes WHERE id = $1', [id]);
    if (examen.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const result = await pool.query(SELECT_INSCRITOS_EXAMEN, [id]);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

// Corregir los datos de una inscripcion.
//
// El snapshot es congelado a proposito: si el alumno actualiza su escuela DESPUES
// de inscribirse, la lista impresa de ESE examen debe seguir diciendo lo que
// mando. Pero eso deja un hueco real: una inscripcion creada antes de que
// existieran estos campos queda con edad y escuela en NULL, y el entrenador
// tiene una lista para imprimir con dos rayas y ninguna forma de llenarlas.
//
// Esta ruta es el remedio. Es de correccion, no de rediseño: escribe sobre el
// snapshot de ESA inscripcion y no toca el perfil del alumno.
//
// Se exige `editar` y no `ver_inscritos` porque es escritura. Ver la lista es
// consultar; rellenar un dato de un alumno es tocar su registro.
router.patch('/:id/inscritos/:inscripcionId', permite('examenes', 'editar:examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }
    const inscripcionId = parseId(req.params.inscripcionId);
    if (inscripcionId === null) {
      return res.status(400).json({ message: 'Inscripción inválida' });
    }

    // Misma validacion que al inscribirse, a proposito: si el formulario de
    // correccion aceptara algo que el de alta rechaza, se podrian meter datos
    // que el alta prohibe.
    const d = construirDatosInscripcion(req.body);
    if (d.error) {
      return res.status(400).json({ message: d.error });
    }

    // El `examen_id = $1` NO es redundante con el id de la ruta: sin el, un
    // profesor con `editar` podria pasar el id de una inscripcion de CUALQUIER
    // examen (o de otra academia si el id se adivina) y escribirle datos. El
    // filtro de pertenencia es lo que cierra eso.
    //
    // No se toca `created_at` a proposito: es la fecha en que se confirmo la
    // inscripcion y la lista impresa la usa. Y no se marca `updated_at` porque
    // esa columna no existe en la tabla y meterla obligaria a correr una
    // migracion para poder corregir un dato.
    const result = await pool.query(
      `UPDATE examenes_inscripciones
          SET nombre = $3, primer_apellido = $4, segundo_apellido = $5,
              edad = $6, grado = $7, escuela = $8
        WHERE id = $1 AND examen_id = $2
        RETURNING *`,
      [inscripcionId, id, d.valores.nombre, d.valores.primer_apellido,
       d.valores.segundo_apellido, d.valores.edad, d.valores.grado, d.valores.escuela]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'La inscripción no pertenece a este examen' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

// La imagen va en su propia ruta y no dentro del PUT: si llegara en el JSON
// pasaria por el limite de 1mb de express.json y ademas obligaria a reenviar
// todos los campos en cada cambio de foto.
router.post('/:id/imagen', permite('examenes', 'editar:examenes'), upload.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'imagen_thumb', maxCount: 1 },
]), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
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
    // reintroducir por la puerta de atras los 2.67MB por examen que provocan el
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
      'UPDATE examenes SET imagen = $1, imagen_thumb = $2, updated_at = NOW() WHERE id = $3 RETURNING id, imagen_thumb',
      [dataUrl, thumbDataUrl, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    res.json({ imagen: result.rows[0].imagen_thumb || dataUrl });
  } catch (error) {
    internalError(res, error);
  }
});

// Sin esto "Quitar" en el formulario solo limpiaba la vista previa y el cartel
// viejo seguia vivo para los alumnos.
router.delete('/:id/imagen', permite('examenes', 'editar:examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const result = await pool.query(
      'UPDATE examenes SET imagen = NULL, imagen_thumb = NULL, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    res.json({ message: 'Imagen eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// La hoja de inscripcion: un PDF que sube el admin y baja el alumno inscrito.
// Va aparte de la imagen por dos razones, no por capricho. Es otro tipo de dato
// (no se pinta en una tarjeta, se descarga), y pesa mas: por eso tiene su propio
// techo. Y NO viaja en el listado, ni en el detalle, ni en el alta: se pide
// solo con GET /:id/hoja. Meter el base64 en el listado reventaria el mismo
// limite de 4.5MB de Vercel que corta la respuesta cuando hay dos banners.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id/hoja', permite('examenes', 'editar:examenes'), soloHoja, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const archivo = req.file;
    if (!archivo) {
      return res.status(400).json({ message: 'No se envió ningún PDF' });
    }

    if (archivo.mimetype !== 'application/pdf') {
      return res.status(400).json({ message: 'Formato no válido. Solo se permiten archivos PDF' });
    }

    // El mimetype lo dice el navegador y se cambia en dos clics. Los primeros
    // bytes de un PDF real son siempre "%PDF-", y eso no lo inventa un archivo
    // renombrado. Sin esta comprobacion se podrian meter HTML o JS con
    // extension .pdf, que al abrirse en el navegador se ejecuta en el origen de
    // la academia.
    if (archivo.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ message: 'El archivo no es un PDF válido' });
    }

    // Se guarda el base64 pelado, sin el prefijo "data:...;base64," que usa la
    // imagen. A diferencia de la foto, este archivo nunca se pinta en un <img>
    // ni en un <embed>, solo se descarga, asi que el prefijo no aporta nada y
    // solo engorda la columna.
    const base64 = archivo.buffer.toString('base64');

    const result = await pool.query(
      'UPDATE examenes SET hoja_inscripcion = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [base64, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    res.json({ message: 'Hoja de inscripción subida', nombre: archivo.originalname });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/:id/hoja', permite('examenes', 'editar:examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const result = await pool.query(
      'UPDATE examenes SET hoja_inscripcion = NULL, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    res.json({ message: 'Hoja de inscripción eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id/hoja', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const result = await pool.query(
      'SELECT nombre, hoja_inscripcion FROM examenes WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const { nombre, hoja_inscripcion } = result.rows[0];
    if (!hoja_inscripcion) {
      return res.status(404).json({ message: 'Este examen no tiene hoja de inscripción' });
    }

    // El nombre del examen va dentro de Content-Disposition, que es una cabecera
    // y no un valor JSON: un nombre con comillas, salto de linea o acentos raro
    // rompe la cabecera y el navegador descarga un archivo sin nombre. Se
    // deja solo lo seguro y se ofrece en ASCII.
    const nombreArchivo = `hoja-inscripcion-${String(nombre)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'examen'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(hoja_inscripcion, 'base64'));
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', permite('examenes', 'crear:examenes'), async (req, res) => {
  try {
    const construido = construirExamen(req.body);
    if (construido.error) {
      return res.status(400).json({ message: construido.error });
    }
    const v = construido.values;

    const result = await pool.query(
      `INSERT INTO examenes (nombre, estado, fecha_examen, sede, lugar, niveles,
                            descripcion, precio_inscripcion, cupo_maximo, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [v.nombre, v.estado, v.fecha_examen, v.sede, v.lugar, v.niveles,
       v.descripcion, v.precio_inscripcion, v.cupo_maximo, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', permite('examenes', 'editar:examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const construido = construirExamen(req.body);
    if (construido.error) {
      return res.status(400).json({ message: construido.error });
    }
    const v = construido.values;

    // La imagen NO se toca aqui a proposito: va en su propia ruta, para que
    // guardar un cambio de texto no obliga a volver a subir 2MB.
    const result = await pool.query(
      `UPDATE examenes SET
         nombre = $1, estado = $2, fecha_examen = $3, sede = $4, lugar = $5,
         niveles = $6, descripcion = $7, precio_inscripcion = $8, cupo_maximo = $9,
         updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [v.nombre, v.estado, v.fecha_examen, v.sede, v.lugar, v.niveles,
       v.descripcion, v.precio_inscripcion, v.cupo_maximo, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
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
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const alumnoId = await obtenerAlumno(req.user.id);
    if (alumnoId === null) {
      return res.status(404).json({ message: 'No se encontró tu registro de alumno' });
    }

    // Se valida antes de abrir la transaccion: un formulario incompleto no
    // merece un BEGIN, y el mensaje de error llega sin round-trip a la base.
    //
    // La escuela se fuerza aqui y no se lee del cuerpo. Todos los alumnos son de
    // AMTKD, asi que el modal se la muestra precargada y bloqueada; ignorarla
    // aqui cierra el otro lado de la puerta, que es que alguien llame la API a
    // mano y guarde otra escuela.
    const datos = construirDatosInscripcion(req.body, { escuela: NOMBRE_ESCUELA });
    if (datos.error) {
      return res.status(400).json({ message: datos.error });
    }

    // Todo el alta ocurre en una transaccion con FOR UPDATE sobre la fila del
    // examen. Sin el bloqueo, dos alumnos que tocan "Inscribirme" a la vez
    // cuentan el mismo cupo y ambos insertan, y el ultimo lugar se vende dos
    // veces.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const examen = await client.query(
        'SELECT nombre, estado, cupo_maximo FROM examenes WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (examen.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'examen no encontrado' });
      }
      const ev = examen.rows[0];

      // El estado se valida aqui y no solo en la UI: un cliente que llame a la
      // API directo tiene que chocar con la misma regla.
      if (ev.estado === 'cancelado') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este examen fue cancelado' });
      }
      if (ev.estado === 'finalizado') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este examen ya se lleva a cabo' });
      }
      if (ev.fecha_examen && new Date(ev.fecha_examen).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Este examen ya se llevó a cabo' });
      }

      const existente = await client.query(
        `SELECT id, estado FROM examenes_inscripciones
          WHERE examen_id = $1 AND alumno_id = $2 FOR UPDATE`,
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
          "SELECT COUNT(*) AS total FROM examenes_inscripciones WHERE examen_id = $1 AND estado = 'inscrito'",
          [id]
        );
        if (Number(cuenta.rows[0].total) >= Number(ev.cupo_maximo)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Ya no hay lugares disponibles para este examen' });
        }
      }

      // Los datos se piden SIEMPRE, incluso si la fila ya existe: al
      // reactivarse una inscripcion cancelada, el alumno puede querer
      // corregir su escuela o su grado, y el snapshot debe reflejar lo que
      // mando en esta occasion.
      const d = datos.valores;

      let guardada;
      if (existente.rows.length > 0) {
        // Reinscribirse tras cancelar reactiva la fila. Un segundo INSERT
        // chocaria con el indice unico.
        const reactivada = await client.query(
          `UPDATE examenes_inscripciones SET
             estado = 'inscrito', created_at = NOW(),
             nombre = $2, primer_apellido = $3, segundo_apellido = $4,
             edad = $5, grado = $6, escuela = $7
           WHERE id = $1 RETURNING *`,
          [existente.rows[0].id, d.nombre, d.primer_apellido, d.segundo_apellido,
           d.edad, d.grado, d.escuela]
        );
        guardada = reactivada.rows[0];
      } else {
        const creada = await client.query(
          `INSERT INTO examenes_inscripciones
             (examen_id, alumno_id, usuario_id,
              nombre, primer_apellido, segundo_apellido, edad, grado, escuela)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [id, alumnoId, req.user.id,
           d.nombre, d.primer_apellido, d.segundo_apellido, d.edad, d.grado, d.escuela]
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
      return res.status(400).json({ message: 'Ya estás inscrito en este examen' });
    }
    internalError(res, error);
  }
});

router.delete('/:id/inscribirse', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const alumnoId = await obtenerAlumno(req.user.id);
    if (alumnoId === null) {
      return res.status(404).json({ message: 'No se encontró tu registro de alumno' });
    }

    const result = await pool.query(
      `UPDATE examenes_inscripciones SET estado = 'cancelada'
        WHERE examen_id = $1 AND alumno_id = $2 AND estado = 'inscrito'
        RETURNING id`,
      [id, alumnoId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No estás inscrito en este examen' });
    }

    res.json({ message: 'Inscripción cancelada' });
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', permite('examenes', 'eliminar:examenes'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }

    const result = await pool.query('DELETE FROM examenes WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'examen no encontrado' });
    }
    // Las inscripciones se van por ON DELETE CASCADE.
    res.json({ message: 'examen eliminado' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
