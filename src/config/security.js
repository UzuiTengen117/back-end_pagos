const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (isProd) {
    throw new Error('Falta la variable de entorno JWT_SECRET. Definela antes de iniciar el servidor.');
  }
  const temp = crypto.randomBytes(32).toString('hex');
  console.warn('[security] JWT_SECRET no definido. Usando secreto temporal aleatorio para desarrollo.');
  return temp;
}

module.exports = {
  JWT_SECRET: resolveJwtSecret(),
};
