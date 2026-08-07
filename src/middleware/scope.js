function isEstudiante(req) {
  return Boolean(req.user && req.user.rol === 'estudiante');
}

// Filtro SQL para que un estudiante solo vea registros asociados a su usuario.
// El alias de la tabla `alumnos` en las consultas es `a`.
function alumnoScope(req) {
  if (!isEstudiante(req)) {
    return { clause: '', params: [] };
  }
  return { clause: 'a.usuario_id = $1', params: [req.user.id] };
}

module.exports = { isEstudiante, alumnoScope };
