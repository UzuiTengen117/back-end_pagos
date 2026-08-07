const internalError = (res, error) => {
  console.error(error);
  res.status(500).json({ error: 'Error interno del servidor' });
};

module.exports = { internalError };
