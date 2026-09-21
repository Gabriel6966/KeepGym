import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RefreshTokenService } from '../src/sessions/refresh-token.service';

const tokens = new RefreshTokenService();

void test('refresh secrets contain 32 random bytes and tokens round-trip in a canonical format', () => {
  const first = tokens.generateSecret();
  const second = tokens.generateSecret();
  assert.ok(first !== second);
  assert.equal(Buffer.from(first, 'base64url').length, 32);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(first));
  const id = randomUUID();
  const token = tokens.build(id, first);
  const parsed = tokens.parse(token);
  assert.equal(token.length, 80);
  assert.equal(parsed?.sessionId, id);
  assert.ok(parsed?.secret === first);
});

void test('malformed opaque tokens are rejected without leaking input', () => {
  const id = randomUUID();
  const secret = tokens.generateSecret();
  const valid = tokens.build(id, secret);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = secret.at(-1);
  assert.ok(last);
  const nonCanonical =
    secret.slice(0, -1) + alphabet[alphabet.indexOf(last) + 1];
  for (const token of [
    undefined,
    null,
    {},
    123,
    '',
    id,
    secret,
    'not-a-uuid.' + secret,
    valid + '.',
    ' ' + valid,
    valid + ' ',
    id + '.' + secret + '=',
    id + '.' + nonCanonical,
    id + '.' + 'a'.repeat(42),
    id + '.' + '!'.repeat(43),
  ]) {
    assert.equal(tokens.parse(token), null);
  }
});

void test('SHA-256 hashes are deterministic hex digests, never the secret or token', () => {
  const secret = tokens.generateSecret();
  const hash = tokens.hash(secret);
  assert.ok(/^[a-f0-9]{64}$/.test(hash));
  assert.ok(hash === tokens.hash(secret));
  assert.ok(hash === createHash('sha256').update(secret).digest('hex'));
  assert.ok(hash !== secret && !hash.includes(secret));
  assert.equal(tokens.matches(secret, hash), true);
  assert.equal(tokens.matches(tokens.generateSecret(), hash), false);
  for (const invalid of ['', 'a', 'x'.repeat(64), hash.slice(1)]) {
    assert.equal(tokens.matches(secret, invalid), false);
  }
});
