---
name: keepgym-verify
description: Verifica técnicamente una implementación de KeepGym cuando se solicita verification, final verification, check before commit, validate implementation, verificar una fase o este Skill. No implementa UI ni sustituye un smoke integrado.
---

# KeepGym Verify

## Procedimiento

1. Delimita el alcance solicitado y revisa el estado Git, incluidos cambios staged
   y archivos nuevos. Separa los cambios previos de los de esta tarea sin revertirlos.
2. Lee las instrucciones aplicables, `package.json` (`engines`, `packageManager` y
   scripts) y comprueba las versiones reales de Node y pnpm. Si falta un runtime
   compatible autorizado, marca BLOCKED; no debilites engines ni instales runtimes
   automáticamente.
3. Declara modo y checks necesarios con [checks.md](references/checks.md):
   - **QUICK:** revisión focalizada del diff y comprobaciones relevantes.
   - **FINAL:** cierre técnico/pre-commit; normalmente ejecuta desde la raíz:

     ```sh
     pnpm lint
     pnpm typecheck
     pnpm test --force
     pnpm build
     git diff --check
     git status --short
     git diff --stat
     ```

4. Respeta restricciones explícitas sobre ejecución. Reutiliza evidencia solo si
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
