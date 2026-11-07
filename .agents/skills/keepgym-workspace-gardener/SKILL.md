---
name: keepgym-workspace-gardener
description: Audita o mantiene la infraestructura agentic de KeepGym solo cuando se solicita explícitamente revisar AGENTS/Skills, mejorar el Codex workspace o usar workspace gardener. Es read-only por defecto y no se activa para trabajo de producto.
---

# KeepGym Workspace Gardener

## Procedimiento

1. Confirma el alcance explícito de la auditoría de infraestructura. Mantén el modo
   **READ-ONLY** salvo autorización posterior para implementar cambios concretos.
2. Inspecciona instrucciones aplicables, Skills y sus referencias. Incluye harness
   únicamente si existe; no lo crees para completar la revisión.
3. Usa [audit.md](references/audit.md) para detectar duplicados, contradicciones,
   referencias rotas e instrucciones obsoletas. Comprueba las fuentes contra la
   rama actual; distingue archivos disponibles de propuestas o código no mergeado.
4. Cuando una instrucción reclame verdad de dominio, contrástala con el documento
   pertinente en [docs/contracts](../../../docs/contracts/) y su evidencia. Carga
   solo lo necesario para resolver el hallazgo.
5. Propón mejoras pequeñas con evidencia, impacto y archivos afectados. Separa
   observaciones de cambios que requieren revisión humana y autorización posterior.

## Límites y salida

- No modifiques automáticamente AGENTS, Skills, contracts ni harness. Una auditoría
  no autoriza su implementación; si se autoriza una fase posterior, respeta sus
  archivos y cambios concretos.
- No trabajes en producto, crees harness/automatizaciones ni inicies servicios o
  suites de producto para una auditoría de instrucciones.
- No hagas staging, commit, push, merge ni PR.
- Entrega alcance inspeccionado, hallazgos con rutas/evidencia, propuestas acotadas
  y asuntos que requieren decisión humana. Si no hay hallazgos útiles, indícalo sin
  fabricar propuestas ni escribir un informe dentro del repositorio por defecto.
