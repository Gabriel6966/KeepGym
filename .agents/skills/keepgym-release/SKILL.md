---
name: keepgym-release
description: Publica y cierra una rama autorizada de KeepGym mediante PR a main, o simula el flujo en DRY RUN. Invocación explícita únicamente.
---

# KeepGym Release

- **DRY RUN** sigue la inspección de solo lectura de [operación](references/operations.md).
  Acepta observaciones reales o fixtures declarados. Presenta el siguiente paso y
  el motivo de cualquier bloqueo, sin modificar Git ni GitHub.
- **RELEASE o reanudación** exige una orden explícita de publicación para una rama
  identificada. Vincula el permiso al repositorio, base, rama, alcance y contenido
  aprobados. Una invocación, una aprobación técnica o un resultado verde no
  conceden permiso. Si falta una evidencia aplicable, detente.
- Usa [release-gates.mjs](scripts/release-gates.mjs) para evaluar las mismas
  decisiones en ambos modos. Una decisión del script describe un estado
  observado y carece de autoridad para ejecutar escrituras.

## Secuencia autorizada

1. Lee AGENTS.md y [operación](references/operations.md). Verifica repositorio,
   principal, rama, alcance, archivos, SPEC y PLAN cuando apliquen, aprobación
   visual humana y smoke cuando correspondan, y **FINAL PASS** vigente de
   [$keepgym-verify](../keepgym-verify/SKILL.md). Documenta la evidencia y fija el
   estado de reanudación antes de escribir.
2. Prepara solo los archivos aprobados, revisa el índice, crea o reconcilia el
   commit, registra su SHA y publica esa referencia con push normal. Busca un
   PR del mismo repositorio y rama antes de crear uno hacia `main`.
3. Antes de decidir el merge, verifica PR, URL, base, head y SHA, política
   efectiva de `main`, CI obligatorio, reviews, conversaciones, conflictos
   y permisos sin excepciones. Si hay merge queue, respétala con el SHA fijado.
   Un PR en cola o en auto-merge se registra como **PENDING MERGE** mientras
   GitHub aún no confirme la fusión.
4. Para un **PR MERGED**, lee [limpieza](references/cleanup.md). Prueba que el SHA
   aprobado y el commit de merge llegaron a `main`. Actualiza `main` por fast-forward,
   limpia las referencias específicas y comprueba la sincronización final.

GitHub decide la fusión conforme a sus reglas. Quedan fuera del flujo el push
forzado de commits, `--admin`, los bypasses, aprobar el propio PR, reescribir la
rama, cambiar protecciones, borrar ramas ajenas y limpiar datos o entornos.
GitHub sin CI obligatorio comprobado bloquea el merge automático.

Informa autorización y alcance, SHA, PR, checks observados, resultado del
merge, limpieza verificada o pendiente, sincronización y bloqueos. Distingue
`BLOCKED`, `PENDING MERGE`, `PR MERGED` y cierre completo.
