// El nombre de la academia. Es la unica fuente de verdad: la usan el alta de
// inscripcion de eventos y de examenes, y es la que el modal del alumno muestra
// precargada y bloqueada.
//
// Antes el alumno la escribia a mano en cada inscripcion. Como todos los
// alumnos son de AMTKD, eso no era libertad sino ruido: una lista de eventos
// convino con la mitad escribiendo "AMTKD", otra mitad "AMTKD ", otra "amtkd", y
// la columna escuela servia para agrupar errores de tecleo.
//
// NO se corrige desde el panel del entrenador. Ese camino sigue abierto a
// proposito: hay inscripciones anteriores con el nombre mal escrito y sin el no
// habria forma de arreglar el expediente. Ver `validarInscripcion` en
// routes/eventos.js y routes/examenes.js, que separa las dos cosas.
const NOMBRE_ESCUELA = 'AMTKD';

module.exports = { NOMBRE_ESCUELA };
