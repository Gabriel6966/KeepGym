# Gym App

Base de una aplicación para registrar entrenamientos y medir el progreso.
GYM-001 inicializa exclusivamente la arquitectura del monorepo: una página
inicial y un endpoint de salud, sin funcionalidades de gimnasio. GYM-002 añade
PostgreSQL local y Prisma ORM 7 al backend, todavía sin modelos de dominio.

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

| Archivo                 | Variable              | Valor por defecto                    |
| ----------------------- | --------------------- | ------------------------------------ |
| `apps/api/.env.example` | `PORT`                | `3001`                               |
| `apps/api/.env.example` | `DATABASE_URL`        | URL PostgreSQL local de la plantilla |
| `apps/web/.env.example` | `NEXT_PUBLIC_API_URL` | `http://localhost:3001`              |

Para personalizarlas, copia manualmente cada `.env.example` a `.env` en su
misma carpeta. La API carga su `.env` con Node.js y valida el puerto; Next.js
carga sus variables de entorno de forma nativa. Las variables ya presentes
en el proceso tienen prioridad. La página inicial todavía no consume la API;
`NEXT_PUBLIC_API_URL` queda documentada para los próximos tickets. Las variables
con prefijo `NEXT_PUBLIC_` son públicas y nunca deben contener secretos.

## Base de datos local (GYM-002)

1. Instala las dependencias con `pnpm install`.
2. Inicia PostgreSQL con `pnpm db:up`. El comando espera al healthcheck;
   `docker compose ps` debe mostrar el servicio `postgres` como `healthy`.
3. Si no existe `apps/api/.env`, copia `apps/api/.env.example` a ese archivo.
   Contiene únicamente las credenciales de desarrollo local de este Compose.
   No sobrescribas un `.env` existente; estos archivos permanecen ignorados por Git.
4. Genera el cliente con `pnpm db:generate`.
5. En una base recién creada, ejecuta `pnpm db:deploy` para inicializar el registro
   de Prisma Migrate; comprueba después `pnpm db:status`.
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

GYM-002 no introduce modelos ni una migración vacía. La primera migración real
se creará en GYM-003 al añadir el primer modelo. Las migraciones irán en
`apps/api/prisma/migrations` y se versionarán: nunca modificar una ya aplicada
ni sustituirlas por `db push`. Después de cambiar el schema o aplicar migraciones,
ejecuta `pnpm db:generate` y reinicia la API.

Sin modelos, `db:migrate` no genera una migración. La inicialización con
`db:deploy` crea únicamente la tabla interna `_prisma_migrations`, sin tablas de
dominio ni archivos de migración. Antes de esa inicialización, `db:status` puede
indicar que la base aún no está gestionada por Prisma Migrate y terminar con error.

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
  también se comprueba el rechazo de URLs de conexión inválidas.
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
backend. No se han configurado Redis, autenticación, shadcn/ui, TanStack Query,
Zustand ni servicios externos. Tampoco hay modelos de dominio, dashboard ni
lógica de gimnasio. Estos elementos pertenecen a tickets posteriores.
