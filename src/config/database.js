const { Pool } = require('pg');
require('dotenv').config();

let pool;

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  // En lugar de tirar un Error que mata al proceso (y deja al frontend con
  // net::ERR_CONNECTION_REFUSED sin explicar por que), exponemos un pool que
  // nunca va a conectar y un flag para detectar el fallo al arrancar. Esto
  // mantiene el servidor vivo para servir un 503 claro en rutas que tocan DB,
  // o al menos evitar que nodemon se pase reiniciando mientras no llenes .env.
  // NOTA: Si una ruta llama a pool.query() antes de que leas esto, igual
  // fallara. Pero con este cambio el proceso NO crashea al requerirse el modulo.
  console.error('\n[CONFIG ERROR] DATABASE_URL vacia o ausente en back-end_pagos/.env\n' +
    '  Pegala sin comillas (URI, puerto 5432, NO pooler de transaccion).\n' +
    '  Supabase -> Project Settings -> Database -> Connection string -> modo URI\n' +
    '  Ejemplo: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres\n');
  pool = new Pool({ connectionString: 'postgresql://invalid:invalid@127.0.0.1:9999/invalid' });
  pool.__configError = true;
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 15000
  });

  pool.on('connect', () => {
    console.log('Conectado a PostgreSQL');
  });

  pool.on('error', (err) => {
    console.error('Error en la conexión:', err);
  });
}

module.exports = pool;
