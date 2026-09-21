import { registerAs } from '@nestjs/config';

export interface EnvironmentConfig {
  port: number;
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  authRefreshTtlDays: number;
  authRefreshCookieName: string;
  authRefreshCookieSecure: boolean;
  frontendOrigin: string;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentConfig {
  const port = Number(environment.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const secret = environment.JWT_ACCESS_SECRET;
  if (
    typeof secret !== 'string' ||
    !secret.trim() ||
    Buffer.byteLength(secret, 'utf8') < 32
  ) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 bytes.');
  }

  // Accept positive seconds or a duration with an explicit s/m/h/d unit.
  const ttl = environment.JWT_ACCESS_TTL ?? '15m';
  const match =
    typeof ttl === 'string' ? /^([1-9]\d*)(s|m|h|d)?$/.exec(ttl) : null;
  const multiplier: Readonly<Record<string, number>> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  const seconds = Number(match?.[1]) * (multiplier[match?.[2] ?? 's'] ?? NaN);

  if (
    !match ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > 900
  ) {
    throw new Error(
      'JWT_ACCESS_TTL must be between 1 and 900 seconds (for example 15m).',
    );
  }

  const refreshDays = environment.AUTH_REFRESH_TTL_DAYS ?? '30';
  if (
    typeof refreshDays !== 'string' ||
    !/^[1-9]\d{0,2}$/.test(refreshDays) ||
    Number(refreshDays) > 365
  ) {
    throw new Error(
      'AUTH_REFRESH_TTL_DAYS must be an integer between 1 and 365.',
    );
  }

  const cookieSecure = environment.AUTH_REFRESH_COOKIE_SECURE ?? 'true';
  if (cookieSecure !== 'true' && cookieSecure !== 'false') {
    throw new Error('AUTH_REFRESH_COOKIE_SECURE must be true or false.');
  }
  if (environment.NODE_ENV === 'production' && cookieSecure !== 'true') {
    throw new Error('AUTH_REFRESH_COOKIE_SECURE must be true in production.');
  }

  const cookieName =
    environment.AUTH_REFRESH_COOKIE_NAME ?? 'gym_refresh_token';
  if (
    typeof cookieName !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(cookieName) ||
    cookieName.startsWith('__Host-') ||
    (cookieName.startsWith('__Secure-') && cookieSecure !== 'true')
  ) {
    throw new Error(
      'AUTH_REFRESH_COOKIE_NAME must be a valid name compatible with the cookie options.',
    );
  }

  const origin = environment.FRONTEND_ORIGIN;
  let frontendUrl: URL;
  try {
    if (typeof origin !== 'string') throw new Error();
    frontendUrl = new URL(origin);
  } catch {
    throw new Error('FRONTEND_ORIGIN must be an exact HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(frontendUrl.protocol) ||
    frontendUrl.origin !== origin
  ) {
    throw new Error(
      'FRONTEND_ORIGIN must be an exact HTTP(S) origin without a path or credentials.',
    );
  }

  return {
    port,
    jwtAccessSecret: secret,
    jwtAccessTtlSeconds: seconds,
    authRefreshTtlDays: Number(refreshDays),
    authRefreshCookieName: cookieName,
    authRefreshCookieSecure: cookieSecure === 'true',
    frontendOrigin: origin,
  };
}

export const environmentConfig = registerAs('environment', () =>
  validateEnvironment(process.env),
);
