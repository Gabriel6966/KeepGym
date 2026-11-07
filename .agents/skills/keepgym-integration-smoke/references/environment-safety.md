# Seguridad del entorno de smoke

## Registrar antes de actuar

- Identifica workspace, rama y cambios previos. Registra Node/pnpm reales y requisitos
  de `engines`/`packageManager`; no instales runtimes ni debilites esos requisitos.
- Confirma el destino PostgreSQL esperado mediante la configuración y herramientas
  existentes sin imprimir connection strings, passwords, JWTs ni cookies.
- Registra qué procesos API/web ya están abiertos y quién los inició; conserva sus
  identificadores para distinguirlos de los procesos de esta ejecución.
- En Windows registra servicio PostgreSQL nativo, estado/startup, Docker Desktop,
  contexto Docker y contenedor PostgreSQL existente. No supongas estados de una
  sesión anterior.
- Registra recursos del navegador que abras o alteres y una ubicación de evidencia
  fuera del repositorio, sin secretos.

## Prerequisitos y conflicto de puerto

- Confirma que los comandos de smoke/suite existentes apuntan a un entorno seguro
  y que no resetean ni limpian una base ajena antes de ejecutarlos.
- Si 5432 está ocupado, inspecciona listener/PID, proceso/servicio propietario y
  mapeo del contenedor. No asumas que el propietario es PostgreSQL nativo.
- Si hay conflicto entre PostgreSQL nativo y Docker, reutiliza una autorización
  vigente para la transición concreta. Si falta, solicita autorización explicando
  la necesidad; no detengas servicios ni lances elevación por iniciativa propia.
- Usa únicamente un runtime compatible ya disponible y autorizado; limita cualquier
  selección al proceso actual. No codifiques rutas personales ni cambies PATH global.
- Si Docker no está disponible, informa BLOCKED. No cambies socket, ACL, configuración,
  contexto persistente o puertos, ni resetees Docker para forzar una ejecución.

## Fixtures y cleanup

- Usa datos desechables con identificador único por ejecución y guarda los IDs
  exactos de cada entidad creada. Aísla el fixture de cuentas y datos reales.
- Define cómo verificar y retirar sus dependencias antes de crear datos. Una
  coincidencia amplia por nombre/prefijo no basta como autorización de borrado.
- Usa el mecanismo de fixture existente cuando sea seguro; cualquier tooling nuevo
  o cambio de seed/catálogo compartido requiere alcance explícito.
- Ejecuta cleanup sobre esos IDs y comprueba cero filas temporales en las entidades
  implicadas. Un logout, una respuesta DELETE o borrar solo la cuenta no demuestra
  por sí mismo que todo el fixture haya desaparecido.

## Restauración y fallo

- No uses `migrate reset`, `db push`, `docker compose down -v`, borrado de volúmenes,
  cambios de `.env`/puertos/startup permanente ni borrado de datos reales.
- Detén únicamente servidores iniciados por esta ejecución. Restaura solo cambios
  autorizados de servicios, Docker Desktop y contenedores a sus estados registrados.
- Restaura recursos del navegador alterados y retira solo artefactos temporales
  propios; no cierres tabs ni borres perfiles del usuario.
- Compara explícitamente estado inicial/final de PostgreSQL nativo, Docker Desktop,
  contenedor PostgreSQL y API/web. Registra cualquier diferencia o restauración
  bloqueada y los pasos seguros pendientes, sin afirmar un éxito parcial como total.
