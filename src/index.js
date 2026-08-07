const express = require('express');
const cors = require('cors');
require('dotenv').config();
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:3000,https://pagos-zeta.vercel.app,https://back-end-pagos-smoky.vercel.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      const error = new Error('Origen no permitido');
      error.status = 403;
      cb(error);
    },
  })
);

app.use(express.json({ limit: '1mb' }));

const testRoutes = require('./routes/test');
const pagosRoutes = require('./routes/pagos');
const usuariosRoutes = require('./routes/usuarios');
const alumnosRoutes = require('./routes/alumnos');
const comprobantesRoutes = require('./routes/comprobantes');
const tiposPagoRoutes = require('./routes/tiposPago');
const becasRoutes = require('./routes/becas');
const inscripcionesRoutes = require('./routes/inscripciones');

app.get('/', (req, res) => {
  res.json({ message: 'API de Pagos funcionando' });
});

app.use('/api/test', testRoutes);
app.use('/api/usuarios', usuariosRoutes);

app.use('/api/pagos', auth, pagosRoutes);
app.use('/api/alumnos', auth, alumnosRoutes);
app.use('/api/comprobantes', auth, comprobantesRoutes);
app.use('/api/tipos-pago', auth, tiposPagoRoutes);
app.use('/api/becas', auth, becasRoutes);
app.use('/api/inscripciones', auth, inscripcionesRoutes);

app.use(errorHandler);

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
  });
}

module.exports = app;
