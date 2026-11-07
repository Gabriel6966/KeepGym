# Cierres de fase

Crear `harness/phases/<phase-id>.md` solo cuando un cierre conserve decisiones,
evidencia o pendientes con valor operativo para otra sesión. No crear un archivo
por ticket ni reconstruir cierres anteriores automáticamente.

Cargar un cierre únicamente cuando haga falta su contexto; no leer todos al retomar
trabajo. Para estado vigente, consultar [STATE](../STATE.md); para incidentes
reutilizables, [LEARNINGS](../LEARNINGS.md) cuando correspondan.

## Formato recomendado

```markdown
# <Phase>

Date: YYYY-MM-DD
Branch/commit: <rama y commit verificados, o indicar sin commit>

## Scope

Alcance breve y límites relevantes.

## Decisions

Solo decisiones no obvias y su motivo.

## Verification

Checks relevantes y evidencia observada; distinguir fallos, bloqueos y no ejecutados.

## Human review

Qué se aprobó visual/manualmente y qué sigue pendiente; no inferirlo de los tests.

## Limitations / follow-up

Solo pendientes reales y condiciones para continuarlos.
```

Verificar commit y estado de merge por separado. Enlazar las fuentes canónicas sin
copiar contratos ni el prompt original. No incluir logs masivos, secretos, datos
reales de usuarios ni capturas binarias en estos cierres.
