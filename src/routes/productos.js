const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../config/database');
const { permite, tienePermiso } = require('../middleware/permisos');
const { internalError } = require('../utils/httpError');

const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];
// El frontend reescala la foto a <=1600px antes de mandarla, así el payload viaja
// pequeño; este limite alto solo protege de archivos realmente gigantes y del
// corte de respuesta de Vercel.
const MAX_IMAGEN = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGEN } });

// Limites espejo de las columnas en MIGRACION_TIENDA.sql: sin esto un nombre
// largo rebota como 22001 y el usuario ve un 500 en vez de un mensaje de campo.
const MAX_NOMBRE = 255;
const MAX_DESCRIPCION = 2000;
const MAX_PRECIO = 99999999.99;
const MAX_STOCK = 1000000;

function parseId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// El listado NUNCA devuelve la imagen completa al admin en masa: el base64
// ocupa ~1.33x el tamaño original y Vercel corta la respuesta a 4.5MB. Se sirve el
// thumbnail bajo el alias `imagen` (con fallback a la original por si una fila
// vieja solo tiene la foto grande) y el detalle trae la imagen completa.
const SELECT_PRODUCTOS = `
  SELECT id, nombre, descripcion, precio, stock,
         COALESCE(imagen_thumb, imagen) AS imagen,
         activo, created_at, updated_at
    FROM productos
`;

const SELECT_PRODUCTO = `
  SELECT id, nombre, descripcion, precio, stock, imagen, activo, created_at, updated_at
    FROM productos
`;

// Valida y normaliza el cuerpo de alta/edicion. Devuelve null si todo bien o
// el mensaje de error para responder 400.
function construirProducto(body) {
  const { nombre, descripcion, precio, stock, activo } = body;

  if (nombre === undefined) return 'El nombre es requerido';
  const nombreLimpio = String(nombre).trim();
  if (!nombreLimpio) return 'El nombre es requerido';
  if (nombreLimpio.length > MAX_NOMBRE) return `El nombre no puede superar ${MAX_NOMBRE} caracteres`;

  if (descripcion !== undefined && descripcion !== null && String(descripcion).length > MAX_DESCRIPCION) {
    return `La descripción no puede superar ${MAX_DESCRIPCION} caracteres`;
  }

  const precioNum = Number(precio);
  if (!Number.isFinite(precioNum) || precioNum < 0 || precioNum > MAX_PRECIO) {
    return 'Precio no válido';
  }

  const stockNum = Number(stock);
  if (!Number.isInteger(stockNum) || stockNum < 0 || stockNum > MAX_STOCK) {
    return 'Stock no válido';
  }

  if (activo !== undefined && typeof activo !== 'boolean') {
    return 'Estado no válido';
  }

  return null;
}

// Cualquier sesion iniciada puede ver el catalogo: los alumnos solo los
// activos, quien tiene el permiso tienda:ver (el admin) los ve todos.
router.get('/', async (req, res) => {
  try {
    const puedeVerTodos = await tienePermiso(req.user.id, req.user.rol, 'tienda', 'ver');
    if (puedeVerTodos) {
      const result = await pool.query(`${SELECT_PRODUCTOS} ORDER BY id DESC`);
      return res.json(result.rows);
    }
    const result = await pool.query(`${SELECT_PRODUCTOS} WHERE activo = TRUE ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    internalError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    // Un alumno no debe poder ver un producto desactivado aunque adivine el id.
    const puedeVerTodos = await tienePermiso(req.user.id, req.user.rol, 'tienda', 'ver');
    let consulta = `${SELECT_PRODUCTO} WHERE id = $1`;
    if (!puedeVerTodos) {
      consulta += ' AND activo = TRUE';
    }
    const result = await pool.query(consulta, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.post('/agregar', permite('tienda', 'crear'), async (req, res) => {
  try {
    const error = construirProducto(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const { nombre, descripcion, precio, stock, activo } = req.body;

    const result = await pool.query(
      `INSERT INTO productos (nombre, descripcion, precio, stock, activo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [String(nombre).trim(), descripcion || null, Number(precio), Number(stock), activo !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.put('/editar/:id', permite('tienda', 'editar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const error = construirProducto(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }
    const { nombre, descripcion, precio, stock, activo } = req.body;

    const result = await pool.query(
      `UPDATE productos
          SET nombre = $1, descripcion = $2, precio = $3, stock = $4, activo = $5,
              updated_at = NOW()
        WHERE id = $6
       RETURNING *`,
      [String(nombre).trim(), descripcion || null, Number(precio), Number(stock), activo !== false, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    internalError(res, error);
  }
});

router.delete('/eliminar/:id', permite('tienda', 'eliminar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const result = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    // pedido_detalles referencia el producto con ON DELETE RESTRICT: un producto
    // ya pedido no se puede borrar sin romper el historial de pedidos.
    if (error && error.code === '23503') {
      return res.status(400).json({
        message: 'El producto tiene pedidos asociados. Desactívalo en su lugar para ocultarlo de la tienda.',
      });
    }
    internalError(res, error);
  }
});

// La imagen va en su propia ruta y no dentro del PUT: si llegara en el JSON
// pasaria por el limite de 1mb de express.json y ademas obligaria a reenviar
// todos los campos en cada cambio de foto. El thumbnail lo genera el frontend:
// es lo que consume el listado, y mandar la original tal cual rompe el
// corte de respuesta de Vercel.
router.post('/:id/imagen', permite('tienda', 'editar'), upload.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'imagen_thumb', maxCount: 1 },
]), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const archivos = req.files || {};
    const original = archivos.imagen && archivos.imagen[0];
    if (!original) {
      return res.status(400).json({ message: 'No se envió ninguna imagen' });
    }
    if (!TIPOS_IMAGEN.includes(original.mimetype)) {
      return res.status(400).json({ message: 'Formato no válido. Solo se permiten JPG, PNG y WEBP' });
    }

    const dataUrl = `data:${original.mimetype};base64,${original.buffer.toString('base64')}`;

    const thumb = archivos.imagen_thumb && archivos.imagen_thumb[0];
    let thumbDataUrl = null;
    if (thumb) {
      if (!TIPOS_IMAGEN.includes(thumb.mimetype)) {
        return res.status(400).json({ message: 'Formato no válido para la miniatura. Solo JPG, PNG y WEBP' });
      }
      if (thumb.size > 200 * 1024) {
        return res.status(400).json({ message: 'La miniatura generada es demasiado grande' });
      }
      thumbDataUrl = `data:${thumb.mimetype};base64,${thumb.buffer.toString('base64')}`;
    }

    const result = await pool.query(
      'UPDATE productos SET imagen = $1, imagen_thumb = $2, updated_at = NOW() WHERE id = $3 RETURNING id',
      [dataUrl, thumbDataUrl, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json({ imagen: thumbDataUrl || dataUrl });
  } catch (error) {
    if (error && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'La imagen no puede superar 10MB' });
    }
    internalError(res, error);
  }
});

router.delete('/:id/imagen', permite('tienda', 'editar'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    const result = await pool.query(
      'UPDATE productos SET imagen = NULL, imagen_thumb = NULL, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }
    res.json({ message: 'Imagen eliminada' });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;
