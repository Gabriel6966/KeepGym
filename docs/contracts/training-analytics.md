# Training Analytics

## Invariants

- Analytics se derivan en backend de snapshots y ejecución; no se persisten
  métricas calculables ni se reconstruyen desde Exercise/Template actuales.
  Las consultas se limitan al principal autenticado y a sesiones `COMPLETED`.
- Unidades canónicas: carga/volumen externo en kg, reps/conteos y duración en
  segundos. Volumen es carga externa por reps. Carga/volumen cero puede representar
  actividad bodyweight; null significa ausencia, no cero.
- e1RM usa la implementación Epley central de `analytics.math`: solo carga positiva
  y reps enteras 1–20. La selección compara valores exactos antes del redondeo;
  las métricas públicas de fuerza/volumen se redondean a dos decimales.
- La elegibilidad depende del dominio: overview/global Trends, Consistency,
  Duration y Calendar cuentan sesiones completadas sin sets; Weekly Trends por
  ejercicio, Muscle Trends y Exercise Highlights requieren SetEntry real.

## API / persistence semantics

- Analytics (`GET /analytics/overview`, `/analytics/exercises/:exerciseId`):
  `from`/`to` RFC3339 opcionales; filtro inclusivo por `startedAt`; sin rango es
  all-time. Records (`/records/current`, `/records/exercises/:exerciseId`) entrega
  holders actuales all-time, sin filtro de rango.
- Trends (`/training-trends/weekly`, `/training-trends/exercises/:exerciseId/weekly`,
  `/training-trends/muscle-groups/weekly`) y `/training-duration/weekly` requieren
  `from`/`to` RFC3339 inclusivos e IANA `timezone`; máximo 730 días transcurridos
  entre instantes.
- `/training-trends/weekly-comparison` y `/dashboard/summary` requieren
  `weekStart` DATE-only Monday e IANA `timezone`: semanas locales completas,
  no 168 horas fijas.
- `/training-consistency/weekly` requiere `fromWeekStart`/`toWeekStart` Mondays
  DATE-only inclusivos e IANA `timezone`; máximo 104 semanas.
- `/training-calendar/days` requiere `fromDate`/`toDate` DATE-only inclusivos e
  IANA `timezone`; máximo 366 fechas. Todas estas lecturas son GET.

- Comparación semanal consulta dos periodos locales `[lunes, lunes siguiente)`.
  Devuelve previous/current, delta y percentageChange backend; base anterior cero
  produce porcentaje null, incluso si current también es cero.
- Weekly Trends y Duration son sparse, `weekStart ASC`; una semana ausente no
  equivale a bucket cero. Las métricas globales son workouts, sets, reps y volumen;
  Exercise Trends añade maxLoad y maxEstimated1RM (este último nullable).
- Analytics por ejercicio pagina `performances` sin paginar summary/candidatos.
  `summary.sessions` cuenta occurrences, incluidas las que no tienen sets, no
  workouts distintos. Orden de occurrences: inicio DESC, sesión id DESC,
  posición ASC. No extender aquí la exclusión de occurrences vacías de Trends.
- Records devuelve `MAX_LOAD` y `ESTIMATED_1RM` positivos cuando hay candidato.
  El holder es la primera consecución del máximo actual, ordenando por
  `SetEntry.completedAt ASC, setId ASC` tras comparar el valor. Reps o un empate posterior no sustituyen
  al primer holder. `achievedAt` es la fecha del set, no el fin de la sesión.
  El feed current ordena por achievedAt DESC; no representa eventos de PR.
- Consistency entrega totalWeeks, completedWorkouts, activeDays, activeWeeks,
  longestWeeklyStreak y endingWeeklyStreak. Las rachas son semanas consecutivas
  dentro del rango; ending termina exactamente en toWeekStart, no necesariamente
  en la semana actual. No se infiere consistencia de los buckets de Trends.
- Duration mide `endedAt - startedAt` entre instantes reales. Summary y buckets
  incluyen workouts, total y average backend (null sin workouts); el average del
  rango no es el promedio de promedios semanales. `endedAt` null o anterior al
  inicio en COMPLETED es error, no una fila que omitir o reparar.
- Calendar garantiza una fila por fecha, cronológica y densa; los ceros los
  construye el backend. Agrupa primero por sesión para no multiplicar workouts ni
  duración mediante joins con sets. Una sesión sin sets aporta workout/duración.
- Agrupación diaria/semanal usa `startedAt` local. Sesiones que cruzan medianoche
  o semana pertenecen completas a su bucket inicial, sin repartir tiempo o sets.
  Los límites locales se convierten independientemente ante DST; Consistency y
  Calendar incluyen hasta el inicio exclusivo de la semana/día posterior.
- Muscle Trends atribuye solo `primaryMuscle` del snapshot; ignora secundarios y
  occurrences sin sets. Workouts es DISTINCT por sesión/grupo. Devuelve buckets
  sparse con grupos en orden ASCII ascendente, no orden enum ni ranking por valor.
