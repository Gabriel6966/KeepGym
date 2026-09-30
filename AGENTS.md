# Reglas del proyecto

## Arquitectura

- `apps/web`: frontend Next.js con App Router, TypeScript y Tailwind CSS.
- `apps/api`: backend NestJS con TypeScript.
- `packages/types`: tipos compartidos.
- `packages/config`: configuración compartida.
- `docs`: documentación técnica.

El monorepo utiliza pnpm workspaces y Turborepo. Hay un único `pnpm-lock.yaml`
en la raíz y un único repositorio Git. No versionar `node_modules` ni artefactos
generados.

## Base de datos

- PostgreSQL es la base de datos; Prisma ORM 7 es el ORM.
- Prisma pertenece a `apps/api`, incluido su schema, cliente y migraciones.
- Versionar las migraciones en Git. Nunca modificar una migración ya aplicada;
  crear una nueva.
- Nunca usar `db push` como sustituto de las migraciones normales.
- El catálogo global Exercise se gestiona mediante seed versionado, no desde
  endpoints de usuario. Los slugs son estables y las referencias usan su UUID.
- Retirar ejercicios mediante `isActive`; no borrar físicamente ejercicios que
  puedan estar referenciados por históricos.

## Implementación

- Utilizar TypeScript con `strict: true` en todas las aplicaciones y paquetes.
- Evitar `any`; utilizar tipos concretos o `unknown` con validación.
- Mantener los cambios pequeños y enfocados.
- No modificar código no relacionado con el ticket actual.
- No implementar funcionalidades fuera del alcance solicitado.
- No introducir dependencias sin una razón clara.
- Validar las entradas externas antes de utilizarlas.
- Mantener los controladores NestJS pequeños.
- La lógica de negocio debe vivir en services.
- Los services utilizan repositories para la persistencia de dominio.
  Los controladores no acceden directamente a Prisma.
- AuthService utiliza UsersService y SessionsService; no accede directamente a repositories ni Prisma.
- Los recursos del usuario autenticado obtienen su identidad del principal,
  nunca de un userId enviado por el cliente.
- Profile contiene datos relativamente estables. El peso y otras medidas
  corporales pertenecen al histórico BodyMeasurement, no a Profile. Persistir
  mediciones en kg/cm/% usando Decimal; sus analytics se derivan exclusivamente
  de BodyMeasurement, sin persistir cálculos. Cada métrica parcial tiene su propia
  secuencia temporal de observaciones no-null dentro del rango consultado.
  Cada observación conserva al menos una métrica, también tras PATCH concurrentes.
- WorkoutTemplate representa planificación, nunca rendimiento realizado. Se
  archiva en lugar de borrarse físicamente mediante HTTP.
- Las entradas de una plantilla mantienen posiciones contiguas desde 1;
  añadir, eliminar y reordenar deben preservar el orden de forma atómica.
- WorkoutSession es histórico: persiste un snapshot atómico y no reconstruye
  sus datos leyendo WorkoutTemplate o Exercise mutables.
- Las sesiones de entrenamiento solo pasan de IN_PROGRESS a COMPLETED o
  CANCELLED mediante una transición condicional atómica; no se reabren.
- WorkoutSessionExercise conserva planificación. SetEntry es la fuente histórica
  del rendimiento realizado; nunca mezclar ambos datos. La carga se persiste en
  kilogramos usando Decimal, no Float.
- Las series mantienen posiciones contiguas desde 1 mediante operaciones atómicas
  coordinadas con complete/cancel. Una sesión terminada no admite cambios desde HTTP.
- Analytics deriva métricas de snapshots y SetEntry; no persistir métricas
  calculables sin una razón arquitectónica. Solo COMPLETED alimenta las métricas
  principales. El volumen usa carga externa en kg × reps; el e1RM inicial usa
  Epley únicamente con carga positiva y 1–20 reps, redondeando al presentar.
- Personal Records se deriva de SetEntry de sesiones COMPLETED, sin persistir
  PRs prematuramente. El record holder es la primera consecución del valor
  máximo actual según completedAt y setId, no la repetición más reciente.
- Los agregados temporales de entrenamiento definen explícitamente su timezone
  y usan startedAt de sesiones COMPLETED; los agregados semanales no se persisten.
  Las tendencias por ejercicio requieren SetEntry real; una occurrence sin series
  no es rendimiento. Reutilizar la fórmula e1RM centralizada en analytics.math.

## Seguridad

- Nunca introducir secretos en el repositorio.
- Nunca loggear passwords, tokens o credenciales.
- Nunca almacenar passwords en claro: Auth los hashea con Argon2id.
- Los secretos JWT provienen del entorno, nunca del código fuente.
- `passwordHash` es interno: nunca incluir su valor en representaciones públicas,
  logs ni errores.
- Documentar variables de entorno en `.env.example` sin valores secretos.
- Los refresh tokens son opacos y se rotan; persistir únicamente el hash SHA-256
  de su secret. Nunca incluir tokens, secrets ni hashes de sesión en JSON o logs.
- Las cookies de autenticación son HttpOnly y requieren validación de Origin.
  Nunca combinar CORS wildcard con credentials.

## Comprobaciones obligatorias

Antes de terminar cualquier ticket, ejecutar desde la raíz:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Si alguno falla, corregirlo antes de considerar terminado el ticket. No ocultar
errores, desactivar comprobaciones ni introducir atajos para hacerlos pasar.
