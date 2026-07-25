const express = require('express');
const cors = require('cors');
require('dotenv').config();
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const testRoutes = require('./routes/test');
const pagosRoutes = require('./routes/pagos');
const usuariosRoutes = require('./routes/usuarios');
const alumnosRoutes = require('./routes/alumnos');
const comprobantesRoutes = require('./routes/comprobantes');
const tiposPagoRoutes = require('./routes/tiposPago');
const becasRoutes = require('./routes/becas');

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

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
