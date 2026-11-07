---
name: keepgym-verify
description: Verifica técnicamente una implementación de KeepGym cuando se solicita verification, final verification, check before commit, validate implementation, verificar una fase o este Skill. No implementa UI ni sustituye un smoke integrado.
---

# KeepGym Verify

## Contexto por defecto

Leer únicamente AGENTS.md, este SKILL.md, [checks.md](references/checks.md), los
manifests package/workspace relevantes y el diff/status necesarios.
No cargar automáticamente otras Skills, contratos, harness ni README completo,
tampoco en FINAL. Ampliar solo ante una razón concreta derivada del alcance y
explicar el motivo antes de abrir la fuente adicional.

Una verificación normal no es una auditoría del workspace. No activar
`keepgym-workspace-gardener` para auditar este Skill durante una verificación normal;
la auto-validación de routing/Skills requiere petición explícita o un encargo
específico de infraestructura agentic.

## Procedimiento

1. Delimita el alcance solicitado y revisa el estado Git, incluidos cambios staged
   y archivos nuevos. Separa los cambios previos de los de esta tarea sin revertirlos.
2. Lee las instrucciones aplicables y ejecuta primero
   `node .agents/skills/keepgym-verify/scripts/preflight.mjs` desde el entorno actual.
   Si devuelve BLOCKED o FAIL, informa la causa; no debilites engines ni instales
   runtimes automáticamente. Los bloqueos de runtime requieren resolución autorizada
   y otro preflight antes de ejecutar los checks afectados.
3. Declara modo y checks necesarios con [checks.md](references/checks.md) y pasa una
   lista explícita a [run-checks.mjs](scripts/run-checks.mjs):
   - **QUICK:** revisión focalizada del diff y comprobaciones relevantes.
   - **FINAL:** cierre técnico/pre-commit; normalmente ejecuta desde la raíz:

     ```sh
     node .agents/skills/keepgym-verify/scripts/run-checks.mjs lint typecheck test build diff-check
     git status --short
     git diff --stat
     ```

4. Interpreta los resultados; los helpers no deciden scope ni SAFE TO COMMIT.
   Conserva la revisión manual de diff, arquitectura y archivos accidentales.
   Respeta restricciones explícitas sobre ejecución. Reutiliza evidencia solo si
   sigue vigente para el mismo código y entorno; explica omisiones y resultados
   reutilizados. Una revisión QUICK no acredita una batería FINAL.
5. Si hace falta verdad de dominio, abre solo el documento relevante de
   [docs/contracts](../../../docs/contracts/). Si el alcance exige persistencia real,
   determina la suite PostgreSQL necesaria; para un flujo integrado usa
   [keepgym-integration-smoke](../keepgym-integration-smoke/SKILL.md) únicamente dentro
   del alcance autorizado. No inventes fixtures complejos desde este Skill.

## Límites y salida

No amplíes el ticket para hacer pasar checks. No ocultes fallos ni descartes cambios
ajenos. No hagas staging, commit, push ni PR.

Entrega modo, scope, checks con PASS / FAIL / BLOCKED / NOT RUN, evidencia vigente,
conteos reales cuando existan, revisión del diff y bloqueos concretos. Termina con
`SAFE TO COMMIT: YES` solo si toda validación necesaria para ese alcance está
satisfecha y no quedan bloqueos conocidos; en otro caso, `SAFE TO COMMIT: NO`.
Esta conclusión no concede autorización para ejecutar un commit.
