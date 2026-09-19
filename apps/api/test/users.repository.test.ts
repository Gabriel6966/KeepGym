import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma, type User } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserEmailAlreadyExistsError } from '../src/users/errors/user-email-already-exists.error';
import { UserPersistenceError } from '../src/users/errors/user-persistence.error';
import { UsersRepository } from '../src/users/users.repository';

const storedUser: User = {
  id: '4506bce7-785c-477f-8ac1-cb1296f4d867',
  email: 'user@example.com',
  passwordHash: 'unit-test-placeholder',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
};

const createInput = {
  email: storedUser.email,
  passwordHash: storedUser.passwordHash,
};

async function setup(context: TestContext) {
  const user = {
    create: context.mock.fn(
      async (args: Prisma.UserCreateArgs): Promise<User> => ({
        ...storedUser,
        email: args.data.email,
        passwordHash: args.data.passwordHash,
      }),
    ),
    findUnique: context.mock.fn(
      async (args: Prisma.UserFindUniqueArgs): Promise<User | null> =>
        args.where.id === storedUser.id || args.where.email === storedUser.email
          ? storedUser
          : null,
    ),
  };

  const module = await Test.createTestingModule({
    providers: [
      UsersRepository,
      { provide: PrismaService, useValue: { user } },
    ],
  }).compile();

  context.after(async () => {
    await module.close();
  });

  return { repository: module.get(UsersRepository), user };
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    `Query arguments included ${storedUser.passwordHash}`,
    { code, clientVersion: Prisma.prismaVersion.client, meta },
  );
}

void test('repository create delegates only email and hash to Prisma', async (context) => {
  const { repository, user } = await setup(context);
  const result = await repository.create(createInput);

  assert.deepEqual(user.create.mock.calls[0]?.arguments, [
    { data: createInput },
  ]);
  assert.equal(user.create.mock.callCount(), 1);
  assert.equal(result.id, storedUser.id);
  assert.equal(result.passwordHash === storedUser.passwordHash, true);
});

void test('repository findById uses the UUID filter and returns null when missing', async (context) => {
  const { repository, user } = await setup(context);
  const missingId = '05bccd9c-cae8-48e7-a330-7e4a415d7988';

  assert.equal(await repository.findById(storedUser.id), storedUser);
  assert.equal(await repository.findById(missingId), null);
  assert.deepEqual(
    user.findUnique.mock.calls.map((call) => call.arguments),
    [[{ where: { id: storedUser.id } }], [{ where: { id: missingId } }]],
  );
});

void test('repository findByEmail uses the supplied normalized email', async (context) => {
  const { repository, user } = await setup(context);

  assert.equal(await repository.findByEmail(storedUser.email), storedUser);
  assert.equal(await repository.findByEmail('missing@example.com'), null);
  assert.deepEqual(
    user.findUnique.mock.calls.map((call) => call.arguments),
    [
      [{ where: { email: storedUser.email } }],
      [{ where: { email: 'missing@example.com' } }],
    ],
  );
});

const emailConflicts: Array<{ name: string; meta: Record<string, unknown> }> = [
  {
    name: 'Prisma 7 adapter-pg constraint metadata',
    meta: {
      modelName: 'User',
      driverAdapterError: {
        cause: {
          kind: 'UniqueConstraintViolation',
          constraint: { index: 'users_email_key' },
        },
      },
    },
  },
  {
    name: 'named unique target',
    meta: { modelName: 'User', target: 'users_email_key' },
  },
  {
    name: 'email field target',
    meta: { modelName: 'User', target: ['email'] },
  },
];

for (const { name, meta } of emailConflicts) {
  void test(`repository translates ${name} to a safe duplicate email error`, async (context) => {
    const { repository, user } = await setup(context);
    user.create.mock.mockImplementation(async () => {
      throw prismaError('P2002', meta);
    });

    await assert.rejects(repository.create(createInput), (error: unknown) => {
      assert.ok(error instanceof UserEmailAlreadyExistsError);
      assert.equal(error.message, 'A user with this email already exists.');
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      return true;
    });
  });
}

const otherFailures = [
  {
    name: 'a different unique field',
    error: prismaError('P2002', { modelName: 'User', target: ['id'] }),
  },
  {
    name: 'a different PostgreSQL constraint',
    error: prismaError('P2002', {
      modelName: 'User',
      driverAdapterError: {
        cause: {
          kind: 'UniqueConstraintViolation',
          constraint: { index: 'users_pkey' },
        },
      },
    }),
  },
  { name: 'a unique error without metadata', error: prismaError('P2002') },
  { name: 'another Prisma error code', error: prismaError('P2021') },
  {
    name: 'a unique error from a different model',
    error: prismaError('P2002', {
      modelName: 'DifferentModel',
      target: ['email'],
    }),
  },
  { name: 'an unexpected error', error: new Error(storedUser.passwordHash) },
];

for (const { name, error: originalError } of otherFailures) {
  void test(`repository sanitizes ${name} without reporting a duplicate`, async (context) => {
    const { repository, user } = await setup(context);
    user.create.mock.mockImplementation(async () => {
      throw originalError;
    });

    await assert.rejects(repository.create(createInput), (error: unknown) => {
      assert.ok(error instanceof UserPersistenceError);
      assert.equal(error instanceof UserEmailAlreadyExistsError, false);
      assert.equal(error.message.includes(storedUser.passwordHash), false);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      return true;
    });
  });
}

void test('repository sanitizes lookup failures without treating them as missing users', async (context) => {
  const { repository, user } = await setup(context);
  user.findUnique.mock.mockImplementation(async () => {
    throw prismaError('P2021');
  });

  await assert.rejects(
    repository.findById(storedUser.id),
    UserPersistenceError,
  );
  await assert.rejects(
    repository.findByEmail(storedUser.email),
    UserPersistenceError,
  );
});
