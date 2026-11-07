---
name: keepgym-ui-phase
description: Implementa, rediseña o pule una fase o pantalla UI de KeepGym cuando se solicita ese trabajo o se invoca este Skill. No se activa solo por tocar un archivo frontend.
---

# KeepGym UI Phase

## Procedimiento

1. Lee las instrucciones del repositorio y delimita la pantalla, fase, rutas y
   comportamiento autorizado. Identifica superficies aprobadas que deben conservarse.
2. Inspecciona la UI existente y sus consumidores. Carga únicamente los contratos
   relevantes de esta tabla y consulta su evidencia cuando necesites confirmar código.

   | Área                                        | Contrato                                                               |
   | ------------------------------------------- | ---------------------------------------------------------------------- |
   | Auth / Profile                              | [auth-profile.md](../../../docs/contracts/auth-profile.md)             |
   | Template / Workout / History                | [workout-history.md](../../../docs/contracts/workout-history.md)       |
   | Dashboard / Progress / Analytics / Calendar | [training-analytics.md](../../../docs/contracts/training-analytics.md) |
   | Body                                        | [body.md](../../../docs/contracts/body.md)                             |

3. Implementa mobile-first reutilizando App Shell, componentes y temas existentes.
   Integra la pantalla sin rediseñar el shell ni extender la fase automáticamente.
   Conserva arquitectura, contratos y comportamiento funcional.
4. Comprueba el comportamiento afectado con pruebas focalizadas. Para QA visual,
   lee [ui-review.md](references/ui-review.md) y revisa la implementación en navegador
   real. Distingue lo observado de lo simulado o no comprobado.
5. Presenta el resultado para revisión humana. La aprobación visual y la validación
   técnica son estados separados; no infieras una a partir de la otra.

## Límites y salida

- No ejecutes automáticamente la batería final. Si se solicita, usa
  [keepgym-verify](../keepgym-verify/SKILL.md) dentro del alcance autorizado.
- No emprendas integration smoke ni crees fixtures por iniciativa propia. QA visual
  no acredita persistencia; si se requiere esa evidencia, delimita el trabajo con
  [keepgym-integration-smoke](../keepgym-integration-smoke/SKILL.md).
- No hagas staging, commit, push ni PR.
- Informa archivos cambiados, comportamiento conservado, QA observado, checks
  realizados/bloqueados y elementos pendientes de aprobación visual.
