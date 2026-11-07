# Criterios de mantenimiento

## Promoción

- Propón una regla permanente solo si existe evidencia repetible de que cambia
  decisiones futuras, tiene alcance claro y no está ya cubierta.
- Asigna la fuente correcta: reglas generales en AGENTS, procedimiento reutilizable
  en un Skill, detalle condicional en references y verdad de dominio en contracts.
- Excluye prompts de fases pasadas, preferencias visuales sin aprobar, estados de
  máquina, rutas personales y conteos de una ejecución concreta.

## Retirada

- Propón retirar instrucciones obsoletas, sin consumidores o sustituidas por una
  fuente canónica verificada. Inspecciona referencias entrantes antes de recomendarlo.
- No retires una regla solo por antigüedad o porque la auditoría no la ejercitó.

## Duplicación y contradicción

- Identifica el mismo deber mantenido en varios sitios con riesgo de divergir;
  recomienda una fuente y enlaces desde sus consumidores.
- Distingue una remisión útil de copiar reglas completas. Para una contradicción,
  cita ambas instrucciones y la evidencia actual; no elijas una arquitectura nueva.

## Referencias obsoletas

- Resuelve rutas relativas desde el archivo que las contiene; comprueba archivo,
  anchor/símbolo y contenido que sostiene la afirmación cuando corresponda.
- Confirma que la evidencia exista en la rama actual y no dependa solo de una UI
  pendiente de merge. Prefiere la fuente canónica de dominio/backend/test equivalente
  si realmente respalda la misma afirmación.
- Trata una fuente inaccesible como no verificada, sin inventar su reemplazo.

## Propuestas y revisión humana

- Recomienda como máximo tres propuestas por auditoría, priorizadas por impacto y
  evidencia. Si hay más hallazgos, enumera los restantes sin ampliar la implementación.
- Para cada propuesta indica problema, evidencia, cambio mínimo, archivo destino y
  validación prevista. Señala incertidumbres o decisiones de arquitectura separadas.
- Presenta propuestas para revisión humana antes de una fase posterior de cambios.
  No apliques automáticamente promociones, retiradas ni correcciones de referencias.
