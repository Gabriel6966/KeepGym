# Selección y registro de checks

## Modos

- **QUICK:** inspecciona scope/diff y ejecuta checks focalizados que resuelvan el
  riesgo concreto. Declara qué queda sin validar para un cierre completo.
- **FINAL:** usa la batería de [SKILL.md](../SKILL.md) como base. Ajusta solo con una
  razón explícita de alcance o una restricción del usuario; no presentes checks
  omitidos como ejecutados.

## Matriz por alcance

| Cambio o verificación                              | Checks relevantes                                                                     | PostgreSQL / runtime                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Solo Markdown, contratos o Skills                  | Referencias, metadata si aplica, scope, formato y `git diff --check`                  | No iniciar servicios ni suites de producto por defecto                |
| Presentación / interacción UI                      | Pruebas afectadas y QA visual; batería raíz en FINAL                                  | Smoke solo si se solicita o es necesario acreditar un flujo real      |
| Cliente API / Auth / routing                       | Pruebas de contratos, errores, requests y navegación afectados; batería raíz en FINAL | Evaluar si el cambio necesita evidencia de sesión o persistencia real |
| Persistencia, queries, transacciones o migraciones | Pruebas de dominio y regresión; batería raíz en FINAL                                 | Ejecutar la suite PostgreSQL aplicable                                |
| Flujo integrado explícito                          | Evidencia del escenario real y counts medidos                                         | Usar integration-smoke para fixture, cleanup y restauración           |

Cuando corresponda, confirma en los scripts actuales y ejecuta desde la raíz
`pnpm --filter @gym/api test:postgres`. No inicies ni reconfigures PostgreSQL/Docker
solo para completar una tabla; un prerequisito no disponible se informa como BLOCKED.

## Evidencia

- **PASS:** check ejecutado con éxito; identifica evidencia reutilizada y su vigencia.
- **FAIL:** check ejecutado y fallido; conserva el fallo y su impacto.
- **BLOCKED:** no pudo completarse por un prerequisito o permiso concreto.
- **NOT RUN:** no se ejecutó; explica si es ajeno al scope o sigue siendo necesario.
- Registra conteos observados por suite, separando PostgreSQL; no copies números de
  sesiones anteriores ni infieras conteos que la salida no proporciona.
- Si existe caché, distingue resultados cacheados de una ejecución forzada.

## Scope y cierre

- Inspecciona diff staged/unstaged y archivos no versionados, además de los archivos
  previstos por el ticket. No leas secretos para comprobar si cambiaron.
- Contrasta rutas afectadas con el alcance; señala cambios ajenos sin eliminarlos.
- Revisa logs, screenshots, perfiles de navegador, fixtures y archivos de debug
  creados durante la tarea. Retira solo artefactos propios identificados; conserva
  archivos de producto y evidencia externa que todavía se necesite.
- Repite checks solo si hay cambios posteriores, fallos o dudas sin resolver que
  invaliden la evidencia. Ejecuta los comandos Git de cierre sobre el estado final.
- Si falta un check necesario, informa el bloqueo y `SAFE TO COMMIT: NO`.
