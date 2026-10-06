const pool = require('../config/database');

// Las 9 categorías del sistema. Dentro de cada una están sus acciones.
// El módulo `usuarios` usa subcategorías (estudiantes/profesores/administradores).
// Las acciones con sufijo quedan codificadas en `accion` como `crear:estudiantes`.
const MODULOS_ACCIONES = {
  pagos: {
    label: 'Pagos',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  inscripciones: {
    label: 'Inscripciones',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  comprobantes: {
    label: 'Comprobantes',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  alumnos: {
    label: 'Registro de Alumnos',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  usuarios: {
    label: 'Registro de Usuarios',
    subcategorias: {
      estudiantes: {
        label: 'Estudiantes',
        acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
      },
      profesores: {
        label: 'Profesores',
        acciones: { ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar', ver_lista: 'Ver Lista' },
      },
      administradores: {
        label: 'Administradores',
        acciones: { ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
      },
    },
    // Acciones que un usuario que no es administrador nunca puede tener.
    // Crear, editar y eliminar administradores es exclusivo de admins.
    // Ver administradores sí puede asignarse (el profesor ve a los admins).
    bloqueadas: [
      'crear:administradores',
      'editar:administradores',
      'eliminar:administradores',
    ],
  },
  solicitudes_reembolso: {
    label: 'Reembolsos',
    acciones: {
      ver: 'Ver',
      aprobar: 'Aprobar',
      rechazar: 'Rechazar',
      editar: 'Editar',
      eliminar: 'Eliminar',
    },
  },
  precios: {
    label: 'Precios',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  becas: {
    label: 'Becas',
    acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  eventos: {
    label: 'Eventos',
    // El listado y la inscripcion no se giran: son publicos para cualquier
    // sesion iniciada, igual que becas o precios. Lo que se restringe es la
    // gestion del evento y la lectura de la lista de inscritos.
    //
    // Va con subcategorias por la misma razon que asistencias: organizar un
    // torneo y consultar la lista de confirmados son decisiones distintas y las
    // toma gente distinta. Un entrenador que solo lleva el control de quien se
    // inscribio no necesita poder crear ni borrar eventos, y antes no habia
    // forma de concederle lo uno sin lo otro.
    subcategorias: {
      eventos: {
        label: 'Eventos',
        acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
      },
      reporte_eventos: {
        label: 'Reporte de Eventos',
        acciones: { ver: 'Ver' },
      },
    },
  },
  examenes: {
    label: 'Examenes',
    // Misma division que eventos: gestionar la convocatoria y consultar la hoja
    // de resultados son decisiones distintas. Se separan para que un profesor
    // que solo pasa lista en los exams no reciba el poder de borrarlos.
    subcategorias: {
      examenes: {
        label: 'Examenes',
        acciones: { crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
      },
      reporte_examenes: {
        label: 'Reporte de Examenes',
        acciones: { ver: 'Ver' },
      },
    },
  },
  tienda: {
    label: 'Tienda',
    // El listado de productos activos y la creacion de pedidos son publicos
    // para cualquier sesion iniciada (igual que becas o precios). Lo que se
    // restringe es la gestion del catalogo y de los pedidos, que son decisiones
    // solo del administrador.
    acciones: { ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar' },
  },
  asistencias: {
    label: 'Asistencias',
    subcategorias: {
      tomar_asistencia: {
        label: 'Tomar Asistencia',
        acciones: { registrar: 'Registrar', ver: 'Ver' },
      },
      reporte_asistencias: {
        label: 'Reporte de Asistencias',
        acciones: { reportar: 'Reportar', ver: 'Ver', eliminar: 'Eliminar' },
      },
    },
  },
};

// Permisos por defecto según el rol. Se usan mientras el usuario no tenga
// una configuración explícita en permisos_usuario.
const DEFAULTS = {
  profesor: [
    'pagos:crear', 'pagos:editar', 'pagos:eliminar',
    'inscripciones:crear', 'inscripciones:editar', 'inscripciones:eliminar',
    'comprobantes:crear', 'comprobantes:editar', 'comprobantes:eliminar',
    'alumnos:crear', 'alumnos:editar', 'alumnos:eliminar',
    'usuarios:crear:estudiantes', 'usuarios:editar:estudiantes', 'usuarios:eliminar:estudiantes',
    'usuarios:ver:profesores', 'usuarios:ver_lista:profesores', 'usuarios:eliminar:profesores',
    'usuarios:ver:administradores',
    'solicitudes_reembolso:ver', 'solicitudes_reembolso:aprobar', 'solicitudes_reembolso:rechazar',
    'precios:crear', 'precios:editar', 'precios:eliminar',
    'becas:crear', 'becas:editar', 'becas:eliminar',
    'asistencias:registrar:tomar_asistencia', 'asistencias:ver:tomar_asistencia', 'asistencias:reportar:reporte_asistencias', 'asistencias:ver:reporte_asistencias', 'asistencias:eliminar:reporte_asistencias',
    'eventos:crear:eventos', 'eventos:editar:eventos', 'eventos:eliminar:eventos', 'eventos:ver:reporte_eventos',
    'examenes:crear:examenes', 'examenes:editar:examenes', 'examenes:eliminar:examenes', 'examenes:ver:reporte_examenes',
  ],
  estudiante: ['solicitudes_reembolso:ver'],
  admin: null,
};

// Mapas rol <-> tipo de subcategoría del módulo usuarios.
function tipoDeRol(rol) {
  const map = { estudiante: 'estudiantes', profesor: 'profesores', admin: 'administradores' };
  return map[rol] || null;
}

function todasLasAcciones() {
  const out = [];
  for (const [modulo, cfg] of Object.entries(MODULOS_ACCIONES)) {
    if (cfg.subcategorias) {
      for (const [sub, subCfg] of Object.entries(cfg.subcategorias)) {
        for (const accion of Object.keys(subCfg.acciones)) {
          out.push(`${modulo}:${accion}:${sub}`);
        }
      }
    } else {
      for (const accion of Object.keys(cfg.acciones)) {
        out.push(`${modulo}:${accion}`);
      }
    }
  }
  return out;
}

function esValido(modulo, accion) {
  const cfg = MODULOS_ACCIONES[modulo];
  if (!cfg) return false;
  if (cfg.subcategorias) {
    const [accionBase, sub] = String(accion).split(':');
    const subCfg = cfg.subcategorias[sub];
    return Boolean(subCfg && subCfg.acciones[accionBase]);
  }
  return Boolean(cfg.acciones && cfg.acciones[accion]);
}

// Acciones de administración de administradores: nunca asignables a no-admin.
function esBloqueada(modulo, accion) {
  if (modulo !== 'usuarios') return false;
  const [accionBase, sub] = String(accion).split(':');
  return sub === 'administradores' && ['crear', 'editar', 'eliminar'].includes(accionBase);
}

// Devuelve los permisos efectivos del usuario: si tiene filas explícitas
// se usan esas; si no, los por defecto de su rol (admin → todos).
async function obtenerPermisosUsuario(usuarioId, rol) {
  const result = await pool.query(
    'SELECT modulo, accion FROM permisos_usuario WHERE usuario_id = $1',
    [usuarioId]
  );
  const explicitos = result.rows.map((r) => `${r.modulo}:${r.accion}`);
  if (explicitos.length > 0) {
    return explicitos;
  }
  if (rol === 'admin') {
    return todasLasAcciones();
  }
  return [...(DEFAULTS[rol] || [])];
}

async function tienePermiso(usuarioId, rol, modulo, accion) {
  const permisos = await obtenerPermisosUsuario(usuarioId, rol);
  return permisos.includes(`${modulo}:${accion}`);
}

// ¿Puede el actor gestionar usuarios de cierto tipo? Los tipos de administrador
// solo los gestiona un administrador.
async function puedeGestionarTipo(usuarioId, rolActor, accion, tipo) {
  if (tipo === 'administradores') {
    return rolActor === 'admin';
  }
  return tienePermiso(usuarioId, rolActor, 'usuarios', `${accion}:${tipo}`);
}

// Middleware de autorización basado en permisos por módulo/acción.
const permite = (modulo, accion) => {
  return async (req, res, next) => {
    try {
      const ok = await tienePermiso(req.user.id, req.user.rol, modulo, accion);
      if (!ok) {
        return res.status(403).json({ message: 'No tienes permiso para esta acción' });
      }
      next();
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  };
};

// Reemplaza el conjunto de permisos explícitos de un usuario. Si el destino
// no es administrador, se descartan las acciones bloqueadas. Los estudiantes
// nunca reciben permisos asignados: se dejan siempre con los por defecto.
async function reemplazarPermisos(usuarioId, permisos, rolDestino) {
  // Todo el reemplazo va en una transacción: sin ella, un fallo a mitad del
  // bucle de inserciones deja al usuario con la mitad de sus permisos.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM permisos_usuario WHERE usuario_id = $1', [usuarioId]);
    if (rolDestino !== 'estudiante') {
      const lista = Array.isArray(permisos) ? permisos : [];
      const esAdminDestino = rolDestino === 'admin';
      for (const p of lista) {
        if (!p || !esValido(p.modulo, p.accion)) continue;
        if (!esAdminDestino && esBloqueada(p.modulo, p.accion)) continue;
        await client.query(
          'INSERT INTO permisos_usuario (usuario_id, modulo, accion) VALUES ($1, $2, $3)',
          [usuarioId, p.modulo, p.accion]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MODULOS_ACCIONES,
  DEFAULTS,
  tipoDeRol,
  esValido,
  esBloqueada,
  todasLasAcciones,
  obtenerPermisosUsuario,
  tienePermiso,
  puedeGestionarTipo,
  permite,
  reemplazarPermisos,
};
