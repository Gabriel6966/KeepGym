import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment.config';

void test('environment requires a nonempty secret of at least 32 bytes without disclosing it', () => {
  for (const secret of [undefined, '', ' '.repeat(32), 'short', 123]) {
    assert.throws(() => validateEnvironment({ JWT_ACCESS_SECRET: secret }), {
      message: 'JWT_ACCESS_SECRET must contain at least 32 bytes.',
    });
  }
});

void test('refresh configuration has a 30-day absolute lifetime and Secure cookies by default', () => {
  const config = validateEnvironment({
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    FRONTEND_ORIGIN: 'http://localhost:3000',
  });
  assert.equal(config.authRefreshTtlDays, 30);
  assert.equal(config.authRefreshCookieName, 'gym_refresh_token');
  assert.equal(config.authRefreshCookieSecure, true);
  assert.equal(config.frontendOrigin, 'http://localhost:3000');
});

void test('refresh environment rejects invalid lifetimes, cookie flags/names and non-exact origins', () => {
  const environment = {
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    FRONTEND_ORIGIN: 'http://localhost:3000',
  };
  for (const value of ['', '0', '-1', '1.5', '366', 'Infinity', 30]) {
    assert.throws(
      () =>
        validateEnvironment({ ...environment, AUTH_REFRESH_TTL_DAYS: value }),
      /AUTH_REFRESH_TTL_DAYS/,
    );
  }
  for (const value of ['', 'yes', '0', true]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...environment,
          AUTH_REFRESH_COOKIE_SECURE: value,
        }),
      /AUTH_REFRESH_COOKIE_SECURE/,
    );
  }
  for (const value of [
    '',
    'bad name',
    'bad;name',
    'bad\r\nname',
    '__Host-refresh',
    'a'.repeat(65),
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...environment,
          AUTH_REFRESH_COOKIE_NAME: value,
        }),
      /AUTH_REFRESH_COOKIE_NAME/,
    );
  }
  for (const value of [
    undefined,
    '',
    '*',
    'null',
    'file:///tmp',
    'https://example.com/path',
    'https://example.com/',
    'https://user:pass@example.com',
    'https://example.com?query=1',
    'https://example.com#fragment',
  ]) {
    assert.throws(
      () => validateEnvironment({ ...environment, FRONTEND_ORIGIN: value }),
      /FRONTEND_ORIGIN/,
    );
  }
  assert.throws(
    () =>
      validateEnvironment({
        ...environment,
        NODE_ENV: 'production',
        AUTH_REFRESH_COOKIE_SECURE: 'false',
      }),
    /must be true in production/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...environment,
        AUTH_REFRESH_COOKIE_SECURE: 'false',
        AUTH_REFRESH_COOKIE_NAME: '__Secure-refresh',
      }),
    /AUTH_REFRESH_COOKIE_NAME/,
  );
  assert.equal(
    validateEnvironment({ ...environment, AUTH_REFRESH_COOKIE_SECURE: 'false' })
      .authRefreshCookieSecure,
    false,
  );
  assert.equal(
    validateEnvironment({
      ...environment,
      NODE_ENV: 'production',
      AUTH_REFRESH_COOKIE_SECURE: 'true',
      FRONTEND_ORIGIN: 'https://gym.example',
      AUTH_REFRESH_TTL_DAYS: '7',
    }).authRefreshTtlDays,
    7,
  );
});

void test('environment defaults to port 3001 and an access lifetime of 900 seconds', () => {
  const secret = randomBytes(32).toString('hex');
  const config = validateEnvironment({
    JWT_ACCESS_SECRET: secret,
    FRONTEND_ORIGIN: 'http://localhost:3000',
  });
  assert.equal(config.port, 3001);
  assert.equal(config.jwtAccessTtlSeconds, 900);
  assert.ok(config.jwtAccessSecret === secret);
});

void test('environment parses explicit duration units and rejects invalid ports and lifetimes', () => {
  const environment = {
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    FRONTEND_ORIGIN: 'http://localhost:3000',
  };
  for (const [ttl, expected] of [
    ['30s', 30],
    ['2m', 120],
    ['15m', 900],
    ['900', 900],
  ] as const) {
    const config = validateEnvironment({
      ...environment,
      PORT: '3002',
      JWT_ACCESS_TTL: ttl,
    });
    assert.equal(config.port, 3002);
    assert.equal(config.jwtAccessTtlSeconds, expected);
  }
  for (const ttl of [
    '',
    '0',
    '-1',
    '1.5h',
    '901',
    '16m',
    '1h',
    '1d',
    '15minutes',
    'Infinity',
    '999999999999999999999d',
    900,
  ]) {
    assert.throws(
      () => validateEnvironment({ ...environment, JWT_ACCESS_TTL: ttl }),
      /JWT_ACCESS_TTL/,
    );
  }
  for (const port of ['', '0', '65536', '1.5', 'invalid']) {
    assert.throws(
      () => validateEnvironment({ ...environment, PORT: port }),
      /PORT/,
    );
  }
});
