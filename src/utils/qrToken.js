const crypto = require('crypto');
const { JWT_SECRET } = require('../config/security');

// El QR que muestra el alumno NO contiene datos crudos: contiene un token
// firmado por el servidor con expiracion corta. Asi el alumno no puede
// editarlo para suplantar a otro ni reutilizarlo fuera de la ventana de clase.
//
// Formato del payload: <alumnoId>.<expiraEnMilisegundos>
// Formato del token:   AMTKD1.<payloadBase64url>.<firmaBase64url>

const PREFIJO = 'AMTKD1';
const VIGENCIA_MS = 60 * 1000;

function firmar(payload) {
  return crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
}

// Emite un token para el alumno. `ahora` es inyectable para poder testear
// el vencimiento sin esperar un minuto real.
function emitirTokenQr(alumnoId, ahora = Date.now()) {
  const expira = ahora + VIGENCIA_MS;
  const payload = `${alumnoId}.${expira}`;
  return `${PREFIJO}.${Buffer.from(payload).toString('base64url')}.${firmar(payload)}`;
}

// Verifica el token y devuelve { alumnoId, expira } o lanza un error con el
// motivo, para que la ruta pueda responder con un mensaje util.
function verificarTokenQr(token, ahora = Date.now()) {
  if (typeof token !== 'string' || !token) {
    throw new Error('Qr invalido');
  }

  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO) {
    throw new Error('Qr invalido');
  }

  let payload;
  try {
    payload = Buffer.from(partes[1], 'base64url').toString('utf8');
  } catch {
    throw new Error('Qr invalido');
  }

  const esperada = firmar(payload);
  const recibida = partes[2];
  const bufferEsperado = Buffer.from(esperada);
  const bufferRecibido = Buffer.from(recibida);
  if (
    bufferEsperado.length !== bufferRecibido.length ||
    !crypto.timingSafeEqual(bufferEsperado, bufferRecibido)
  ) {
    throw new Error('Qr invalido');
  }

  const [alumnoId, expira] = payload.split('.');
  if (!alumnoId || !expira) {
    throw new Error('Qr invalido');
  }

  if (ahora > Number(expira)) {
    throw new Error('Qr expirado');
  }

  return { alumnoId: Number(alumnoId), expira: Number(expira) };
}

module.exports = { emitirTokenQr, verificarTokenQr, VIGENCIA_MS };
