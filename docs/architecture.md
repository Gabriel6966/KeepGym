# Arquitectura inicial — GYM-001

## Límites

| Ubicación         | Responsabilidad                                        |
| ----------------- | ------------------------------------------------------ |
| `apps/web`        | Frontend Next.js con App Router, `src/` y alias `@/*`  |
| `apps/api`        | Backend NestJS con el único endpoint `GET /health`     |
| `packages/types`  | Punto de entrada TypeScript para futuros tipos comunes |
| `packages/config` | Configuración compartida de TypeScript y ESLint        |

Las aplicaciones consumen `@gym/config` mediante `workspace:*`. Los puntos de
entrada TypeScript de ambos paquetes compartidos están vacíos deliberadamente;
no se han inventado tipos de dominio ni utilidades. La configuración compartida
se consume directamente desde sus archivos, sin necesitar un build previo.

## Herramientas y decisiones

- La carpeta actual es la raíz del monorepo `gym-app`; se conserva el repositorio
  Git existente y no se crean repositorios anidados.
- Node.js 24 y pnpm 10.33.0 quedan declarados como requisitos. Las dependencias
  directas tienen versiones exactas y las herramientas comunes se centralizan
  en el catálogo de pnpm. Un único lockfile fija la resolución completa.
- NestJS 11 y TypeScript 5.9.3 son compatibles con Node.js 24.14.0. NestJS 12
  requiere una versión de Node superior a través de sus herramientas de generación.
- ESLint 9 mantiene compatibilidad con los plugins actuales de Next.js. npm
  avisa de que esta rama ha terminado su soporte; actualizar a ESLint 10 requiere
  que `eslint-plugin-react`, `eslint-plugin-import` y `eslint-plugin-jsx-a11y`
  declaren compatibilidad. No se fuerzan sus peer dependencies.
- TypeScript estricto se hereda de `@gym/config/tsconfig.base.json`.
  ESLint prohíbe `any` explícito; la API además comprueba promesas sin gestionar.
- Next.js utiliza Tailwind CSS mediante PostCSS y fuentes del sistema, sin
  descargar fuentes externas durante el build. La página no consulta la API.
- NestJS utiliza su adaptador Express. El controlador de salud devuelve una
  respuesta constante; no necesita un service porque no contiene lógica de negocio.
- La API utiliza el puerto 3001 por defecto y admite `PORT` en el entorno o en
  su `.env` local. Node.js carga ese archivo sin añadir dependencias de configuración.
- Los tests compilan TypeScript con metadatos de decoradores y arrancan la API
  en un puerto efímero. El runner de Node.js comprueba las respuestas HTTP reales
  y cierra el servidor al terminar.
- Turborepo ejecuta desarrollo como tarea persistente sin caché. Los builds
  respetan las dependencias del workspace; los artefactos y la caché son locales
  y están excluidos de Git. Las variables relevantes forman parte de su configuración.
- pnpm permite explícitamente los scripts de instalación de los binarios de
  Tailwind, Sharp y el resolver de ESLint (`unrs-resolver`).

## Evolución posterior

La lógica de negocio se implementará en services y el acceso a datos se
abstraerá en repositories cuando lo requieran otros tickets. GYM-001 no define
entidades, persistencia, autenticación ni infraestructura externa.
