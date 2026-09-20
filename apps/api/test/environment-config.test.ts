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

void test('environment defaults to port 3001 and an access lifetime of 900 seconds', () => {
  const secret = randomBytes(32).toString('hex');
  const config = validateEnvironment({ JWT_ACCESS_SECRET: secret });
  assert.equal(config.port, 3001);
  assert.equal(config.jwtAccessTtlSeconds, 900);
  assert.ok(config.jwtAccessSecret === secret);
});

void test('environment parses explicit duration units and rejects invalid ports and lifetimes', () => {
  const environment = { JWT_ACCESS_SECRET: randomBytes(32).toString('hex') };
  for (const [ttl, expected] of [
    ['30s', 30],
    ['2m', 120],
    ['1h', 3600],
    ['1d', 86400],
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
