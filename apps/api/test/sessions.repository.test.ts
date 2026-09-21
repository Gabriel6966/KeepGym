import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma, Session } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionPersistenceError } from '../src/sessions/errors/session-persistence.error';
import { SessionsRepository } from '../src/sessions/sessions.repository';

const now = new Date('2026-09-20T00:00:00Z');
const row: Session = {
  id: randomUUID(),
  userId: randomUUID(),
  refreshTokenHash: '0'.repeat(64),
  expiresAt: new Date('2026-10-20T00:00:00Z'),
  lastUsedAt: now,
  revokedAt: null,
  createdAt: now,
  updatedAt: now,
};
const input = {
  userId: row.userId,
  refreshTokenHash: row.refreshTokenHash,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
};

async function setup(context: TestContext) {
  const session = {
    create: context.mock.fn<
      (args: Prisma.SessionCreateArgs) => Promise<Session>
    >(async () => row),
    findUnique: context.mock.fn<
      (args: Prisma.SessionFindUniqueArgs) => Promise<Session | null>
    >(async () => row),
    updateMany: context.mock.fn<
      (args: Prisma.SessionUpdateManyArgs) => Promise<{ count: number }>
    >(async () => ({ count: 1 })),
  };
  const module = await Test.createTestingModule({
    providers: [
      SessionsRepository,
      { provide: PrismaService, useValue: { session } },
    ],
  }).compile();
  context.after(async () => {
    await module.close();
  });
  return { repository: module.get(SessionsRepository), session };
}

void test('session repository persists only the allowed fields and finds by UUID', async (context) => {
  const { repository, session } = await setup(context);
  assert.equal(await repository.create(input), row);
  assert.deepEqual(session.create.mock.calls[0]?.arguments, [{ data: input }]);
  assert.equal(await repository.findById(row.id), row);
  assert.deepEqual(session.findUnique.mock.calls[0]?.arguments, [
    { where: { id: row.id } },
  ]);
  session.findUnique.mock.mockImplementation(async () => null);
  assert.equal(await repository.findById(row.id), null);
});

void test('rotation uses one conditional update with old hash, active status and expiry; expiry is never changed', async (context) => {
  const { repository, session } = await setup(context);
  const nextHash = '1'.repeat(64);
  assert.equal(
    await repository.rotate(row.id, row.refreshTokenHash, nextHash, now),
    true,
  );
  assert.deepEqual(session.updateMany.mock.calls[0]?.arguments, [
    {
      where: {
        id: row.id,
        refreshTokenHash: row.refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { refreshTokenHash: nextHash, lastUsedAt: now },
    },
  ]);
  session.updateMany.mock.mockImplementation(async () => ({ count: 0 }));
  assert.equal(
    await repository.rotate(row.id, row.refreshTokenHash, nextHash, now),
    false,
  );
});

void test('revocation targets one session or only active sessions of the selected user', async (context) => {
  const { repository, session } = await setup(context);
  await repository.revoke(row.id, now);
  await repository.revokeAll(row.userId, now);
  assert.deepEqual(
    session.updateMany.mock.calls.map((call) => call.arguments),
    [
      [{ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } }],
      [
        {
          where: {
            userId: row.userId,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        },
      ],
    ],
  );
});

void test('all repository operations sanitize persistence errors without exposing causes or query arguments', async (context) => {
  const { repository, session } = await setup(context);
  const fail = async (): Promise<never> => {
    throw new Error('unit-test-private-query-details');
  };
  session.create.mock.mockImplementation(fail);
  session.findUnique.mock.mockImplementation(fail);
  session.updateMany.mock.mockImplementation(fail);
  for (const operation of [
    () => repository.create(input),
    () => repository.findById(row.id),
    () => repository.rotate(row.id, row.refreshTokenHash, '1'.repeat(64), now),
    () => repository.revoke(row.id, now),
    () => repository.revokeAll(row.userId, now),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof SessionPersistenceError &&
        error.cause === undefined &&
        error.message ===
          'The session persistence operation could not be completed.',
    );
  }
});
