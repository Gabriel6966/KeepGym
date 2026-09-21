import { randomBytes } from 'node:crypto';
import type { EnvironmentConfig } from '../../src/config/environment.config';

export function testEnvironment(
  overrides: Partial<EnvironmentConfig> = {},
): EnvironmentConfig {
  return {
    port: 3001,
    jwtAccessSecret: randomBytes(32).toString('hex'),
    jwtAccessTtlSeconds: 900,
    authRefreshTtlDays: 30,
    authRefreshCookieName: 'gym_refresh_token',
    authRefreshCookieSecure: false,
    frontendOrigin: 'http://localhost:3000',
    ...overrides,
  };
}
