# Gym App

Base de una aplicación para registrar entrenamientos y medir el progreso.
GYM-001 inicializa exclusivamente la arquitectura del monorepo: una página
inicial y un endpoint de salud, sin funcionalidades de gimnasio. GYM-002 añade
PostgreSQL local y Prisma ORM 7 al backend. GYM-003 incorpora el primer modelo,
User. GYM-004 añade autenticación mediante Argon2id y JWT de acceso; GYM-005
incorpora sesiones persistentes y refresh tokens rotatorios en cookies HttpOnly.
No hay interfaz de autenticación en el frontend.
GYM-006 añade el perfil privado del usuario autenticado, sin medidas corporales.
GYM-007 incorpora un catálogo global de ejercicios de solo lectura.
GYM-008 añade plantillas privadas de entrenamiento planificado.
GYM-009 permite iniciar sesiones de entrenamiento con un snapshot histórico.
GYM-010 añade el registro de series realizadas sin modificar esa planificación.
GYM-011 expone consultas privadas de histórico de entrenamientos y ejercicios,
sin métricas derivadas ni tablas nuevas.

## Arquitectura

```text
gym-app/                 # Raíz del repositorio (la carpeta actual GYM)
├── apps/
│   ├── web/             # Frontend Next.js, App Router y Tailwind CSS
│   └── api/             # Backend NestJS
├── packages/
│   ├── types/           # Tipos compartidos (sin tipos de dominio todavía)
│   └── config/          # Configuración compartida de TypeScript y ESLint
├── docs/                # Documentación técnica
├── AGENTS.md            # Reglas de contribución y calidad
├── pnpm-workspace.yaml
├── pnpm-lock.yaml       # Único lockfile del monorepo
└── turbo.json           # Orquestación de tareas
```

Todos los paquetes utilizan TypeScript estricto. pnpm enlaza los paquetes del
workspace y Turborepo coordina las tareas y su caché local.
Consulta las [decisiones de arquitectura](docs/architecture.md).

## Requisitos

- Node.js 24, versión 24.14.0 o superior dentro de la rama 24
  (`.node-version` fija la versión de referencia).
- pnpm 10.33.0, declarado en `packageManager`.
- Git.
- Docker con Docker Compose (en Windows, Docker Desktop con el motor Linux iniciado).

Si no tienes pnpm, puedes instalar la versión del proyecto con:

```sh
npm install --global pnpm@10.33.0
```

En Windows, si PowerShell bloquea los lanzadores `.ps1`, utiliza `npm.cmd` y
`pnpm.cmd` en lugar de `npm` y `pnpm`, o ejecuta los comandos en CMD.

## Instalación

Desde la raíz del repositorio:

```sh
pnpm install
```

Para una instalación que no modifique el lockfile:

```sh
pnpm install --frozen-lockfile
```

La API utiliza PostgreSQL local mediante Docker; prepara el entorno siguiendo
la sección de base de datos que aparece a continuación.
Las plantillas documentan las variables disponibles:

| Archivo                 | Variable                     | Valor por defecto                                           |
| ----------------------- | ---------------------------- | ----------------------------------------------------------- |
| `apps/api/.env.example` | `PORT`                       | `3001`                                                      |
| `apps/api/.env.example` | `DATABASE_URL`               | URL PostgreSQL local de la plantilla                        |
| `apps/api/.env.example` | `JWT_ACCESS_SECRET`          | Obligatorio, sin valor por defecto                          |
| `apps/api/.env.example` | `JWT_ACCESS_TTL`             | `15m` (900 segundos)                                        |
| `apps/api/.env.example` | `AUTH_REFRESH_TTL_DAYS`      | `30`, expiración absoluta (1–365 días)                      |
| `apps/api/.env.example` | `AUTH_REFRESH_COOKIE_NAME`   | `gym_refresh_token`                                         |
| `apps/api/.env.example` | `AUTH_REFRESH_COOKIE_SECURE` | `false` explícito en la plantilla local; `true` si se omite |
| `apps/api/.env.example` | `FRONTEND_ORIGIN`            | Obligatorio: `http://localhost:3000` en local               |
| `apps/web/.env.example` | `NEXT_PUBLIC_API_URL`        | `http://localhost:3001`                                     |

Para personalizarlas, copia manualmente cada `.env.example` a `.env` en su
misma carpeta. La API carga su `.env` mediante Nest Config y valida el puerto
y la configuración JWT al arrancar; Next.js
carga sus variables de entorno de forma nativa. Las variables ya presentes
en el proceso tienen prioridad. La página inicial todavía no consume la API;
`NEXT_PUBLIC_API_URL` queda documentada para los próximos tickets. Las variables
con prefijo `NEXT_PUBLIC_` son públicas y nunca deben contener secretos.

## Base de datos local (GYM-002)

1. Instala las dependencias con `pnpm install`.
2. Inicia PostgreSQL con `pnpm db:up`. El comando espera al healthcheck;
   `docker compose ps` debe mostrar el servicio `postgres` como `healthy`.
3. Si no existe `apps/api/.env`, copia `apps/api/.env.example` a ese archivo.
   La URL contiene únicamente las credenciales de desarrollo local de este Compose.
   Configura también `JWT_ACCESS_SECRET` y las variables de Auth de la plantilla.
   No sobrescribas un `.env` existente; estos archivos permanecen ignorados por Git.
4. Genera el cliente con `pnpm db:generate`.
5. Ejecuta `pnpm db:deploy` para aplicar las migraciones versionadas, incluidas
   `create_users` y `create_sessions`; comprueba después `pnpm db:status`. Repite este paso al recibir
   nuevas migraciones del repositorio.
6. Ejecuta `pnpm dev` para arrancar frontend y backend fuera de Docker.
7. Detén PostgreSQL con `pnpm db:down`. El volumen persistente se conserva.

