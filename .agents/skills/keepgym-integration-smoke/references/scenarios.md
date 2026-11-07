# Escenarios de smoke

Lee solo el escenario solicitado y sus contratos. Usa sus secciones Evidence para
localizar las fuentes actuales antes de elegir endpoints, payloads y expectativas.
Los pasos siguientes organizan la comprobación; no definen semántica de dominio.

## AUTH

Contrato: [Auth / Profile](../../../../docs/contracts/auth-profile.md).

1. Prepara cuentas temporales en los estados necesarios para el caso solicitado.
2. Recorre entry, registro/login y destino real; prueba recarga/recuperación y errores
   solo según el alcance. Observa rutas, respuestas y estado persistido.
3. Mide solicitudes por acción y contrasta con el flujo esperado del contrato y
   código actual. Comprueba que las interacciones visuales no añadan solicitudes.
4. Retira las cuentas y dependencias temporales; comprueba cleanup completo.

## WORKOUT

Contrato: [Workout / History](../../../../docs/contracts/workout-history.md).

1. Prepara una sesión temporal y los datos mínimos para las operaciones solicitadas.
2. Recorre el logging real y la transición de estado que corresponda al caso.
3. Compara respuesta y persistencia tras cada acción relevante; mide reads/mutations,
   incluyendo protección de acciones repetidas cuando forme parte del scope.
4. Retira el fixture y verifica sus entidades dependientes.

## TEMPLATE_WORKOUT

Contrato: [Template / Workout](../../../../docs/contracts/workout-history.md).

1. Crea una plantilla temporal con entradas identificables y captura el estado fuente.
2. Inicia el workout por el flujo real y conserva evidencia del snapshot persistido.
3. Si el escenario lo requiere, modifica únicamente la fuente temporal y compara
   antes/después con el snapshot. Valida el resultado contra el contrato, sin
   inferirlo solo por lo que muestra la UI.
4. Mide solicitudes y retira plantilla, sesión y dependencias del fixture.

## HISTORY

Contrato: [History](../../../../docs/contracts/workout-history.md).

1. Prepara sesiones temporales diferenciables para los filtros/orden solicitados.
2. Recorre listado y detalle reales; comprueba navegación y estado URL del caso.
3. Compara datos mostrados con respuestas y persistencia según el contrato; registra
   lecturas y cualquier mutation inesperada.
4. Retira las sesiones temporales y sus dependencias.

## BODY

Contrato: [Body](../../../../docs/contracts/body.md).

1. Prepara observaciones temporales apropiadas para el caso y registra su estado.
2. Recorre las operaciones solicitadas con el cliente real.
3. Compara payloads, respuestas, recarga y persistencia con las expectativas del
   contrato; registra reads/mutations y errores observados.
4. Elimina únicamente las observaciones del fixture y verifica cero filas temporales.

## ANALYTICS

Contrato: [Dashboard / Progress / Analytics / Calendar](../../../../docs/contracts/training-analytics.md).
Abre también [Workout / History](../../../../docs/contracts/workout-history.md) o
[Body](../../../../docs/contracts/body.md) solo si el fixture requiere esos dominios.

1. Elige datos temporales y límites temporales que permitan distinguir el caso
   solicitado según el contrato; no reproduzcas fórmulas para generar expectativas.
2. Captura respuestas reales y compara las representaciones de la UI con ellas,
   preservando la semántica que corresponda al endpoint verificado.
3. Mide lecturas por carga/interacción y registra mutations inesperadas por separado.
4. Retira los datos fuente del fixture y comprueba sus dependencias.
