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
WorkoutTemplate y WorkoutTemplateExercise. Hay plantillas planificadas privadas,
pero no dashboard ni seguimiento de entrenamientos realizados.
