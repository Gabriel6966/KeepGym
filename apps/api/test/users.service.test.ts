import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { User } from '../src/generated/prisma/client';
import { InvalidUserInputError } from '../src/users/errors/invalid-user-input.error';
import { UserEmailAlreadyExistsError } from '../src/users/errors/user-email-already-exists.error';
import { UsersRepository } from '../src/users/users.repository';
import { UsersService } from '../src/users/users.service';
import type { CreateUserInput } from '../src/users/users.types';

const storedUser: User = {
  id: '4506bce7-785c-477f-8ac1-cb1296f4d867',
  email: 'user@example.com',
  passwordHash: 'unit-test-placeholder',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
};

async function setup(context: TestContext) {
  const repository = {
    create: context.mock.fn(async (input: CreateUserInput): Promise<User> => ({
      ...storedUser,
      email: input.email,
      passwordHash: input.passwordHash,
    })),
    findById: context.mock.fn(async (id: string): Promise<User | null> =>
      id === storedUser.id ? storedUser : null,
    ),
    findByEmail: context.mock.fn(async (email: string): Promise<User | null> =>
      email === storedUser.email ? storedUser : null,
    ),
  };

  const module = await Test.createTestingModule({
    providers: [
      UsersService,
      { provide: UsersRepository, useValue: repository },
    ],
  }).compile();

  context.after(async () => {
    await module.close();
  });

  return { service: module.get(UsersService), repository };
}

void test('create normalizes email and delegates once without a duplicate precheck', async (context) => {
  const { service, repository } = await setup(context);
  const input = {
    email: '  USER@Example.COM  ',
    passwordHash: storedUser.passwordHash,
  };

  const result = await service.create(input);

  assert.equal(result.email, 'user@example.com');
  assert.equal(repository.create.mock.callCount(), 1);
  assert.deepEqual(repository.create.mock.calls[0]?.arguments, [
    { email: 'user@example.com', passwordHash: input.passwordHash },
  ]);
  assert.equal(repository.findByEmail.mock.callCount(), 0);
  assert.equal(input.email, '  USER@Example.COM  ');
});

void test('all service results expose only the four public fields', async (context) => {
  const { service } = await setup(context);
  const results = await Promise.all([
    service.create({
      email: storedUser.email,
      passwordHash: storedUser.passwordHash,
    }),
    service.findById(storedUser.id),
    service.findByEmail(storedUser.email),
  ]);

  for (const result of results) {
    assert.ok(result);
    assert.deepEqual(Object.keys(result).sort(), [
      'createdAt',
      'email',
      'id',
      'updatedAt',
    ]);
    assert.equal('passwordHash' in result, false);
    assert.equal(
      JSON.stringify(result).includes(storedUser.passwordHash),
      false,
    );
    assert.equal(result.id, storedUser.id);
    assert.equal(result.createdAt, storedUser.createdAt);
    assert.equal(result.updatedAt, storedUser.updatedAt);
  }
});

void test('findById delegates the identifier and preserves missing results', async (context) => {
  const { service, repository } = await setup(context);
  const missingId = '05bccd9c-cae8-48e7-a330-7e4a415d7988';

  assert.equal((await service.findById(storedUser.id))?.id, storedUser.id);
  assert.equal(await service.findById(missingId), null);
  assert.deepEqual(
    repository.findById.mock.calls.map((call) => call.arguments),
    [[storedUser.id], [missingId]],
  );
});

void test('findByEmail normalizes lookups and preserves missing results', async (context) => {
  const { service, repository } = await setup(context);

  assert.equal(
    (await service.findByEmail('  USER@Example.COM  '))?.id,
    storedUser.id,
  );
  assert.equal(await service.findByEmail(' MISSING@Example.COM '), null);
  assert.deepEqual(
    repository.findByEmail.mock.calls.map((call) => call.arguments),
    [['user@example.com'], ['missing@example.com']],
  );
});

void test('empty and overlong emails are rejected before repository access', async (context) => {
  const { service, repository } = await setup(context);

  for (const email of ['   ', 'a'.repeat(321)]) {
    await assert.rejects(
      service.create({ email, passwordHash: storedUser.passwordHash }),
      InvalidUserInputError,
    );
    await assert.rejects(service.findByEmail(email), InvalidUserInputError);
  }

  assert.equal(repository.create.mock.callCount(), 0);
  assert.equal(repository.findByEmail.mock.callCount(), 0);
});

void test('an empty hash is rejected without persisting a user', async (context) => {
  const { service, repository } = await setup(context);

  await assert.rejects(
    service.create({ email: storedUser.email, passwordHash: '   ' }),
    InvalidUserInputError,
  );
  assert.equal(repository.create.mock.callCount(), 0);
});

void test('create propagates the specific duplicate email domain error', async (context) => {
  const { service, repository } = await setup(context);
  const duplicate = new UserEmailAlreadyExistsError();
  repository.create.mock.mockImplementation(async () => {
    throw duplicate;
  });

  await assert.rejects(
    service.create({
      email: storedUser.email,
      passwordHash: storedUser.passwordHash,
    }),
    (error: unknown) => error === duplicate,
  );
});
