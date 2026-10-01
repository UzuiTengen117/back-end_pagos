'use strict';

// Regenera src/config/hojaPorDefecto.js a partir del PDF de la institucion.
//
// El PDF va EMBEBIDO en base64 y no como archivo suelto porque el despliegue es
// serverless: ahi no hay disco. Un fs.readFileSync de un archivo que el bundler
// de Vercel no incluyo funciona en local y revienta en produccion, y ese fallo
// aparece a mitad de un examen.
//
// Uso:
//   node tools/generar-hoja-por-defecto.js <ruta/al/hoja.pdf>
//
// El archivo debe ser el PDF CON los campos de formulario ya nombrados
// ("NOMBRE", "EDAD", "DIRECCIÓN"...). Renombrarlos a mano no funciona: la hoja se
// rellena por el nombre del campo, no por su posicion en la pagina.

const fs = require('fs');
const path = require('path');

const ORIGEN = process.argv[2];
const DESTINO = path.join(__dirname, '..', 'src', 'config', 'hojaPorDefecto.js');

if (!ORIGEN) {
  console.error('Uso: node tools/generar-hoja-por-defecto.js <ruta/al/hoja.pdf>');
  process.exit(1);
}

if (!fs.existsSync(ORIGEN)) {
  console.error('No existe el archivo:', ORIGEN);
  process.exit(1);
}

const bytes = fs.readFileSync(ORIGEN);
if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
  console.error('El archivo no empieza con %PDF-, no es un PDF.');
  process.exit(1);
}

const base64 = bytes.toString('base64');
// Lineas de 100 chars: el archivo queda legible y un diff no lo convierte en una
// sola linea de 331k que ninguna revision puede leer.
const lineas = base64.match(/.{1,100}/g) || [];

const contenido = `'use strict';

// La hoja de inscripcion por defecto de los examenes: el formulario en PDF de la
// institucion, con sus campos ya nombrados.
//
// Va EMBEBIDO en base64 y no como archivo suelto al lado porque el despliegue es
// serverless: ahi no hay disco, y una lectura con fs.readFileSync de un archivo
// que Vercel no metio al bundle falla en produccion y no en local. Base64 es un
// string en el modulo y existe siempre.
//
// Se genera con: node tools/generar-hoja-por-defecto.js <ruta/al/hoja.pdf>
const HOJA_POR_DEFECTO_BASE64 = [
${lineas.map((l) => "  '" + l + "'").join(',\n')},
].join('');

const HOJA_POR_DEFECTO = Buffer.from(HOJA_POR_DEFECTO_BASE64, 'base64');

module.exports = { HOJA_POR_DEFECTO, HOJA_POR_DEFECTO_BASE64 };
`;

fs.writeFileSync(DESTINO, contenido, 'utf8');

console.log('Escrito:', DESTINO);
console.log('PDF:', bytes.length, 'bytes ->', base64.length, 'chars de base64,', lineas.length, 'lineas');
