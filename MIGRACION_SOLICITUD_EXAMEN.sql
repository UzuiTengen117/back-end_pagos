-- ===========================================================================
-- SOLICITUD DE EXAMEN (hoja "INSTITUCION NACIONAL DE TAEKWONDO")
-- ===========================================================================
-- La hoja de inscripcion que se entrega en el examen tiene dos mitades bien
-- separadas y esta migracion las respeta:
--
--   1. Lo que captura el ALUMNO al inscribirse (columnas de este bloque).
--   2. "PARA USO EXCLUSIVO DE LA INSTITUCION": record, calificaciones por area,
--      comentarios y el veredicto. Eso lo llena la academia DESPUES del examen,
--      asi que sus columnas nacen en NULL y no las toca el endpoint de alta.
--
-- Por eso NO se meten todas en el mismo CREATE TABLE: separarlas deja claro que
-- un NULL en `aprobado` significa "el examen todavia no se calificio" y no
-- "quedo reprobado".
--
-- Idempotente: se puede correr el archivo las veces que haga falta.

-- ---------------------------------------------------------------------------
-- 1. Bloque del alumno
-- ---------------------------------------------------------------------------

-- La hoja pide "NO. DE EXAMEN" en la esquina. Es texto libre y no un contador de
-- la base: la institucion lo imprime a mano y a veces trae el numero del acta.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS numero_examen VARCHAR(50);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS direccion VARCHAR(255);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);

-- "GRADO ACTUAL" ya existe como `grado` y "ESCUELA A LA QUE PERTENECE" como
-- `escuela`. No se duplican: dos columnas para el mismo dato divergen en
-- pantalla y la impresa sale con una vacia.
--
-- `grado_a_pasar` si es nuevo: es el grado que se examenara, no el que tiene hoy.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS fecha_ingreso DATE;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS grado_a_pasar VARCHAR(50);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS fecha_examen_anterior DATE;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS fecha_ultimo_torneo DATE;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS fecha_solicitud DATE;

-- "PROFESOR QUE AUTORIZA - NOMBRE Y FIRMA". El nombre va aqui; la firma va en
-- la columna de abajo.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS profesor_autoriza VARCHAR(255);

-- Firmas: PNG en base64, SIN el prefijo "data:". Se guarda el payload pelado
-- porque el prefijo es constante y solo el agrega el frontend al pintar.
--
-- TEXT y no BYTEA porque lo que llega ya viene serializado en base64 y volver a
-- decodificar en cada lectura es trabajo sin gain: el servidor nunca dibuja la
-- firma, solo la devuelve tal cual.
--
-- El limite de 400 KB por columna es ~=300 KB de PNG. Una firma dibujada a
-- 480x160 ocupa 8-20 KB, asi que el tope no estorba a un humano y si corta un
-- payload bloated que alguien quisiera enviar a mano.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS firma_solicitante TEXT;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS firma_padre TEXT;

-- Un alumno que ya se habia inscrito antes de esta migracion tiene estas
-- columnas en NULL, que es lo correcto: el snapshot sigue siendo valido y el
-- entrenador lo completa con la ruta de correccion.
--
-- `edad` es SMALLINT y la hoja pide "EDAD / AÑOS", asi que no hay nada que
-- anadir de ese lado.

-- ---------------------------------------------------------------------------
-- 2. Bloque "PARA USO EXCLUSIVO DE LA INSTITUCIÓN"
-- ---------------------------------------------------------------------------
-- Lo escribe la academia despues del examen, nunca el alumno.

-- "RÉCORD DE ASISTENCIA %". NUMERIC y no SMALLINT porque la institucion lo
-- reporta con decimales (72.5 %). El CHECK acota el rango a algo que un humano
-- pueda querer decir; el backend lo vuelve a validar.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS record_asistencia NUMERIC(5, 2);

-- "ÁREA / CALIFICACIÓN": la hoja trae seis areas. Cada una es un numero en el
-- mismo rango que el record.
--
-- El nombre de cada columna no lleva tilde ni mayusculas porque Postgres los
-- pliega a minusculas sin comillas; con comillas serian dos objetos distintos.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_basicos NUMERIC(5, 2);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_rompimientos NUMERIC(5, 2);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_pateo NUMERIC(5, 2);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_combate_libre NUMERIC(5, 2);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_formas NUMERIC(5, 2);
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS cal_defensa_personal NUMERIC(5, 2);

-- "COMBATE UN PASO" y "PATEO SALTANDO" van dentro de COMENTARIOS GENERALES, pero
-- la hoja los imprime en su propia linea. Son texto libre, no notas: el
-- examinador escribe si se leisia el paso y como.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS nota_combate_un_paso TEXT;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS nota_pateo_saltando TEXT;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS comentarios TEXT;

-- "APROBADO / REPROBADO" con "FIRMA DEL EXAMINADOR" al lado.
--
-- BOOLEAN y nullable a proposito, y esto es lo importante: NULL = sin calificar,
-- true = aprobado, false = reprobado. Con NOT NULL DEFAULT false un alumno recien
-- inscrito apareceria como reprobado en cualquier reporte que lea el booleano sin
-- mirar si tiene calificacion.
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS aprobado BOOLEAN;
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS firma_examinador TEXT;

-- Marca de cuando se lleno el bloque de la institucion, para poder distinguir
-- "el entrenador no ha calificado" de "el entrenador lo borro todo".
ALTER TABLE examenes_inscripciones ADD COLUMN IF NOT EXISTS calificado_at TIMESTAMPTZ;

-- El reporte de examenes ordena por fecha de inscripcion y ahora trae las
-- calificaciones. Con 20 columnas mas por fila, ese recorrido ya no conviene
-- sin indice.
CREATE INDEX IF NOT EXISTS examenes_inscripciones_calificado_idx
  ON examenes_inscripciones (examen_id)
  WHERE aprobado IS NOT NULL;

-- ===========================================================================
-- NOTA PARA EL FRONTEND
-- ===========================================================================
-- Las firmas llegan como data URL completa ("data:image/png;base64,...") desde el
-- canvas. El backend las valida, le EXIGE ese prefijo y guarda solo el payload.
-- Al leerlas hay que volver a anteponer el prefijo antes de ponerlas en un <img>.
