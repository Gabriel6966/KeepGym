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
- AuthService utiliza UsersService; no accede directamente a repositories ni Prisma.

## Seguridad

- Nunca introducir secretos en el repositorio.
- Nunca loggear passwords, tokens o credenciales.
- Nunca almacenar passwords en claro: Auth los hashea con Argon2id.
- Los secretos JWT provienen del entorno, nunca del código fuente.
- `passwordHash` es interno: nunca incluir su valor en representaciones públicas,
  logs ni errores.
- Documentar variables de entorno en `.env.example` sin valores secretos.

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
