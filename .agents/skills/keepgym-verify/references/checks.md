# Selección y registro de checks

## Modos

- **QUICK:** inspecciona scope/diff y ejecuta checks focalizados que resuelvan el
  riesgo concreto. Declara qué queda sin validar para un cierre completo.
- **FINAL:** usa la batería de [SKILL.md](../SKILL.md) como base. Ajusta solo con una
  razón explícita de alcance o una restricción del usuario; no presentes checks
  omitidos como ejecutados.

## Ampliación de contexto

Los enlaces son rutas condicionales, no una lista de lectura automática. Ni QUICK
ni FINAL implican cargar `keepgym-ui-phase`, `keepgym-integration-smoke`,
`keepgym-workspace-gardener`, `docs/contracts/*`, `harness/STATE.md`,
`harness/LEARNINGS.md`, `harness/phases/*` o README completo.

| Razón concreta del alcance                                          | Fuente o continuación limitada                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Estado de aprobación UI necesario para el dictamen                  | Evidencia puntual en STATE o referencia UI pertinente; un checklist no demuestra aprobación humana |
| Persistencia/snapshots requieren verificación real                  | Remitir a integration-smoke; no cargar ni ejecutar todo su workflow automáticamente                |
| Regla de arquitectura/dominio bajo revisión                         | Solo el contrato pertinente y su Evidence necesaria                                                |
| Auditoría explícita o encargo específico de infraestructura agentic | Gardener limitado al encargo, sin convertir una verificación normal en auto-auditoría              |

Sin una razón concreta, conservar el contexto por defecto del Skill. Pedir
`keepgym-verify FINAL` no solicita auditar el agentic workspace.

## Helpers deterministas

Ejecuta primero [preflight.mjs](../scripts/preflight.mjs): lee engines del repositorio,
compara Node/pnpm reales sin dependencias runtime y muestra rama/status Git.
Soporta los formatos actuales `X.Y.Z` y `>=X.Y.Z <MAJOR`; otros formatos devuelven FAIL.
Devuelve JSON con PASS (exit 0), FAIL (1) o BLOCKED (2). Si faltan pnpm o Git,
no instala ni repara nada. Localiza la raíz desde el script, también fuera del cwd
raíz y en worktrees. No busca ni activa runtimes alternativos.
Deshabilita descargas/auto-pinning de Corepack y el cambio automático de versión de
pnpm únicamente en sus procesos hijos, sin modificar configuración persistente.

Con preflight válido, usa [run-checks.mjs](../scripts/run-checks.mjs) con una lista
explícita, por ejemplo `node .agents/skills/keepgym-verify/scripts/run-checks.mjs typecheck diff-check`.
Usa el entorno compatible autorizado también para los procesos pnpm hijos; los
helpers no cambian PATH ni configuración.

| Check      | Comando existente                      |
| ---------- | -------------------------------------- |
| lint       | `pnpm lint`                            |
| typecheck  | `pnpm typecheck`                       |
| test       | `pnpm test --force`                    |
| build      | `pnpm build`                           |
| diff-check | `git diff --check`                     |
| postgres   | `pnpm --filter @gym/api test:postgres` |

El runner conserva el orden recibido, reenvía stdout/stderr y continúa tras fallos
por defecto. `--fail-fast` deja los siguientes como NOT RUN; una interrupción por
señal también detiene la secuencia. Resume estados y exit codes y devuelve el primer
código no cero (o fallo de arranque/señal). Sin checks, con nombres desconocidos o
duplicados, devuelve exit 2 sin ejecutar nada. `--help` muestra la sintaxis.

Estos helpers no seleccionan checks, certifican arquitectura ni conceden permiso de
commit. `postgres` solo llama a la suite existente; no gestiona Docker/PostgreSQL.

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
