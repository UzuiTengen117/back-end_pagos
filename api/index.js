const app = require('../src/index.js');

module.exports = function handler(req, res) {
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:3000,https://pagos-zeta.vercel.app,https://sistema-de-pagos-amtkd.vercel.app,https://back-end-pagos-smoky.vercel.app')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  return app(req, res);
};
