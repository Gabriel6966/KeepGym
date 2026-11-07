# Body Measurements and Analytics

## Invariants

- BodyMeasurement es una observación histórica privada, no un campo de Profile
  ni un snapshot completo del cuerpo. Ownership procede del principal.
- Cada observación conserva al menos una métrica no-null, también después de
  PATCH concurrentes. Notes o measuredAt no sustituyen una medición.
- Métricas: `weightKg`, `bodyFatPercent`, `waistCm`, `chestCm`, `hipsCm`.
  Persistencia Decimal con hasta dos decimales, en kg/cm/percent canónicos.
  Valores presentes son positivos; cero no es válido como medición.
- BodyAnalytics se deriva exclusivamente de BodyMeasurement en backend;
  no persiste cálculos ni usa el peso actual de Profile.

## API / persistence semantics

- `/body-measurements` permite POST/listado y `/:id` GET/PATCH/DELETE.
  Cada operación se limita al usuario; eliminar devuelve 204 y borra la
  observación propia, no un recurso global ni un archive de Template.
- POST admite métricas parciales; omitir `measuredAt` usa el instante backend.
  PATCH requiere cambios, conserva campos omitidos y borra campos nullables con
  null explícito. Omitir measuredAt conserva la fecha histórica original.
- La validación de PATCH se aplica a la fila más reciente bajo bloqueo y exige
  que el resultado conserve una métrica. Dos escrituras concurrentes no pueden
  eliminar conjuntamente todas las mediciones.
- `measuredAt`, `from` y `to` son instantes RFC3339 con zona y precisión máxima
  de ms, no fechas DATE-only. Escrituras rechazan measuredAt futuro salvo
  tolerancia de reloj de 60 s. Los rangos son inclusivos por measuredAt.
- Listado paginado en orden `measuredAt DESC, id DESC`.
  `GET /body-analytics/overview` y `/timeline` aceptan rango opcional; sin rango
  es all-time. Timeline exige métrica, omite sus null y pagina en orden
  `measuredAt ASC, measurementId ASC`, conservando el total filtrado.
- Cada métrica tiene su secuencia independiente de valores no-null. Overview
  elige latest/previous dentro del rango por `measuredAt DESC, id DESC`; no busca
  fuera del rango para fabricar previous. Sin latest/previous suficientes,
  conserva null en observaciones/change según corresponda.
- `change = latest - previous` se calcula en backend con precisión decimal.
  Un cambio cero es real. Para bodyFatPercent la diferencia es en puntos
  porcentuales, no un porcentaje relativo de mejora.

## Historical integrity

- Editar una observación corrige esa entrada y puede cambiar los analytics
  derivados; no crea mediciones sintéticas ni arrastra valores de otras fechas.
- Fechas y métricas parciales permanecen independientes. La observación más
  reciente de una métrica puede tener otra fecha que la de las demás.

## Frontend obligations

- Renderizar observaciones parciales y ausencia null; preservar la diferencia
  entre omitir un campo, borrarlo y conservar su valor.
- Serializar horarios locales con offset explícito. Rechazar huecos DST sin
  desplazarlos silenciosamente; no sobrescribir el instante original al editar
  otros campos, incluso en una hora local repetida.
- Presentar latest/previous/change recibidos sin reconstruirlos desde una página
  de mediciones. El Dashboard consume el overview all-time del dominio Body.
- Las unidades canónicas no cambian implícitamente con Profile.UnitSystem.
  Los errores y escrituras ambiguas siguen siendo errores y requieren
  reconciliación, nunca observaciones vacías o reenvíos automáticos.

## Must not

- Convertir null en cero, completar métricas ausentes desde otras observaciones
  o mantener porcentajes/cambios calculados como estado persistido.
- Añadir BMI, categorías de salud, objetivos o juicios sobre el signo de change.

## Evidence

- Persistencia/ownership: [schema](../../apps/api/prisma/schema.prisma),
  [repository](../../apps/api/src/body-measurements/body-measurements.repository.ts).
- Parcialidad/PATCH: [validation](../../apps/api/src/body-measurements/body-measurements.validation.ts),
  [tests concurrentes PostgreSQL](../../apps/api/test/integration/body-measurements.postgres.ts).
- Secuencias/orden/rango: [repository analytics](../../apps/api/src/body-analytics/body-analytics.repository.ts),
  [service](../../apps/api/src/body-analytics/body-analytics.service.ts),
  [tests](../../apps/api/test/body-analytics.service.test.ts).
- Precisión de change: [math](../../apps/api/src/body-analytics/body-analytics.math.ts),
  [tests](../../apps/api/test/body-analytics.math.test.ts).
- Fechas y escrituras frontend: [conversión local](../../apps/web/src/features/body/body-time.ts),
  [tests DST/PATCH](../../apps/web/test/body-helpers.test.ts).
