# Auth and Profile

## Invariants

- Los recursos privados obtienen ownership del principal validado del access
  token. El cliente nunca selecciona propietario mediante `userId`.
- Auth crea/autentica la cuenta; Profile es un recurso separado. Registro y
  login reciben `email` y `password`, no datos de Profile. Confirmar password es
  validación frontend, no un campo de la API.
- El access token permanece exclusivamente en memoria frontend. El backend
  administra el refresh token mediante cookie HttpOnly; no se devuelve en JSON.
- Passwords se hashean con Argon2id. Secretos JWT vienen del entorno;
  passwords, JWTs, cookies, hashes de sesión y `passwordHash` no se exponen en
  respuestas públicas, logs ni documentación.

## API / persistence semantics

- `POST /auth/register` devuelve 201; login y refresh devuelven 200 con access
  token y usuario público. Refresh sin cookie válida devuelve 401: no significa
  un fallo del formulario ni debe convertirse en éxito ficticio.
- El refresh token es opaco, rota y almacena solo SHA-256 de su secret. La
  rotación es condicional y conserva la expiración absoluta. Reutilización o una
  rotación concurrente perdedora revocan la sesión, también para el ganador.
- La cookie tiene `HttpOnly`, `SameSite=Lax` y path `/auth`; `Secure` es
  obligatorio en producción. Los POST de Auth validan Origin exacto. CORS admite
  el frontend configurado con credentials, nunca wildcard con credentials.
- El api-client comparte una rotación en curso. Una petición protegida sin
  token recupera sesión; un 401 permite como máximo un refresh/reintento. El
  propio refresh no se auto-refresca; si falla, el token en memoria se limpia.
  Errores de red/otras respuestas no justifican repetir escrituras ambiguas.
- `GET /profile` devuelve el Profile propio; `POST` crea uno (409 si ya existe)
  y `PATCH` modifica campos, sin crear un Profile ausente.
- `displayName` es obligatorio al crear y no admite null. `birthDate`,
  `heightCm`, `experienceLevel` y `trainingGoal` son opcionales/nullables.
  `unitSystem` es `METRIC` o `IMPERIAL`, no admite null y por defecto es `METRIC`.
- PATCH requiere al menos un campo: omitido conserva, null borra solo campos
  nullables. `birthDate` es una fecha real no futura `YYYY-MM-DD`, persistida como
  DATE y devuelta sin cambiar de día. `heightCm` sigue siendo cm, no pulgadas.

## Historical integrity

- Profile representa datos actuales relativamente estables, no peso corporal
  histórico ni mediciones. Esos datos pertenecen a [Body](body.md).
- Cambiar Profile o `unitSystem` no reescribe snapshots ni convierte unidades
  persistidas de entrenamientos o mediciones.

## Frontend obligations

- Solo un 404 cuyo cuerpo tenga `statusCode: 404` y mensaje exacto
  `Profile not found.` se interpreta como Profile ausente. Un 404 genérico,
  401/403/500 o error de red sigue siendo error, no permiso para onboarding.
- Login/Register comprueban sesión y Profile: ausencia explícita conduce a
  onboarding; Profile existente conduce al `returnTo` seguro o `/dashboard`.
  Reintentar una consulta no reenvía automáticamente login, registro o creación.
- `returnTo` se valida mediante la lista de destinos/rangos internos soportados;
  destinos externos o malformados caen en el destino seguro.
- Preservar DATE-only, campos omitidos/null y enums canónicos. `unitSystem` es una
  preferencia de presentación, no una conversión implícita del almacenamiento.

## Must not

- Persistir tokens en localStorage/sessionStorage, reconstruir la refresh cookie
  desde JavaScript o introducir otro cliente de autenticación.
- Convertir globalmente 401 en éxito o 404 en null; repetir una escritura de
  resultado incierto sin reconciliar el estado real.

## Evidence

- Auth y ownership: [AuthService](../../apps/api/src/auth/auth.service.ts),
  [AccessTokenGuard](../../apps/api/src/auth/guards/access-token.guard.ts),
  [tests HTTP](../../apps/api/test/auth.http.test.ts).
- Cookie, Origin y CORS: [cookie](../../apps/api/src/auth/refresh-cookie.service.ts),
  [OriginGuard](../../apps/api/src/auth/guards/origin.guard.ts),
  [configureHttp](../../apps/api/src/http/configure-http.ts).
- Rotación y hashes: [SessionsService](../../apps/api/src/sessions/sessions.service.ts),
  [RefreshTokenService](../../apps/api/src/sessions/refresh-token.service.ts),
  [tests de sesiones](../../apps/api/test/sessions.service.test.ts).
- Profile: [service](../../apps/api/src/profiles/profiles.service.ts),
  [DTOs](../../apps/api/src/profiles/dto/optional-profile-fields.dto.ts),
  [tests HTTP](../../apps/api/test/profiles.http.test.ts).
- Cliente y routing: [api-client](../../apps/web/src/lib/api-client.ts),
  [return paths](../../apps/web/src/features/auth/return-path.ts),
  [tests de recuperación/retry](../../apps/web/test/api-client.test.ts),
  [tests Profile/404](../../apps/web/test/profile-api-client.test.ts).
