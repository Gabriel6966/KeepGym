# Workout and History

## Invariants

- Templates, sesiones, sets e History se limitan al
  [principal autenticado](auth-profile.md), nunca al propietario elegido por el
  cliente. Exercise pertenece al catálogo global, no al usuario.
- Exercise identifica el catálogo; WorkoutTemplateExercise identifica una
  entrada planificada; WorkoutSessionExercise identifica un snapshot. Ninguno
  de esos UUIDs sustituye al de SetEntry ni a `sourceExerciseId`.
- Template es planificación mutable; SetEntry es ejecución histórica real.
  Los objetivos planificados no restringen las series/repeticiones registradas.
- WorkoutSession nace `IN_PROGRESS` y solo puede pasar a `COMPLETED` o
  `CANCELLED`. La transición es condicional y atómica; no se reabre una sesión.

## API / persistence semantics

- El catálogo global se mantiene mediante seed versionado y upsert por slug
  estable, conservando UUIDs. `GET /exercises` ofrece búsqueda/filtros/paginación
  backend y solo ejercicios activos; el detalle inactivo también devuelve 404.
  Retirar una referencia usa `isActive`, no borrado de históricos.
- Templates usa `/workout-templates`: POST crea; PATCH modifica metadata;
  DELETE devuelve 204 y establece `archivedAt`, sin borrado físico ni restore.
  Listado/detalle y Start excluyen plantillas archivadas.
- Añadir a `/:id/exercises` utiliza `exerciseId`; editar/eliminar utilizan el
  UUID de la entrada de Template. Reordenar con PUT `/:id/exercises/order`
  exige exactamente todos los UUIDs actuales de entradas, sin duplicados.
- Posiciones planificadas son contiguas desde 1. Add/remove/reorder son atómicos,
  también ante concurrencia; el backend devuelve el orden autoritativo.
  Un ejercicio ya presente no puede añadirse otra vez. La planificación existente
  puede conservar referencias inactivas; no permite añadirlas desde catálogo.
- Planning contiene `targetSets`, `targetRepsMin`, `targetRepsMax`,
  `restSeconds` y `notes`; min no supera max, descanso cero es válido y el default
  al añadir es 90 s. Notes y description admiten null explícito.
- `POST /workout-sessions` recibe `workoutTemplateId`: requiere plantilla propia,
  activa y no vacía. Copia nombre, orden, metadata de Exercise y planning dentro
  de una única transacción/snapshot; no crea SetEntry planificados.
- Sets se crean/editan/eliminan bajo la sesión y occurrence propias. Cada lista
  mantiene posiciones contiguas desde 1; add/delete se coordinan atómicamente con
  complete/cancel. El cliente no escribe posiciones ni `completedAt`.
- `loadKg` se persiste como Decimal(8,2): carga 0–10000 kg, hasta dos decimales;
  `reps` es entero 1–1000. RPE es opcional/null, 1–10 en incrementos de 0,5;
  RIR es opcional/null, entero 0–10. Carga cero es ejecución válida.
- History usa `GET /history/workouts`, `GET /history/workouts/:id` y
  `GET /history/exercises/:exerciseId`. Solo sesiones propias terminales;
  el detalle ajeno, inexistente o `IN_PROGRESS` devuelve 404.
- Lista History: filtro opcional `COMPLETED`/`CANCELLED`, búsqueda literal
  case-insensitive sobre nombre snapshot y paginación real. `from`/`to` filtran
  `startedAt` inclusivamente; requieren RFC3339 con zona y precisión máxima de ms.
  Orden: `startedAt DESC, id DESC`; ejercicios/sets del detalle por posición ASC.
  History por ejercicio usa el UUID source; por defecto consulta COMPLETED,
  ordenando por inicio de sesión DESC, sesión id DESC y posición de occurrence ASC.

## Historical integrity

- Editar/archivar Template o renombrar/inactivar Exercise no cambia sesiones ya
  creadas. Las lecturas históricas usan snapshots, no joins al catálogo mutable.
- `sourceExerciseId` puede ser null; el snapshot sigue siendo representable,
  pero no existe identidad source estable para enlazar Exercise Progress.
- Sesiones terminales y sus sets son read-only desde HTTP, sin añadir, editar o
  borrar ejecución. `CANCELLED` permanece en History, pero no alimenta las
  [analytics principales](training-analytics.md).

## Frontend obligations

- Preservar filtros, páginas, orden backend, valores canónicos y ausencia null.
- Consumir búsqueda de catálogo backend; no buscar solo en una página local ni
  consultar detalles por resultado. No reconstruir History desde fuentes actuales.
- Diferenciar identidades al añadir frente a editar/remove/reorder. Tras eliminar,
  releer la compactación backend; no fabricar nuevas posiciones localmente.
- Proteger doble submit. Ante escritura ambigua, reconciliar por lectura antes
  de permitir otra escritura, sin repetir automáticamente la operación.

## Must not

- Confundir planificación con sets realizados, reabrir sesiones o modificar
  históricos cuando cambia la fuente.
- Borrar físicamente Templates mediante HTTP, inventar restore o mostrar RPE/RIR
  ausente como cero. No calcular volumen, e1RM ni Records en el logging.

## Evidence

- Identidades/Decimal/relaciones: [schema](../../apps/api/prisma/schema.prisma).
- Catálogo: [seed](../../apps/api/prisma/seed-exercises.ts),
  [service](../../apps/api/src/exercises/exercises.service.ts),
  [tests seed](../../apps/api/test/exercises.seed.test.ts).
- Planning/archive/posiciones: [repository](../../apps/api/src/workout-templates/workout-templates.repository.ts),
  [tests](../../apps/api/test/workout-templates.repository.test.ts).
- Snapshots/transiciones: [repository](../../apps/api/src/workout-sessions/workout-sessions.repository.ts),
  [tests](../../apps/api/test/workout-sessions.repository.test.ts).
- Sets: [validación](../../apps/api/src/workout-sessions/set-entry.validation.ts),
  [concurrencia PostgreSQL](../../apps/api/test/integration/set-entries.postgres.ts).
- History: [repository](../../apps/api/src/history/history.repository.ts),
  [service](../../apps/api/src/history/history.service.ts),
  [tests PostgreSQL](../../apps/api/test/integration/history.postgres.ts).
- Frontend: [estado de Templates](../../apps/web/src/features/templates/templates.state.ts),
  [tests de identidad/orden](../../apps/web/test/templates-validation-state.test.ts),
  [tests History](../../apps/web/test/history-ui.test.tsx).
