# KeepGym — reglas del workspace

## Repositorio y alcance

- Monorepo pnpm workspaces + Turborepo, con un repositorio Git y un
  `pnpm-lock.yaml` raíz. No versionar `node_modules` ni artefactos generados.
- `apps/web`: Next.js App Router, React, TypeScript y Tailwind;
  `apps/api`: NestJS con TypeScript.
- `packages/types`: tipos compartidos; `packages/config`: configuración compartida;
  `docs`: documentación técnica.
- Preservar trabajo existente; hacer el menor cambio justificado dentro del alcance.
  No añadir funcionalidades ni refactors ajenos. Justificar dependencias nuevas.
- TypeScript `strict`; tipos concretos y entradas externas desde `unknown` validado.
  No usar `any`, `ts-ignore` ni `eslint-disable` para ocultar problemas.
- Cambios puramente visuales no reinician estado independiente ni añaden requests.

## Arquitectura y dominio

- Controllers pequeños; negocio en services; persistencia en repositories.
  Flujo: Controller → Service → Repository → PrismaService → PostgreSQL.
  Prohibidos Controller → Prisma y Service → Prisma.
- Los compositores de dominios, incluido Auth, usan servicios públicos sin SQL
  ni acceso directo a repositories/Prisma.
- PostgreSQL y Prisma ORM 7; schema, cliente y migraciones pertenecen a `apps/api`.
  El frontend no accede directamente a Prisma.
- El backend define la semántica de dominio. Los datos mutables actuales no
  reescriben la historia: la ejecución usa snapshots y sus estados terminales
  permanecen inmutables.
- Analytics se derivan en backend; el frontend presenta datos factuales, sin
  reconstruir analytics ni inferir juicios cualitativos.
  No persistir cálculos sin justificación arquitectónica.
- Preservar null frente a cero según contrato. Las escalas visuales son solo
  presentación, nunca datos de dominio.

## Seguridad y auth

- Ownership desde el principal autenticado, nunca desde un `userId` del cliente.
- No versionar ni exponer en respuestas, logs o errores secretos, credenciales,
  tokens ni hashes sensibles. Passwords nunca en claro; secretos desde el entorno.
  Documentar variables sin secretos en los `.env.example` aplicables.
- Access token frontend solo en memoria; refresh gestionado por backend mediante
  cookie HttpOnly. Aplicar el contrato Auth/Profile para los detalles.

## Base de datos

- Migraciones aplicadas inmutables; cambios nuevos mediante migraciones versionadas.
  `prisma db push` no sustituye migraciones normales.
- Sin autorización explícita: no `prisma migrate reset`, resets destructivos,
  borrado de datos/volúmenes, `docker compose down -v`, recuperación destructiva de
  Docker ni cambios de `.env` para sortear un fallo.

## Git y verificación

- Git de lectura permitido para inspección. Escrituras/publicación requieren
  autorización explícita: staging/`git add`, commit, push, merge, crear/actualizar PR
  y reset/clean destructivos.
- Antes de cerrar trabajo, realizar la verificación requerida por su alcance;
  procedimiento y batería FINAL en `$keepgym-verify`. No cerrar con checks necesarios
  fallidos o bloqueados; no ocultar fallos, desactivar checks ni introducir atajos.
- No reportar PASS sin evidencia de ejecución; identificar caché/evidencia reutilizada
  y su vigencia. Distinguir PASS / FAIL / BLOCKED / NOT RUN.
  Un fallo de entorno no demuestra por sí solo una regresión de producto.
- Browser QA y aprobación visual humana son distintos. Cuando se requiera esta
  aprobación, mantenerla como gate independiente de los checks técnicos.
  `SAFE TO COMMIT` solo expresa validación, no aprobación visual ni permiso Git.

## Skills

Usar el Skill cuyo trigger corresponda; no copiar sus procedimientos ni ampliar permisos:

- Implementar/rediseñar/pulir una fase UI solicitada:
  [$keepgym-ui-phase](.agents/skills/keepgym-ui-phase/SKILL.md).
- Verificar persistencia, snapshots, requests/mutations o cleanup de fixtures con
  API/PostgreSQL/navegador reales:
  [$keepgym-integration-smoke](.agents/skills/keepgym-integration-smoke/SKILL.md).
- Verificación técnica o validación pre-commit solicitada:
  [$keepgym-verify](.agents/skills/keepgym-verify/SKILL.md).
- Auditoría/mejora explícita de AGENTS, Skills, references o harness:
  [$keepgym-workspace-gardener](.agents/skills/keepgym-workspace-gardener/SKILL.md).

## Fuentes canónicas

Cargar solo las fuentes relevantes al encargo; sus secciones Evidence remiten al
código/tests actuales. Los detalles de dominio son obligatorios en su ámbito:

- Auth/Profile: [contrato](docs/contracts/auth-profile.md).
- Template/Workout/History: [contrato](docs/contracts/workout-history.md).
- Analytics/Dashboard/Progress/Calendar: [contrato](docs/contracts/training-analytics.md).
- Body: [contrato](docs/contracts/body.md).
- Estado operativo: [STATE](harness/STATE.md).
- Aprendizajes revisados: [LEARNINGS](harness/LEARNINGS.md).
- Cierres de fase, solo si hace falta su contexto: [formato](harness/phases/README.md).

El harness conserva contexto operativo; no sustituye contratos ni crea verdad de dominio.
