const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err.stack);
    return res.status(status).json({ error: 'Error interno del servidor' });
  }
  res.status(status).json({ error: err.message || 'Solicitud inválida' });
};

module.exports = errorHandler;
