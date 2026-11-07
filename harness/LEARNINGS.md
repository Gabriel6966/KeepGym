# KeepGym Learnings

Consultar solo los casos relevantes. La verdad de dominio permanece en
[código/tests y contratos](../docs/contracts/); este registro conserva evidencia
operativa y remite a los procedimientos existentes.

## Runtime engines

- Fecha: 2026-11-07.
- Problema: una versión global de Node más nueva no garantizaba compatibilidad.
- Evidencia: preflight observado con Node 26.13.0 → BLOCKED y 24.22.1 → PASS;
  requisitos vigentes en [package.json](../package.json).
- Regla/solución: aplicar el [preflight canónico](../.agents/skills/keepgym-verify/scripts/preflight.mjs)
  y el [procedimiento de verificación](../.agents/skills/keepgym-verify/SKILL.md),
  sin ajustar engines para acomodar el runtime instalado.
- Aplicabilidad: checks locales tras cambiar o reabrir el entorno.
- Status: ACTIVE.

## Dependencias hoisted

- Fecha: 2026-11-07.
- Problema: el preflight utilizaba `semver` sin declaración directa aplicable.
- Evidencia: la resolución desde raíz fallaba y el hoisting de pnpm la permitía;
  los manifests no lo declaraban directamente, aunque aparece en el
  [lockfile](../pnpm-lock.yaml). El [helper actual](../.agents/skills/keepgym-verify/scripts/preflight.mjs)
  ya no depende de esa resolución.
- Regla/solución: comprobar la declaración aplicable antes de usar una dependencia
  desde tooling. Para este helper se eligió validación autocontenida de los formatos
  engines actuales; el código enlazado define su soporte.
- Aplicabilidad: helpers del workspace que puedan funcionar solo por el estado
  incidental de node_modules.
- Status: ACTIVE.

## POSTGRESQL PORT / INSTANCE CONFLICT

- Fecha: 2026-11-07.
- Problema: en Windows pueden coexistir PostgreSQL nativo y el del proyecto en
  Docker, compitiendo por 5432. Un fallo de conexión/credenciales puede indicar
  que se está alcanzando la instancia equivocada.
- Evidencia: el [README](../README.md) documenta el conflicto; el
  [procedimiento de entorno](../.agents/skills/keepgym-integration-smoke/references/environment-safety.md)
  contiene el diagnóstico operativo.
- Regla/solución: identificar listener e instancia real antes de cambiar
  credenciales/configuración. Nunca usar `prisma migrate reset`, `prisma db push`,
  `docker compose down -v`, borrar volúmenes ni borrar datos como solución.
- Aplicabilidad: integration smoke / PostgreSQL verification / environment diagnosis.
- Status: ACTIVE.

## VISUAL APPROVAL IS SEPARATE FROM TECHNICAL PASS

- Fecha: 2026-11-07.
- Problema: lint/typecheck/tests/build PASS no equivalen a aprobación visual.
- Evidencia: [keepgym-ui-phase](../.agents/skills/keepgym-ui-phase/SKILL.md) separa
  validación técnica y revisión visual humana.
- Regla/solución: mantener la aprobación humana como gate independiente cuando la
  fase UI lo requiera. Un `SAFE TO COMMIT` técnico no acredita una aprobación visual
  que no ocurrió; browser QA y human visual approval son comprobaciones separadas.
- Aplicabilidad: UI phases / pre-commit review.
- Status: ACTIVE.
