# Gym App

Base de una aplicación para registrar entrenamientos y medir el progreso.
GYM-001 inicializa exclusivamente la arquitectura del monorepo: una página
inicial y un endpoint de salud, sin funcionalidades de gimnasio.

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

No se necesitan servicios externos ni archivos `.env` para arrancar.
Las plantillas documentan las variables disponibles:

| Archivo                 | Variable              | Valor por defecto       |
| ----------------------- | --------------------- | ----------------------- |
| `apps/api/.env.example` | `PORT`                | `3001`                  |
| `apps/web/.env.example` | `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

Para personalizarlas, copia manualmente cada `.env.example` a `.env` en su
misma carpeta. La API carga su `.env` con Node.js y valida el puerto; Next.js
carga sus variables de entorno de forma nativa. Las variables ya presentes
en el proceso tienen prioridad. La página inicial todavía no consume la API;
`NEXT_PUBLIC_API_URL` queda documentada para los próximos tickets. Las variables
con prefijo `NEXT_PUBLIC_` son públicas y nunca deben contener secretos.

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

No se han configurado PostgreSQL, Prisma, Redis, Docker, autenticación,
shadcn/ui, TanStack Query, Zustand ni servicios externos. Tampoco hay dashboard
ni lógica de gimnasio. Estos elementos pertenecen a tickets posteriores.
