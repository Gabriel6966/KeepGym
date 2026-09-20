import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsRehash } from 'argon2';
import { PasswordHasher } from '../src/auth/password-hasher.service';

void test('Argon2id hashes with the required costs, automatic salts, and no plaintext', async () => {
  const hasher = new PasswordHasher();
  const password = '  contraseña de prueba 🏋️  ';
  const first = await hasher.hash(password);
  const second = await hasher.hash(password);

  assert.ok(first.startsWith('$argon2id$v=19$'));
  assert.equal(
    needsRehash(first, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    false,
  );
  assert.ok(!first.includes(password));
  assert.ok(first !== second);
  assert.equal(await hasher.verify(first, password), true);
  assert.equal(await hasher.verify(first, 'una contraseña diferente'), false);
  assert.equal(await hasher.verify(first, password.trim()), false);
});

void test('invalid stored hashes fail verification without exposing library errors', async () => {
  const hasher = new PasswordHasher();
  assert.equal(
    await hasher.verify('invalid-unit-test-hash', 'synthetic test password'),
    false,
  );
});