Compose contiene exclusivamente `postgres:18`, expone `5432:5432`, utiliza
la base `gym_app` y monta un volumen nombrado en `/var/lib/postgresql`, la ruta
de datos de la [imagen oficial de PostgreSQL 18](https://hub.docker.com/_/postgres).
`gym_local_password` es una contraseña pública de desarrollo, nunca de producción.
El puerto 5432 debe estar disponible para Docker: otra instalación local de
PostgreSQL puede interceptar las conexiones aunque el contenedor figure `healthy`.

Los siguientes comandos se ejecutan desde la raíz; los de Prisma delegan en `@gym/api`:

| Comando                                     | Uso                                           |
| ------------------------------------------- | --------------------------------------------- |
| `pnpm db:up`                                | Iniciar PostgreSQL y esperar a que esté listo |
| `pnpm db:down`                              | Detener Compose sin borrar el volumen         |
| `pnpm db:logs`                              | Seguir los logs de PostgreSQL                 |
| `pnpm db:generate`                          | Generar Prisma Client, también sin modelos    |
| `pnpm db:migrate --name nombre_descriptivo` | Crear y aplicar una migración de desarrollo   |
| `pnpm db:deploy`                            | Aplicar las migraciones ya versionadas        |
| `pnpm db:status`                            | Consultar el estado de las migraciones        |
| `pnpm db:studio`                            | Abrir Prisma Studio para la base local        |

El schema está en `apps/api/prisma/schema.prisma` y `DATABASE_URL` se configura
en `apps/api/prisma.config.ts`, siguiendo Prisma 7. El cliente se genera en
`apps/api/src/generated/prisma` y no se versiona. Turborepo lo genera antes de
las tareas de la API; lint, typecheck, tests y build no necesitan PostgreSQL.

La primera migración real, `create_users`, pertenece a GYM-003. Las migraciones
están en `apps/api/prisma/migrations` y se versionan: nunca modificar una ya aplicada
ni sustituirlas por `db push`. Después de cambiar el schema o aplicar migraciones,
ejecuta `pnpm db:generate` y reinicia la API.

`GET /health` conserva su respuesta estática: no hace consultas a PostgreSQL
ni informa del estado de la base de datos.

## Desarrollo

```sh
pnpm dev
```

Ejecuta ambos servidores simultáneamente y recarga los cambios:

- Frontend: <http://localhost:3000>.
- Backend: <http://localhost:3001>.
- Salud de la API: `GET http://localhost:3001/health` devuelve
  `{"status":"ok"}` con HTTP 200.

Para detener ambos servidores, pulsa `Ctrl+C` en esa terminal.

### Auth en desarrollo (GYM-004 / GYM-005)

Antes de arrancar la API, define `JWT_ACCESS_SECRET` en `apps/api/.env` o en el
entorno del proceso. Utiliza un valor aleatorio criptográficamente seguro,
por ejemplo 32 bytes aleatorios codificados en hexadecimal (64 caracteres),
generado con un gestor de secretos. La API exige al menos 32 bytes y rechaza
valores vacíos; no existe un secreto de respaldo. Nunca lo añadas a Git ni a logs.

`JWT_ACCESS_TTL=15m` establece la duración del access token, con un máximo de
900 segundos. Puedes acortarlo indicando segundos positivos o minutos (`s`, `m`).

- `POST /auth/register`: acepta `email` y `password`; devuelve HTTP 201 con
  `accessToken`, `tokenType: "Bearer"`, `expiresIn` en segundos y `user` público.
  Crea una sesión y establece la refresh cookie HttpOnly.
- `POST /auth/login`: acepta los mismos campos y devuelve HTTP 200 con la misma
  estructura y una nueva sesión/cookie. Credenciales incorrectas devuelven HTTP 401 con `Invalid credentials`.
- `GET /auth/me`: requiere `Authorization: Bearer <accessToken>` y devuelve
  únicamente `id`, `email`, `createdAt` y `updatedAt` del usuario actual.

Ambos DTOs exigen passwords de 15 a 128 caracteres, admiten espacios y Unicode
y no recortan el password. Los campos extra se rechazan con HTTP 400; un email
duplicado en registro devuelve HTTP 409.

Configura `FRONTEND_ORIGIN` con un origen HTTP(S) exacto, sin ruta ni slash final,
y `AUTH_REFRESH_COOKIE_SECURE=false` explícitamente para desarrollo HTTP local.
En producción (`NODE_ENV=production`) la API rechaza `Secure=false`. La cookie
usa `HttpOnly`, `SameSite=Lax`, `Path=/auth`, sin Domain, y su Max-Age refleja
el tiempo restante de la sesión, no un nuevo plazo de 30 días en cada rotación.

- `POST /auth/refresh`: sin body obligatorio; utiliza exclusivamente la cookie,
  rota el refresh token y devuelve HTTP 200 con el nuevo access token y PublicUser.
  El refresh token nunca aparece en JSON. Tokens inválidos devuelven HTTP 401
  genérico y limpian la cookie. Reutilizar un token anterior revoca toda esa sesión.
- `POST /auth/logout`: revoca la sesión cuya cookie es válida y limpia la cookie;
  devuelve HTTP 204 incluso si no había cookie. No elimina registros.
- `POST /auth/logout-all`: requiere Bearer access token, revoca las sesiones
  activas de ese usuario y limpia la cookie; devuelve HTTP 204.

Todos estos POST, incluidos register/login, requieren `Origin` exactamente igual
a `FRONTEND_ORIGIN`; si falta o difiere, se responde HTTP 403. Los clientes de
terminal/pruebas también deben enviarlo. CORS permite ese origen con credentials,
nunca `*`. En el navegador utiliza `credentials: 'include'` en los requests Auth
para recibir/enviar la cookie. No almacenes refresh tokens en localStorage.
Serializa los refresh: dos renovaciones concurrentes con la misma credencial
activan la política estricta de replay y exigen volver a hacer login.

Logout, logout-all y la revocación por replay no invalidan inmediatamente los
access tokens emitidos: pueden seguir siendo válidos hasta su expiración, como
máximo 15 minutos. Las sesiones expiran de forma absoluta a los 30 días por
defecto; la rotación no amplía esa fecha. No hay cleanup automático de sesiones.

### Profile (GYM-006)

Las tres rutas requieren `Authorization: Bearer <accessToken>` y operan únicamente
sobre el usuario autenticado. No aceptan `userId`, parámetros de query ni rutas
para consultar a otros usuarios. No cambian las cookies ni las sesiones de Auth.

- `POST /profile`: crea el perfil (201); `displayName` es obligatorio y se recorta
  por fuera, conservando mayúsculas y espacios interiores (1–80 caracteres).
  Si ya existe, devuelve 409, sin sobrescribirlo.
- `GET /profile`: devuelve el perfil (200), o 404 si no existe; nunca lo crea.
- `PATCH /profile`: actualiza parcialmente (200), o 404 si no existe. Un body
  vacío o propiedades desconocidas devuelven 400.

Campos opcionales: `birthDate` (fecha real `YYYY-MM-DD`, no futura), `heightCm`
(entero entre 50 y 300), `experienceLevel` (`BEGINNER`, `INTERMEDIATE`, `ADVANCED`)
y `trainingGoal` (`GENERAL_FITNESS`, `MUSCLE_GAIN`, `STRENGTH`, `ENDURANCE`). Se
devuelven como `null` cuando faltan; en PATCH, omitir conserva y `null` limpia.
`unitSystem` admite `METRIC` (por defecto) o `IMPERIAL`, nunca `null`; `displayName`
tampoco admite `null`. La altura siempre se persiste en centímetros, y birthDate
se devuelve como fecha sin hora. La respuesta incluye `createdAt` y `updatedAt`,
pero no userId, datos de autenticación ni relaciones internas.

Aplica `pnpm db:deploy` y `pnpm db:generate` al incorporar esta migración. No hay
variables de entorno ni dependencias nuevas. El peso y las medidas corporales
se reservarán para BodyMeasurement; no forman parte de Profile.

### Catálogo de ejercicios (GYM-007)

Tras `pnpm db:deploy` y `pnpm db:generate`, ejecuta desde la raíz:

```sh
pnpm db:seed
```

El seed versionado en `apps/api/prisma/` contiene 24 ejercicios. Usa upsert por
slug: crea los ausentes y actualiza los metadatos canónicos, conservando UUID y
createdAt. Repetirlo no duplica ni borra ejercicios ajenos al seed. Los slugs
deben mantenerse estables; las futuras referencias usarán `Exercise.id`. El seed
se compila con el TypeScript existente y no requiere arrancar la API ni nuevas
variables o dependencias. No se ejecuta automáticamente al migrar.

Ambas rutas requieren `Authorization: Bearer <accessToken>` y muestran únicamente
ejercicios activos; no aceptan userId ni permiten crear, editar o borrar ejercicios:

- `GET /exercises`: admite `q`, `primaryMuscle`, `equipment`, `movementPattern`,
  `page` y `limit`. Los filtros son combinables y los enums usan los valores en
  mayúsculas del schema. `q` se recorta por fuera (1–100 caracteres si se envía)
  y busca texto literal sin distinguir mayúsculas en nombre y slug.
- `GET /exercises/:id`: devuelve un ejercicio activo por UUID; inexistente o
  inactivo devuelve 404, UUID mal formado devuelve 400. No admite query params.

El listado devuelve `{ items, page, limit, total, totalPages }`, ordenado por
`name asc, id asc`. Por defecto usa `page=1` y `limit=20` (máximo 100). La
paginación acepta enteros decimales positivos, no exponentes, fracciones, signos
ni parámetros repetidos. Los offsets fuera del rango soportado se rechazan con 400. Las páginas sin resultados devuelven `items: []`; un filtro sin coincidencias
devuelve `totalPages: 0`. Propiedades query desconocidas también devuelven 400.

Ejemplo: `/exercises?primaryMuscle=CHEST&equipment=DUMBBELL&page=1&limit=10`.
La respuesta pública no incluye isActive ni timestamps internos. Los índices
cubren el listado activo ordenado y los tres filtros; no hay búsqueda full-text
ni índice booleano aislado. Los tests normales usan persistencia en memoria y
validan también la integridad e idempotencia del seed, sin borrar el catálogo.

### Plantillas de entrenamiento (GYM-008)

Aplica `pnpm db:deploy` y `pnpm db:generate`; `pnpm db:seed` prepara el catálogo
utilizado por las plantillas. No hay dependencias ni variables nuevas.
Todas las rutas requieren Bearer access token y usan exclusivamente su principal:
recursos inexistentes, ajenos o archivados devuelven el mismo 404.

- `POST /workout-templates`: crea una plantilla vacía (201) con `name` recortado
  (1–120 caracteres) y `description` opcional (máximo 1000).
- `GET /workout-templates`: lista solo las propias y activas; admite `q`
  (nombre literal, sin distinguir mayúsculas, 1–100 caracteres), `page=1` y
  `limit=20` (máximo 100). Devuelve `{ items, page, limit, total, totalPages }`,
  ordenado por `updatedAt desc, id asc`. Cada item tiene la misma estructura
  que el detalle, con ejercicios resumidos y ordenados por `position`.
- `GET /workout-templates/:id`: devuelve la plantilla con sus entradas.
- `PATCH /workout-templates/:id`: modifica solo `name` y `description` (200).
- `DELETE /workout-templates/:id`: archiva (204), sin borrado físico ni restore.
- `POST /workout-templates/:id/exercises`: añade al final (201) un `exerciseId`
  activo, `targetSets` (1–20), `targetRepsMin` y `targetRepsMax` (1–100,
  mínimo ≤ máximo), `restSeconds` opcional (0–1800, default 90) y `notes`
  opcional (máximo 500). Un ejercicio repetido devuelve 409.
- `PATCH /workout-templates/:id/exercises/:templateExerciseId`: modifica solo
  objetivos, descanso y notas (200); no cambia ejercicio ni posición.
- `DELETE /workout-templates/:id/exercises/:templateExerciseId`: elimina la
  entrada (204) y compacta las posiciones de forma atómica.
- `PUT /workout-templates/:id/exercises/order`: recibe
  `{ "templateExerciseIds": ["UUID-C", "UUID-A", "UUID-B"] }` con exactamente
  todas las entradas actuales, sin duplicados; devuelve la plantilla (200).
  Una lista inválida devuelve 400 sin cambios parciales.

En PATCH, omitir `description`/`notes` conserva el valor y `null` lo limpia.
Los PATCH vacíos, propiedades desconocidas y UUIDs inválidos devuelven 400.
Solo el listado admite query params. No se acepta `userId` ni una posición
arbitraria del cliente. Las respuestas no incluyen ownership ni estado de archivo;
el resumen del ejercicio incluye `isAvailable`. Si el catálogo lo desactiva,
la entrada existente permanece visible con `isAvailable: false`.

Las escrituras y el orden usan transacciones serializables con hasta dos
reintentos por conflictos transitorios; agotados estos, devuelven 409 para
reintentar la petición. Cambiar entradas actualiza `updatedAt` de la plantilla.
Estas plantillas no registran sesiones realizadas, pesos, repeticiones reales
ni históricos. Auth, sus cookies y sesiones no cambian.

### Sesiones de entrenamiento (GYM-009)

Después de aplicar `pnpm db:deploy` y `pnpm db:generate`, las siguientes rutas
requieren Bearer access token. No hay nuevas dependencias ni variables de entorno.

- `POST /workout-sessions`: recibe únicamente `{ "workoutTemplateId": "UUID" }`.
  Crea una sesión `IN_PROGRESS` (201) desde una plantilla propia y activa.
  Una plantilla vacía devuelve 409; inexistente, ajena o archivada devuelve 404.
- `GET /workout-sessions`: admite `status` (`IN_PROGRESS`, `COMPLETED`,
  `CANCELLED`), `page=1` y `limit=20` (1–100). Devuelve
  `{ items, page, limit, total, totalPages }`, solo del usuario autenticado,
  ordenado por `startedAt desc, id desc`. Los items son resúmenes con `id`,
  `name`, `status`, `notes`, `startedAt` y `endedAt`, sin cargar ejercicios.
- `GET /workout-sessions/:id`: devuelve esos campos y `exercises` ordenados
  por posición, con metadata histórica y objetivos `planned*`. Inexistente o
  ajena devuelve 404. No se expone userId ni se consulta el catálogo al leerla.
- `POST /workout-sessions/:id/complete`: pasa de `IN_PROGRESS` a `COMPLETED`
  y establece `endedAt` (200).
- `POST /workout-sessions/:id/cancel`: pasa de `IN_PROGRESS` a `CANCELLED`
  y establece `endedAt` (200).

Complete/cancel no reciben campos de body (puede omitirse o enviarse `{}`).
Una sesión finalizada devuelve 409; ante complete/cancel concurrentes solo uno
gana. Se permiten varias sesiones IN_PROGRESS por usuario. No hay reapertura.
UUIDs inválidos, propiedades extra y queries no soportadas devuelven 400;
solo el listado acepta query params y no se convierten números arbitrarios.

El inicio copia nombre, orden, metadata de Exercise y planificación en una
transacción con una vista consistente. Renombrar, reordenar, editar o archivar
la plantilla, o cambiar el catálogo, no modifica el histórico. Los ejercicios
inactivos ya vinculados se incluyen; no se está añadiendo un ejercicio nuevo.
Las referencias de origen son opcionales (`ON DELETE SET NULL`), no propietarios
del histórico. `sourceExerciseId` es solo metadata de procedencia y puede ser null;
nombre, slug y demás datos se leen siempre del snapshot. No se expone sourceTemplateId.

Las notas de sesión comienzan en null y no se editan en este ticket. El snapshot
no tiene endpoints de edición. Auth y sus sesiones de refresh no cambian.

### Registro de series (GYM-010)

Aplica `pnpm db:deploy` y `pnpm db:generate`. No hay dependencias ni variables
nuevas. Las siguientes rutas requieren Bearer access token y verifican la cadena
usuario → sesión → ejercicio de sesión → serie; recursos ajenos devuelven 404.

- `POST /workout-sessions/:sessionId/exercises/:sessionExerciseId/sets`: registra
  una serie realizada (201). Recibe `loadKg` y `reps`, y opcionalmente `rpe`/`rir`.
  El servidor asigna posición al final y `completedAt`; no admite IDs ni timestamps
  en el body.
- `PATCH /workout-sessions/:sessionId/exercises/:sessionExerciseId/sets/:setId`:
  corrige solo esos cuatro valores (200), sin cambiar posición ni `completedAt`.
  Omitir `rpe`/`rir` conserva el valor; `null` lo limpia. Un PATCH vacío devuelve 400.
- `DELETE /workout-sessions/:sessionId/exercises/:sessionExerciseId/sets/:setId`:
  elimina la serie (204) y compacta posiciones atómicamente desde 1.
- `GET /workout-sessions/:id` incluye `sets` ordenados por posición en cada
  ejercicio, junto a los objetivos `planned*` intactos. El listado sigue resumido.

`loadKg` es un número entre 0 y 10000 con máximo dos decimales, persistido como
`Decimal(8,2)` en kilogramos y devuelto como número JSON. `reps` es entero 1–1000;
`rpe` admite 1–10 en pasos de 0,5 y `rir` enteros 0–10. Ambos pueden coexistir o
ser null. No se convierten strings a números; campos extra y valores inválidos
devuelven 400. No se admiten queries en estas rutas.

Solo se escriben series mientras la sesión está `IN_PROGRESS`. Complete/cancel
y las escrituras de series se coordinan transaccionalmente sobre la misma sesión:
cuando termina, crear, corregir o borrar devuelve 409. Cancelar conserva las series.
Completar permite cero series o una cantidad distinta a `plannedSets`. No hay
analítica ni edición del snapshot; SetEntry guarda únicamente datos realizados.

Para repetir las pruebas reales de Decimal, CHECKs, concurrencia complete/add,
rollback y cascades, con PostgreSQL healthy, `.env`, migraciones y seed preparados:
`pnpm --filter @gym/api test:postgres`. Crean un usuario temporal y eliminan solo
sus recursos al terminar, sin modificar el catálogo. Son opt-in: `pnpm test`
sigue siendo independiente de Docker.

### Histórico de entrenamientos y ejercicios (GYM-011)

Las tres rutas son de solo lectura y requieren Bearer access token. No aceptan
identidad en body/query: todas las consultas usan el principal autenticado.

- `GET /history/workouts`: lista sesiones `COMPLETED` y `CANCELLED`, nunca
  `IN_PROGRESS`. Admite `status` (uno de los dos estados históricos), `q`, `from`,
  `to`, `page` y `limit`. Devuelve resúmenes con `id`, `name`, `status`, `startedAt`,
  `endedAt`, `exerciseCount` y `setCount`, sin cargar sets completos.
- `GET /history/workouts/:id`: devuelve un histórico propio terminado con notas,
  ejercicios snapshot y sets ordenados por posición. Inexistente, ajeno o todavía
  en progreso devuelve el mismo 404. No admite query params.
- `GET /history/exercises/:exerciseId`: devuelve ocurrencias históricas de ese
  UUID, con nombre de sesión, metadata snapshot, planificación y sets. Admite
  `status`, `from`, `to`, `page` y `limit`, pero no `q`. Por defecto incluye solo
  `COMPLETED`; `status=CANCELLED` consulta las canceladas. Un UUID válido sin
  coincidencias devuelve 200 con `items: []`, `total: 0` y `totalPages: 0`.

Ambos listados devuelven `{ items, page, limit, total, totalPages }`, ordenados por
`startedAt desc, session id desc`. `page=1` y `limit=20` por defecto; límite máximo 100. `?limit=1` en ejercicio obtiene la ocurrencia completada más reciente.
Una ocurrencia terminada puede conservar `sets: []`; no se inventa rendimiento
para cumplir `plannedSets`. Las series de sesiones canceladas siguen visibles.

`q` busca texto literal en el nombre snapshot, sin distinguir mayúsculas,
recortando espacios exteriores (1–100 caracteres). `from` y `to` filtran
`startedAt` inclusivamente, no `endedAt`. Se exigen fechas reales RFC3339 con
zona explícita (`Z` o `±HH:MM`), segundos y hasta tres decimales de segundo,
coherentes con la precisión de la base. El instante UTC debe permanecer entre los
años 0001 y 9999. Ejemplo:
`from=2026-09-01T00:00:00Z`. Usa `URLSearchParams` para codificar offsets con `+`.
Un rango invertido, UUID inválido, query desconocida o paginación no válida
devuelve 400; no hay interpretación de días locales.

Nombre, metadata y objetivos provienen exclusivamente de snapshots. Cambiar o
archivar una plantilla, o desactivar/renombrar el Exercise, no altera respuestas
históricas. Un `sourceExerciseId: null` sigue permitiendo leer el detalle; no se
reconstruye la identidad por slug para búsquedas por ejercicio. Las cargas y RPE
se devuelven como números JSON mediante la conversión Decimal existente.

No hay migración: se reutilizan los índices existentes. No cambia la API operativa
`/workout-sessions`. `pnpm --filter @gym/api test:postgres` incluye el flujo HTTP
histórico con dos usuarios, restauración del catálogo y limpieza de sus recursos
temporales. Las suites PostgreSQL se ejecutan en secuencia para evitar que una
prueba de cambios temporales del catálogo interfiera con otra.

### Analytics de progreso (GYM-012)

Rutas read-only con Bearer access token, siempre limitadas al usuario autenticado
y a sesiones `COMPLETED`. No aceptan `status` ni `userId`; `CANCELLED` e
`IN_PROGRESS` quedan excluidas aunque contengan sets. History sigue permitiendo
consultar los datos de sesiones canceladas.

- `GET /analytics/overview?from=...&to=...`: devuelve `completedWorkouts`,
  `completedSets`, `totalReps` y `totalVolumeKg`. Cuenta también entrenamientos
  completados sin sets.
- `GET /analytics/exercises/:exerciseId?from=...&to=...&page=1&limit=20`:
  devuelve metadata histórica, `summary`, `heaviestSet`, `bestEstimated1RMSet`,
  `performances`, `page`, `limit`, `total` y `totalPages`. `summary` contiene
  `sessions` (ocurrencias), `sets`, `reps`, `totalVolumeKg`, `maxLoadKg` y
  `maxEstimated1RMKg`. El resumen y los candidatos cubren todo el rango,
  **no solamente la página actual**. Se pagina por ocurrencia, nunca por set.

Sin fechas se consulta todo el histórico, sin periodo implícito. `from`/`to`
filtran `WorkoutSession.startedAt` inclusivamente con las mismas reglas RFC3339
de History (zona explícita, fechas reales, hasta milisegundos, `from <= to`).
`page >= 1`, `limit` entre 1 y 100; valores por defecto 1 y 20. UUID, rango,
paginación o query desconocida inválidos devuelven 400; sin autenticación, 401.

Las actuaciones se ordenan por `startedAt DESC, sessionId DESC`, con sets por
`position ASC`. Cada actuación conserva su metadata snapshot e incluye conteos,
volumen, máximos y sets con e1RM derivado. El objeto superior `exercise` utiliza
el snapshot COMPLETED más reciente **dentro del rango**, independientemente de
la página. Nunca se consulta el catálogo mutable ni se reconstruye identidad
por slug si `sourceExerciseId` es null.

Un UUID sin ocurrencias devuelve 200 con resumen cero, `exercise: null`, ambos
candidatos null y `performances: []`. Una ocurrencia sin sets sí cuenta en
`sessions` y conserva su snapshot. Sin observaciones, `maxLoadKg` es null; una
carga observada de 0 sí produce `maxLoadKg: 0`. Si ningún set es elegible para
Epley, `maxEstimated1RMKg` y `bestEstimated1RMSet` son null.

Fórmulas, sin persistir resultados:

- Volumen externo: `loadKg * reps`; suma exacta con NUMERIC/Decimal y números
  públicos redondeados a dos decimales. `80×8 + 80×8 + 82.25×7 = 1855.75`.
- Epley: `loadKg * (1 + reps / 30)`, solo si `loadKg > 0` y reps entre 1 y 20.
  `82.25×7` estima `101.44 kg`. Fuera de esas condiciones se devuelve null,
  no cero. Es una estimación, no una medición ni un evento de récord personal.
- Peso corporal con carga externa 0 produce volumen externo 0: no significa
  ausencia de esfuerzo. No se estima masa corporal efectiva.

`heaviestSet` desempata por carga, reps, completedAt e id, todos descendentes.
`bestEstimated1RMSet` compara primero Epley **sin redondear**, luego carga, reps,
completedAt e id descendentes. Ambos incluyen contexto de sesión y set, nunca
datos privados. La API devuelve números, no objetos Prisma Decimal.

No hay nuevas tablas, columnas, migraciones ni dependencias. Se reutilizan los
índices de usuario/fecha, usuario/estado, sourceExerciseId y ejercicio/posición.
El overview usa una agregación SQL parametrizada (1 SELECT). La consulta por
ejercicio usa un snapshot RepeatableRead: agregación global, candidatos acotados
(máximo uno por rep elegible), metadata y página con relaciones batched; se
verificaron 7 SELECTs, independientes del tamaño de página. Las fórmulas Epley
permanecen centralizadas en funciones puras; no se carga todo el histórico para
calcular máximos. `test:postgres` comprueba el flujo HTTP, precisión, ownership,
snapshots y consultas; restaura el catálogo y elimina solo sus datos temporales.

### Récords personales actuales (GYM-013)

`GET /records/exercises/:exerciseId` requiere Bearer access token y devuelve
`{ exercise, maxLoadRecord, estimated1RMRecord }` para el usuario autenticado.
Es una consulta all-time: no admite query params, rangos de fechas, paginación
ni campos de body. No hay endpoints de escritura. UUID o entrada inválida: 400;
sin autenticación: 401. UUID válido sin ocurrencias COMPLETED: 200 con los tres
campos null. Una ocurrencia sin sets elegibles puede aportar metadata y devolver
ambos récords null.

- `MAX_LOAD`: mayor carga externa **positiva**. Si vuelve a alcanzarse, conserva
  el primer set según `completedAt ASC, setId ASC`, independientemente de reps.
  Por ejemplo, 100×3 el día 1 mantiene el récord de carga frente a 100×5 el día 10.
- `ESTIMATED_1RM`: reutiliza exactamente Epley de Analytics, con carga positiva
  y 1–20 reps. Compara el valor matemático sin redondear y, en empate exacto,
  conserva el primer `completedAt`, seguido del menor setId. No aplica los
  desempates de Analytics que favorecen carga/reps/recencia. `82.25×7` devuelve
  `101.44 kg` tras redondear únicamente la representación pública.

Cada récord incluye `type`, `valueKg`, `achievedAt`, contexto snapshot de sesión
(`id`, `name`, `startedAt`) y el set (`id`, `position`, `loadKg`, `reps`, `rpe`,
`rir`, `completedAt`). `achievedAt` siempre es `SetEntry.completedAt`.
Solo cuentan sesiones COMPLETED propias: CANCELLED e IN_PROGRESS no contribuyen.
Carga 0 no genera ninguno de los dos récords; más de 20 reps todavía puede
generar MAX_LOAD, pero no e1RM. Valores públicos en kg como números JSON, nunca
objetos Prisma Decimal.

`exercise` contiene la metadata del snapshot COMPLETED más reciente (orden
`startedAt DESC, sessionId DESC`, posición como desempate), que puede ser más
reciente que el set que estableció el récord. No se consulta el catálogo actual:
desactivarlo o editarlo, o renombrar/archivar la plantilla, no cambia los récords.
Si `sourceExerciseId` es null no se reconstruye su identidad mediante slug.

No hay tablas, columnas, eventos, migraciones ni dependencias nuevas. Se
reutilizan los índices existentes. La lectura combina metadata, MAX_LOAD y
como máximo un candidato de carga máxima por rep count elegible (20 en total),
conservando la primera consecución dentro de cada grupo, en una transacción
RepeatableRead. Se verificaron 3 SELECTs tanto con historial como sin él; no se
materializa todo el historial ni se ejecutan consultas por sesión/set.
`test:postgres` verifica el flujo HTTP con dos usuarios,
desempates, snapshots, precisión y consultas acotadas; restaura el catálogo y
limpia únicamente los datos temporales.

## Mediciones corporales

Todas las rutas requieren Bearer access token y usan exclusivamente el usuario
autenticado: `POST /body-measurements`, `GET /body-measurements` y
`GET`, `PATCH`, `DELETE /body-measurements/:id`. DELETE elimina la observación
físicamente. Los recursos ajenos o inexistentes responden 404.

Se persisten observaciones históricas, no peso mutable en Profile: `weightKg`
en kg, `bodyFatPercent` en %, y `waistCm`, `chestCm`, `hipsCm` en cm. Son números
positivos de hasta dos decimales (máximos 1000, 100 y 500 respectivamente),
almacenados como NUMERIC y devueltos como números JSON. No se aceptan strings
numéricos ni unidades imperiales. Debe existir al menos una métrica no-null.

`measuredAt` es opcional en POST (por defecto ahora). Si se proporciona, exige
RFC3339 con timezone explícito y precisión máxima de milisegundos; solo admite
60 segundos de tolerancia futura por desfase de reloj. `notes` se recorta en los
extremos y admite hasta 1000 caracteres. PATCH distingue campos ausentes (sin
cambio) de null (limpia métricas o notas); `measuredAt: null` y PATCH vacío son
inválidos. La validación del estado resultante se ejecuta bajo bloqueo de fila
en una transacción y seis CHECKs protegen rangos y observaciones no vacías.

El listado admite `from`, `to` inclusivos sobre `measuredAt`, con las mismas
reglas de timezone y `from <= to`; sin rango devuelve todo el histórico.
`page=1` y `limit=20` por defecto, máximo 100 por página. Orden estable
`measuredAt DESC, id DESC`; respuesta `items`, `page`, `limit`, `total`,
`totalPages`. Se permiten varias observaciones con la misma fecha/hora.
Este CRUD no añade estadísticas ni cambios en Profile.

## Analytics corporales

Read-only, con Bearer access token y scope exclusivo del usuario autenticado:

- `GET /body-analytics/overview`: `latest`, `previous` y `change` por cada una de
  `weightKg`, `bodyFatPercent`, `waistCm`, `chestCm`, `hipsCm`. Cada métrica usa
  sus propias dos observaciones no-null más recientes, con desempate `id DESC`.
  Sin datos, los tres valores son null; con uno, previous/change son null.
  `change = latest - previous`, redondeado a dos decimales, sin juicios de valor.
- `GET /body-analytics/timeline?metric=weightKg`: requiere una de esas cinco
  métricas; devuelve `metric`, `unit`, `items` (`measurementId`, `measuredAt`,
  `value`), `page`, `limit`, `total`, `totalPages`. Solo incluye valores no-null.
  Orden **measuredAt ASC, id ASC**, a diferencia del listado operativo newest-first.
  `page=1`, `limit=50` por defecto, máximo 200; total abarca todo el rango.

Ambos aceptan `from`/`to` inclusivos sobre `measuredAt`, RFC3339 con timezone y
precisión máxima de milisegundos, `from <= to`. Sin rango son all-time;
previous nunca se busca fuera del rango. Se rechazan parámetros desconocidos.
Unidades canónicas: kg, percent, cm; Profile.unitSystem no altera estos datos.
Los NUMERIC se leen como decimales exactos y las diferencias se calculan en
centésimas enteras; la API devuelve números JSON, sin artefactos flotantes.

Sin tablas, migraciones ni dependencias nuevas: se reutiliza el índice
`BodyMeasurement(userId, measuredAt, id)`. Overview usa una única sentencia SQL
parametrizada con cinco lecturas limitadas a dos observaciones (máximo diez filas).
Timeline usa dos SELECTs (página y total) bajo RepeatableRead; la selección de
columna procede de una allowlist SQL interna. Estos conteos se verifican en
`test:postgres`, junto con métricas parciales, ownership, rangos, precisión y
lectura consistente ante correcciones concurrentes. No hay BMI, goals ni trends.

## Tendencias semanales de entrenamiento

`GET /training-trends/weekly` requiere Bearer access token y exactamente tres
parámetros: `from`, `to` (RFC3339 con timezone, precisión máxima de milisegundos)
y `timezone` (zona IANA, por ejemplo `Europe/Madrid`, `America/New_York`, `UTC`).
No acepta paginación, status ni otros filtros. Límites inclusivos sobre
`WorkoutSession.startedAt`, `from <= to`, máximo 730 días transcurridos de
24 horas. No hay periodo por defecto. Los offsets sueltos (`+02:00`, `GMT+2`)
no sustituyen una zona IANA; los aliases válidos se normalizan mediante Intl.

La respuesta incluye `timezone`, `from`/`to` normalizados a UTC (mismos instantes)
y `buckets`, ordenados por `weekStart ASC`. Cada bucket tiene `weekStart`,
`completedWorkouts`, `completedSets`, `totalReps`, `totalVolumeKg`. La semana empieza
el lunes a las 00:00 **en la zona solicitada**, con DST gestionado por PostgreSQL;
`weekStart` es una fecha local `YYYY-MM-DD`, no un timestamp UTC. El filtro se aplica
antes de agrupar: las semanas de los extremos pueden representar actividad parcial.

Solo cuentan sesiones COMPLETED propias; CANCELLED e IN_PROGRESS quedan excluidas.
Las semanas son sparse: sin workouts completados no se genera bucket. Un workout
sin series sí cuenta y puede producir un bucket con sets/reps/volumen cero. El
volumen externo es `loadKg * reps` (carga 0 aporta volumen 0, no ausencia de esfuerzo),
calculado con NUMERIC en PostgreSQL y presentado como número a dos decimales.

Una única consulta parametrizada con LEFT JOINs y COUNT DISTINCT evita N+1 y
contar varias veces un workout con varios ejercicios. Se verifican los límites
Madrid/UTC/Nueva York, invierno/verano, aislamiento, precisión y el plan real en
`test:postgres`. Se conservan las ocho migraciones e índices existentes; no se
persisten agregados ni se añaden dependencias o frontend.

### Tendencias semanales por ejercicio (GYM-017)

`GET /training-trends/exercises/:exerciseId/weekly` requiere Bearer access token,
UUID válido y las mismas queries obligatorias `from`, `to`, `timezone` del endpoint
global: timestamps con zona explícita, límites inclusivos sobre `startedAt`, rango
máximo de 730 días y timezone IANA. No acepta otras queries ni paginación.

Solo cuenta rendimiento propio COMPLETED con al menos un SetEntry para ese
`sourceExerciseId`. Una occurrence sin series no cuenta aquí, aunque el workout
sí cuente en las tendencias globales. Las semanas comienzan el lunes local,
`weekStart` es `YYYY-MM-DD`, se ordenan ASC y no se rellenan semanas vacías.

Devuelve `exercise`, `timezone`, límites normalizados a UTC y `buckets` con
`completedWorkouts` distintos, `completedSets`, `totalReps`, `totalVolumeKg`,
`maxLoadKg` y `maxEstimated1RMKg`. El volumen usa carga externa × reps; carga cero
es una observación válida para maxLoad, pero no para e1RM. Epley reutiliza
`analytics.math` (carga positiva y 1–20 reps); sin candidato elegible devuelve null.
Los números se presentan con precisión de dos decimales, sin persistir métricas.

La metadata procede del snapshot COMPLETED más reciente **dentro del rango y con
series**; desempata por session id DESC y posición/id del snapshot ASC. No consulta
el catálogo ni la plantilla actuales. Sin rendimiento devuelve 200 con
`exercise: null` y `buckets: []`; una referencia de origen null no se reconstruye
mediante slug. CANCELLED, IN_PROGRESS y otros usuarios quedan excluidos.

Tres SELECTs parametrizados en RepeatableRead obtienen agregados, como máximo
20 candidatos e1RM por semana y metadata. Las pruebas PostgreSQL verifican
precisión, aislamiento, fronteras timezone/DST, consistencia concurrente y plan
real. Se mantienen las ocho migraciones e índices existentes.

### Tendencias semanales por grupo muscular (GYM-018)

`GET /training-trends/muscle-groups/weekly` requiere Bearer access token y las
mismas queries obligatorias `from`, `to`, `timezone`: timestamps con zona explícita,
rango inclusivo sobre `WorkoutSession.startedAt`, máximo 730 días y timezone IANA.
No acepta `muscleGroup`, `status`, `userId`, paginación ni otras queries.

Cada serie real de una sesión propia COMPLETED se atribuye **exclusivamente al
primaryMuscle del snapshot**. Los secondaryMuscles no reciben sets, reps, volumen
ni workouts: no hay weighting ni doble conteo. Cambiar el catálogo o la plantilla
actual no cambia esa atribución histórica, incluso si sourceExerciseId es null.

Devuelve `timezone`, límites normalizados a UTC y `buckets`, cada uno con
`weekStart` y `muscleGroups`. Cada grupo contiene únicamente `muscleGroup`,
`completedWorkouts`, `completedSets`, `totalReps` y `totalVolumeKg`. Dos ejercicios
del mismo grupo en la misma sesión cuentan un workout, pero todas sus series.
Una occurrence sin series no contribuye; carga cero sí cuenta sets/reps/workout,
con volumen externo cero. No se incluyen CANCELLED ni IN_PROGRESS.

Las semanas comienzan el lunes en la timezone solicitada; `weekStart` es la fecha
local `YYYY-MM-DD`. Buckets ASC y grupos alfabéticos por valor enum ASCII
(BACK antes de CHEST), independientemente del orden del enum PostgreSQL.
La salida es sparse: no se fabrican semanas ni grupos sin actividad; sin datos
devuelve 200 con `buckets: []`.

Una única consulta parametrizada agrupa NUMERIC en PostgreSQL y usa
`COUNT(DISTINCT session.id)`. El servicio valida el enum y presenta volumen como
número redondeado a dos decimales. Las pruebas verifican el SELECT único, plan
real, snapshots, ownership, límite del lunes/DST, Decimal y rutas existentes.
No se persisten métricas ni se añaden índices, migraciones o dependencias.

### Comparación semanal (GYM-019)

`GET /training-trends/weekly-comparison?weekStart=2026-09-28&timezone=Europe/Madrid`
requiere Bearer access token y únicamente esos dos parámetros. `weekStart` es
una fecha real `YYYY-MM-DD` que debe ser lunes local, no un timestamp. La semana
anterior se deriva automáticamente restando siete días de calendario.

Devuelve `previous`, `current` y `changes` para workouts completados, series,
repeticiones y volumen externo en kg. Solo cuenta sesiones `COMPLETED` del
usuario según `startedAt`, incluidos workouts sin series. Ambos periodos se
devuelven siempre, con ceros si están vacíos; a diferencia de `/weekly`, esta
respuesta no es sparse. Se permiten semanas futuras.

Los límites son medianoches locales `[lunes, lunes siguiente)`, convertidas
individualmente con la timezone IANA: una semana DST puede durar 167 o 169 horas.
`delta = current - previous`; `percentageChange = delta / previous * 100`,
redondeado a dos decimales, y **null si previous es cero**, también en `0 → 0`.
Una caída desde un valor positivo a cero devuelve `-100`. No hay interpretación
de mejora/empeoramiento ni recomendaciones. La carga corporal no se estima.

Una consulta parametrizada agrega los dos periodos con NUMERIC; la comparación
usa aritmética fija exacta antes de convertir a números JSON. No persiste métricas,
no añade migración y reutiliza los índices existentes. El formato de fechas de
los dos periodos y sus límites requiere años entre 0001 y 9999.

## Consistencia y rachas semanales (GYM-020)

`GET /training-consistency/weekly` requiere Bearer access token y exactamente
`fromWeekStart`, `toWeekStart` y `timezone`. Las fechas son lunes locales reales
`YYYY-MM-DD`; la zona es IANA, por ejemplo `Europe/Madrid`. El rango incluye ambos
lunes como semanas completas y admite hasta **104 semanas**. No hay paginación,
periodo implícito ni restricción sobre semanas futuras.

La única fuente es `WorkoutSession` en estado `COMPLETED`, según `startedAt`.
Cuenta también workouts sin ejercicios/series; no consulta SetEntry. Dos workouts
el mismo día local cuentan como dos `completedWorkouts`, pero un solo `activeDay`.
`activeWeeks` cuenta semanas con actividad y `totalWeeks` incluye las vacías.

`longestWeeklyStreak` es la mayor secuencia de semanas activas consecutivas dentro
del rango. `endingWeeklyStreak` termina exactamente en `toWeekStart`: si esa
semana está vacía, vale cero. Ninguna racha se extiende fuera del rango. No existe
semántica de “racha actual”, periodo de gracia, racha diaria, score ni juicio de
calidad del entrenamiento.

Los límites son `[lunes inicial 00:00 local, lunes posterior al final 00:00 local)`.
PostgreSQL resuelve cada medianoche con IANA/DST; la aritmética de rachas usa solo
fechas de calendario, no diferencias entre instantes UTC. Sin actividad devuelve
los cinco indicadores de actividad/rachas a cero y conserva `totalWeeks`.

Una consulta agregada devuelve como máximo 104 semanas activas; no se persisten
rachas ni métricas, no se añaden tablas/índices y se mantienen ocho migraciones.

## Calidad y build

Ejecuta desde la raíz antes de cerrar cualquier ticket:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- `lint`: ESLint en todas las aplicaciones y paquetes, seguido de la
  comprobación de formato con Prettier.
- `typecheck`: comprueba TypeScript en los cuatro paquetes. En Next.js genera
  primero los tipos de rutas, por lo que también funciona antes del primer build.
- `test`: ejecuta las pruebas HTTP de la API con el runner nativo de Node.js.
  Comprueba `/health` y que la raíz de la API no exponga un endpoint adicional.
  Los tests HTTP sustituyen el proveedor Prisma, sin necesitar una base de datos;
  también se comprueba el rechazo de URLs de conexión inválidas y el dominio User
  mediante tests unitarios independientes de PostgreSQL.
  También cubre Auth, Argon2id, JWT, DTOs y endpoints HTTP con persistencia en
  memoria y secretos aleatorios exclusivos de cada prueba; no necesita un JWT
  secret de desarrollo ni Docker.
  El frontend estático y los paquetes sin lógica aún no tienen suites propias.
- `build`: compila los paquetes compartidos, el backend en `apps/api/dist` y
  el frontend en `apps/web/.next`.

Para aplicar el formato, ejecuta `pnpm format`; para comprobarlo de forma
independiente, ejecuta `pnpm format:check`.

Tras el build puedes arrancar cada aplicación en una terminal:

```sh
pnpm --filter @gym/api start
pnpm --filter @gym/web start
```

## Alcance actual

Docker se utiliza únicamente para PostgreSQL 18 y Prisma ORM 7 pertenece al
backend. La autenticación dispone de registro, login, consulta del usuario,
refresh y cierre de sesiones. No se han configurado Redis, shadcn/ui, TanStack Query,
Zustand ni servicios externos. Los modelos son User, Session, Profile, Exercise,
WorkoutTemplate, WorkoutTemplateExercise, WorkoutSession, WorkoutSessionExercise
y SetEntry, además de BodyMeasurement para observaciones corporales históricas.
Hay plantillas privadas, snapshots históricos, registro de series y
analytics y récords personales derivados de entrenamientos completados, sin
dashboard ni eventos de récords personales.
