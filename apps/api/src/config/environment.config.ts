import { registerAs } from '@nestjs/config';

export interface EnvironmentConfig {
  port: number;
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
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

  if (!match || !Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error(
      'JWT_ACCESS_TTL must be positive seconds or a duration such as 15m.',
    );
  }

  return { port, jwtAccessSecret: secret, jwtAccessTtlSeconds: seconds };
}

export const environmentConfig = registerAs('environment', () =>
  validateEnvironment(process.env),
);