- Dashboard compone servicios públicos, sin SQL/repositories propios: Calendar
  aporta la actividad semanal; Trends la comparación y músculos; Consistency la
  ventana de doce semanas; History actividad reciente; Records holders;
  Analytics highlights; BodyAnalytics overview all-time. Fallos de subservicios
  producen error, nunca éxito parcial/ceros. No promete una transacción global
  común a todos esos servicios.

## Historical integrity

- La identidad de progreso por ejercicio es `sourceExerciseId` (Exercise UUID),
  nunca occurrence/template-entry/set UUID. Fuentes inactivas no invalidan los
  snapshots; source null no permite inventar un deep link por ejercicio.
- Metadata de Analytics/Trends/Records es histórica según su scope; no consultar
  catálogo actual para reconstruirla. El feed de holders usa el snapshot del set
  ganador; la cabecera del endpoint Records por ejercicio usa una occurrence
  COMPLETED reciente, que puede no ser la del holder.
- Exercise Highlights representa latest/previous performances por recencia con
  sets reales, no máximos all-time ni recomendaciones. Heaviest/best e1RM de
  Analytics son candidatos propios: no aplicarles los desempates de Records.

## Frontend obligations

- Dashboard hace una lectura compuesta `/dashboard/summary`, sin fan-out a
  dominios. Recent workouts, Records, highlights y Body all-time no se deben
  presentar como filtrados por la semana seleccionada.
- Exercise Progress mantiene Analytics/performances y Records all-time separados
  del rango de Trends; usa performances ya incluidas, sin duplicar History Exercise.
  Training Progress adapta su rango compartido a cada contrato temporal real.
- Preservar orden, sparse, null/zero, valores exactos y metadata backend.
  Calendar valida cobertura/orden/unicidad: una fecha ausente o duplicada es error,
  no ceros que completar. DATE-only no se interpreta como un instante UTC.
- Usar IANA timezone del navegador y aritmética de calendario. Para APIs con
  `to` inclusivo y precisión ms, un rango de días/semanas locales puede terminar
  un ms antes del siguiente límite local; no cambiarlo por exclusividad ficticia.
- Escalas visuales solo normalizan valores backend de una métrica/unidad.
  Cambiar métrica o filtro muscular local no consulta datos ni recalcula analytics.

## Must not

- Recalcular e1RM, holders, volumen, averages, deltas, porcentajes o rachas en el
  frontend; derivar nuevos totales mensuales o de rangos sumando buckets.
- Densificar Trends, sintetizar Calendar, incorporar secondaryMuscles o producir
  rankings, balance scores, interpretaciones de salud o recomendaciones.

## Evidence

- Analytics: [math](../../apps/api/src/analytics/analytics.math.ts),
  [repository](../../apps/api/src/analytics/analytics.repository.ts),
  [tests](../../apps/api/test/analytics.service.test.ts).
- Records: [repository](../../apps/api/src/records/records.repository.ts),
  [service](../../apps/api/src/records/records.service.ts),
  [tests de holders](../../apps/api/test/records.service.test.ts).
- Trends/comparaciones: [validation](../../apps/api/src/training-trends/training-trends.validation.ts),
  [repository](../../apps/api/src/training-trends/training-trends.repository.ts),
  [math de comparación](../../apps/api/src/training-trends/training-trends.math.ts),
  [tests de comparación](../../apps/api/test/integration/weekly-comparison.postgres.ts).
- Músculos: [orden/atribución](../../apps/api/src/training-trends/training-trends.service.ts),
  [tests](../../apps/api/test/muscle-training-trends.service.test.ts).
- Consistency: [repository](../../apps/api/src/training-consistency/training-consistency.repository.ts),
  [tests](../../apps/api/test/training-consistency.service.test.ts).
- Duration: [service](../../apps/api/src/training-duration/training-duration.service.ts),
  [tests PostgreSQL](../../apps/api/test/integration/training-duration.postgres.ts).
- Calendar: [service](../../apps/api/src/training-calendar/training-calendar.service.ts),
  [repository](../../apps/api/src/training-calendar/training-calendar.repository.ts),
  [tests PostgreSQL](../../apps/api/test/integration/training-calendar.postgres.ts).
- Dashboard: [composición](../../apps/api/src/dashboard/dashboard.service.ts),
  [lectura frontend única](../../apps/web/test/dashboard-visualizations-request.test.tsx).
- Frontend: [Exercise Progress](../../apps/web/src/features/progress/progress-detail.tsx),
  [adaptadores temporales](../../apps/web/src/features/progress/training-query.ts),
  [guard analytics](../../apps/web/test/progress-boundaries.test.ts),
  [guard Calendar](../../apps/web/test/training-calendar-boundaries.test.ts).
