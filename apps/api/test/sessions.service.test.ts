import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { environmentConfig } from '../src/config/environment.config';
import { InvalidRefreshTokenError } from '../src/sessions/errors/invalid-refresh-token.error';
import { RefreshTokenService } from '../src/sessions/refresh-token.service';
import { SessionsRepository } from '../src/sessions/sessions.repository';
import { SessionsService } from '../src/sessions/sessions.service';
import { InMemorySessionsRepository } from './support/in-memory-sessions.repository';
import { testEnvironment } from './support/test-environment';

async function setup(context: TestContext) {
  const repository = new InMemorySessionsRepository();
  const tokens = new RefreshTokenService();
  const module = await Test.createTestingModule({
    providers: [
      SessionsService,
      { provide: SessionsRepository, useValue: repository },
      { provide: RefreshTokenService, useValue: tokens },
      {
        provide: environmentConfig.KEY,
        useValue: testEnvironment({ authRefreshTtlDays: 7 }),
      },
    ],
  }).compile();
  context.after(async () => {
    await module.close();
  });
  return { service: module.get(SessionsService), repository, tokens };
}

void test('sessions are created with only a hash, an initial lastUsedAt and the configured absolute expiry', async (context) => {
  const { service, repository, tokens } = await setup(context);
  const create = context.mock.method(repository, 'create');
  const start = Date.now();
  const userId = randomUUID();
  const grant = await service.create(userId);
  const stored = repository.sessions.get(grant.sessionId);
  const parsed = tokens.parse(grant.refreshToken);
  assert.ok(stored && parsed);
  assert.equal(stored.userId, userId);
  assert.ok(grant.expiresAt.getTime() >= start + 7 * 86400000);
  assert.ok(grant.expiresAt.getTime() <= Date.now() + 7 * 86400000);
  assert.ok(stored.lastUsedAt.getTime() >= start);
  assert.equal(stored.revokedAt, null);
  assert.ok(stored.refreshTokenHash === tokens.hash(parsed.secret));
  assert.ok(!JSON.stringify(stored).includes(parsed.secret));
  assert.ok(!JSON.stringify(stored).includes(grant.refreshToken));
  assert.deepEqual(
    Object.keys(create.mock.calls[0]?.arguments[0] ?? {}).sort(),
    ['expiresAt', 'lastUsedAt', 'refreshTokenHash', 'userId'],
  );
});

void test('rotation changes the stored hash and last use without extending absolute expiry', async (context) => {
  const { service, repository, tokens } = await setup(context);
  const first = await service.create(randomUUID());
  const before = await repository.findById(first.sessionId);
  assert.ok(before);
  const rotated = await service.rotate(first.refreshToken);
  const after = await repository.findById(first.sessionId);
  assert.ok(after);
  assert.ok(first.refreshToken !== rotated.refreshToken);
  assert.ok(before.refreshTokenHash !== after.refreshTokenHash);
  assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
  assert.equal(rotated.expiresAt.getTime(), first.expiresAt.getTime());
  assert.ok(after.lastUsedAt >= before.lastUsedAt);
  const old = tokens.parse(first.refreshToken);
  assert.ok(old);
  assert.equal(tokens.matches(old.secret, after.refreshTokenHash), false);
});

void test('reusing A after rotation to B revokes the session and makes B unusable', async (context) => {
  const { service, repository } = await setup(context);
  const first = await service.create(randomUUID());
  const second = await service.rotate(first.refreshToken);
  await assert.rejects(
    service.rotate(first.refreshToken),
    InvalidRefreshTokenError,
  );
  assert.ok(repository.sessions.get(first.sessionId)?.revokedAt);
  await assert.rejects(
    service.rotate(second.refreshToken),
    InvalidRefreshTokenError,
  );
});

void test('concurrent rotations have at most one winner and a losing reuse revokes the winner', async (context) => {
  const { service, repository } = await setup(context);
  const first = await service.create(randomUUID());
  const results = await Promise.allSettled([
    service.rotate(first.refreshToken),
    service.rotate(first.refreshToken),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const winner = results.find((result) => result.status === 'fulfilled');
  assert.ok(winner?.status === 'fulfilled');
  assert.ok(repository.sessions.get(first.sessionId)?.revokedAt);
  await assert.rejects(
    service.rotate(winner.value.refreshToken),
    InvalidRefreshTokenError,
  );
});

void test('missing, malformed, unknown, expired and revoked sessions all fail generically', async (context) => {
  const { service, repository, tokens } = await setup(context);
  for (const token of [
    undefined,
    'malformed',
    tokens.build(randomUUID(), tokens.generateSecret()),
  ]) {
    await assert.rejects(service.rotate(token), {
      name: 'InvalidRefreshTokenError',
      message: 'Invalid refresh token',
    });
  }
  const expired = await service.create(randomUUID());
  const stored = repository.sessions.get(expired.sessionId);
  assert.ok(stored);
  stored.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(
    service.rotate(expired.refreshToken),
    InvalidRefreshTokenError,
  );
  assert.ok(stored.expiresAt.getTime() < Date.now());
  const revoked = await service.create(randomUUID());
  await service.revoke(revoked.refreshToken);
  await assert.rejects(
    service.rotate(revoked.refreshToken),
    InvalidRefreshTokenError,
  );
});

void test('a wrong secret for an active session revokes it as a possible replay', async (context) => {
  const { service, repository, tokens } = await setup(context);
  const first = await service.create(randomUUID());
  await assert.rejects(
    service.rotate(tokens.build(first.sessionId, tokens.generateSecret())),
    InvalidRefreshTokenError,
  );
  assert.ok(repository.sessions.get(first.sessionId)?.revokedAt);
});

void test('logout revocation is idempotent and requires a matching secret, not just a session id', async (context) => {
  const { service, repository, tokens } = await setup(context);
  const first = await service.create(randomUUID());
  await service.revoke(undefined);
  await service.revoke('invalid');
  await service.revoke(tokens.build(first.sessionId, tokens.generateSecret()));
  assert.equal(repository.sessions.get(first.sessionId)?.revokedAt, null);
  await service.revoke(first.refreshToken);
  const revokedAt = repository.sessions.get(first.sessionId)?.revokedAt;
  assert.ok(revokedAt);
  await service.revoke(first.refreshToken);
  assert.equal(repository.sessions.get(first.sessionId)?.revokedAt, revokedAt);
});

void test('revokeAll invalidates only the authenticated user active sessions', async (context) => {
  const { service, repository } = await setup(context);
  const owner = randomUUID();
  const first = await service.create(owner);
  const second = await service.create(owner);
  const other = await service.create(randomUUID());
  await service.revokeAll(owner);
  for (const grant of [first, second]) {
    assert.ok(repository.sessions.get(grant.sessionId)?.revokedAt);
    await assert.rejects(
      service.rotate(grant.refreshToken),
      InvalidRefreshTokenError,
    );
  }
  assert.equal(repository.sessions.get(other.sessionId)?.revokedAt, null);
  assert.equal((await service.rotate(other.refreshToken)).userId, other.userId);
});
