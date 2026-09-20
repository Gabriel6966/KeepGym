import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../src/auth/auth.service';
import { InvalidCredentialsError } from '../src/auth/errors/invalid-credentials.error';
import { PasswordHasher } from '../src/auth/password-hasher.service';
import { environmentConfig } from '../src/config/environment.config';
import { UserEmailAlreadyExistsError } from '../src/users/errors/user-email-already-exists.error';
import { UsersService } from '../src/users/users.service';
import type { UserCredentials } from '../src/users/users.types';
import { testEnvironment } from './support/test-environment';

const password = '  synthetic test password 🏋️  ';
const credentials: UserCredentials = {
  id: '4506bce7-785c-477f-8ac1-cb1296f4d867',
  email: 'user@example.com',
  passwordHash: 'unit-test-encoded-value',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
};

async function setup(context: TestContext) {
  const order: string[] = [];
  const config = testEnvironment({ jwtAccessTtlSeconds: 120 });
  const jwt = new JwtService({
    secret: config.jwtAccessSecret,
    signOptions: { algorithm: 'HS256', expiresIn: config.jwtAccessTtlSeconds },
  });
  const users = {
    create: context.mock.fn<UsersService['create']>(async () => {
      order.push('create');
      return credentials;
    }),
    findCredentialsByEmail: context.mock.fn<
      UsersService['findCredentialsByEmail']
    >(async () => credentials),
    findById: context.mock.fn<UsersService['findById']>(
      async () => credentials,
    ),
  };
  const hasher = {
    hash: context.mock.fn<PasswordHasher['hash']>(async () => {
      order.push('hash');
      return credentials.passwordHash;
    }),
    verify: context.mock.fn(
      async (hash: string, candidate: string): Promise<boolean> =>
        hash === credentials.passwordHash && candidate === password,
    ),
  };
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: UsersService, useValue: users },
      { provide: PasswordHasher, useValue: hasher },
      { provide: JwtService, useValue: jwt },
      { provide: environmentConfig.KEY, useValue: config },
    ],
  }).compile();
  await module.init();
  order.length = 0;
  hasher.hash.mock.resetCalls();
  context.after(async () => {
    await module.close();
  });
  return { service: module.get(AuthService), users, hasher, jwt, order };
}

void test('register hashes the untouched password before persisting and returns only safe fields and an access JWT', async (context) => {
  const { service, users, hasher, jwt, order } = await setup(context);
  const result = await service.register({
    email: ' USER@Example.COM ',
    password,
  });

  assert.deepEqual(order, ['hash', 'create']);
  assert.ok(hasher.hash.mock.calls[0]?.arguments[0] === password);
  assert.deepEqual(users.create.mock.calls[0]?.arguments, [
    { email: ' USER@Example.COM ', passwordHash: credentials.passwordHash },
  ]);
  assert.ok(
    !JSON.stringify(users.create.mock.calls[0]?.arguments).includes(password),
  );
  assert.deepEqual(Object.keys(result.user).sort(), [
    'createdAt',
    'email',
    'id',
    'updatedAt',
  ]);
  assert.ok(!JSON.stringify(result).includes(credentials.passwordHash));
  assert.equal(result.tokenType, 'Bearer');
  assert.equal(result.expiresIn, 120);

  const payload = await jwt.verifyAsync<Record<string, unknown>>(
    result.accessToken,
  );
  assert.equal(payload.sub, credentials.id);
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'sub']);
  assert.equal(typeof payload.iat, 'number');
  assert.equal(typeof payload.exp, 'number');
  assert.equal(Number(payload.exp) - Number(payload.iat), 120);
});

void test('register propagates the duplicate domain error for HTTP translation', async (context) => {
  const { service, users } = await setup(context);
  users.create.mock.mockImplementation(async () => {
    throw new UserEmailAlreadyExistsError();
  });
  await assert.rejects(
    service.register({ email: credentials.email, password }),
    UserEmailAlreadyExistsError,
  );
});

void test('login verifies internal credentials and never exposes their hash', async (context) => {
  const { service, users, hasher, jwt } = await setup(context);
  const result = await service.login({ email: ' USER@Example.COM ', password });

  assert.deepEqual(users.findCredentialsByEmail.mock.calls[0]?.arguments, [
    ' USER@Example.COM ',
  ]);
  assert.deepEqual(hasher.verify.mock.calls[0]?.arguments, [
    credentials.passwordHash,
    password,
  ]);
  assert.equal(users.create.mock.callCount(), 0);
  assert.equal(hasher.hash.mock.callCount(), 0);
  assert.deepEqual(Object.keys(result.user).sort(), [
    'createdAt',
    'email',
    'id',
    'updatedAt',
  ]);
  assert.ok(!JSON.stringify(result).includes(credentials.passwordHash));
  assert.equal(
    (await jwt.verifyAsync<Record<string, unknown>>(result.accessToken)).sub,
    credentials.id,
  );
});

void test('wrong password and missing email produce the same domain error and both perform verification', async (context) => {
  const { service, users, hasher } = await setup(context);
  const expected = {
    name: 'InvalidCredentialsError',
    message: 'Invalid credentials',
  };
  await assert.rejects(
    service.login({
      email: credentials.email,
      password: 'incorrect test password',
    }),
    expected,
  );
  users.findCredentialsByEmail.mock.mockImplementation(async () => null);
  await assert.rejects(
    service.login({ email: 'missing@example.com', password }),
    expected,
  );
  assert.equal(hasher.verify.mock.callCount(), 2);
  assert.equal(users.create.mock.callCount(), 0);
  assert.equal(
    new InvalidCredentialsError().message.includes(credentials.passwordHash),
    false,
  );
});

void test('current user lookup delegates to the public domain operation and preserves missing users', async (context) => {
  const { service, users } = await setup(context);
  assert.equal(
    (await service.findCurrentUser(credentials.id))?.id,
    credentials.id,
  );
  assert.deepEqual(users.findById.mock.calls[0]?.arguments, [credentials.id]);
  users.findById.mock.mockImplementation(async () => null);
  assert.equal(await service.findCurrentUser(credentials.id), null);
});
