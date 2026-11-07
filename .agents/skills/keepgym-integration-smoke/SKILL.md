---
name: keepgym-integration-smoke
description: Verifica flujos integrados de KeepGym con API, PostgreSQL o navegador reales cuando se requiere evidencia de persistencia, snapshots, requests/mutations o cleanup, o se invoca este Skill. No se activa para QA visual aislada ni por mencionar backend.
---

# KeepGym Integration Smoke

## Procedimiento

1. Delimita escenario, datos permitidos y resultado observable. Antes de iniciar
   procesos o tocar fixtures, lee
   [environment-safety.md](references/environment-safety.md) y registra el estado
   inicial real del entorno.
2. Valida prerequisitos y permisos. Si faltan, informa BLOCKED sin reparar
   configuración ni sustituir el flujo real por mocks para declarar PASS.
3. Selecciona en [scenarios.md](references/scenarios.md) solo el escenario necesario
   y abre sus contratos relevantes. Prepara un fixture aislado e identificable,
   registra sus IDs exactos y define cleanup antes de crearlo.
4. Ejecuta el flujo con el cliente real que se quiere verificar. Registra acciones,
   respuestas sanitizadas y estado persistido; compara con el contrato y su evidencia.
   Un render o test mockeado no acredita runtime integrado.
5. Mide reads y mutations por acción. Separa preparación/inspección del fixture,
   tráfico Auth y llamadas de dominio; distingue preflight si afecta al conteo.
   Comprueba invariantes con evidencia real, sin reconstruir resultados esperados
   mediante lógica de dominio nueva.
6. Ejecuta cleanup incluso si falla el escenario. Elimina únicamente datos cuya
   pertenencia al fixture esté probada y verifica **0 filas temporales** en todas
   las entidades afectadas. Si no puedes verificarlo, declara el cleanup pendiente.
7. Restaura los cambios de entorno autorizados al estado inicial registrado y
   verifica el resultado; no detengas procesos que ya pertenecían al usuario.

## Límites y salida

- Nunca ejecutes automáticamente `prisma migrate reset`, `prisma db push`,
  `docker compose down -v`, borrado de volúmenes/datos reales, cambios de `.env`,
  puertos o startup permanente.
- No ejecutes por defecto una fase UI, una batería técnica completa ni cambios de
  producto para resolver el smoke. Delimita cualquier continuación necesaria.
- No hagas staging, commit, push ni PR.
- Entrega escenario, PASS / FAIL / BLOCKED, evidencia observada, counts medidos,
  cleanup comprobado o pendiente y comparación inicial/final de servicios,
  contenedores, servidores y recursos del navegador. No afirmes restauración o cero
  filas sin comprobarlo; no incluyas credenciales ni tokens en el informe.
