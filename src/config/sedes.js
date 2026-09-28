// Las dos sedes de la academia. Es la unica fuente de verdad: la usan el alta y
// edicion de alumnos, la de eventos y la validacion del frontend.
//
// Antes cada copia vivia hardcodeada en su archivo (`['Progreso', 'Morelos']`
// repetido cuatro veces en alumnos.js y otra en eventos.js). Agregar una tercera
// sede obligaba a cazarlas todas, y es exactamente el tipo de lista que se
// desincroniza en silencio: el alumno se registraba en la nueva y el torneo
// rechazaba esa sede.
const SEDES = ['Progreso', 'Morelos'];

module.exports = { SEDES };
