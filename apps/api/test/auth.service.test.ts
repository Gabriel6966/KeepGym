import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../src/auth/auth.service';
import { InvalidCredentialsError } from '../src/auth/errors/invalid-credentials.error';
import { PasswordHasher } from '../src/auth/password-hasher.service';
import { environmentConfig } from '../src/config/environment.config';
import { SessionsService } from '../src/sessions/sessions.service';
import { RefreshTokenService } from '../src/sessions/refresh-token.service';
import { InvalidRefreshTokenError } from '../src/sessions/errors/invalid-refresh-token.error';
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
  const tokens = new RefreshTokenService();
  const grant = {
    sessionId: '05bccd9c-cae8-48e7-a330-7e4a415d7988',
    userId: credentials.id,
    refreshToken: tokens.build(
      '05bccd9c-cae8-48e7-a330-7e4a415d7988',
      tokens.generateSecret(),
    ),
    expiresAt: new Date(Date.now() + 30 * 86400000),
  };
  const sessions = {
    create: context.mock.fn(async (userId: string) => {
      order.push('session');
      return { ...grant, userId };
    }),
    rotate: context.mock.fn<SessionsService['rotate']>(async () => grant),
    revoke: context.mock.fn<SessionsService['revoke']>(async () => {}),
    revokeAll: context.mock.fn<SessionsService['revokeAll']>(async () => {}),
  };
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: UsersService, useValue: users },
      { provide: PasswordHasher, useValue: hasher },
      { provide: JwtService, useValue: jwt },
      { provide: SessionsService, useValue: sessions },
      { provide: environmentConfig.KEY, useValue: config },
    ],
  }).compile();
  await module.init();
  order.length = 0;
  hasher.hash.mock.resetCalls();
  context.after(async () => {
    await module.close();
  });
  return {
    service: module.get(AuthService),
    users,
    hasher,
    jwt,
    order,
    sessions,
    grant,
  };
}

void test('register hashes the untouched password before persisting and returns only safe fields and an access JWT', async (context) => {
  const { service, users, hasher, jwt, order, sessions } = await setup(context);
  const { response: result, session } = await service.register({
    email: ' USER@Example.COM ',
    password,
  });

  assert.deepEqual(order, ['hash', 'create', 'session']);
  assert.deepEqual(sessions.create.mock.calls[0]?.arguments, [credentials.id]);
  assert.ok(!JSON.stringify(result).includes(session.refreshToken));
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
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'jti', 'sub']);
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
  const { response: result, session } = await service.login({
    email: ' USER@Example.COM ',
    password,
  });
  assert.ok(!JSON.stringify(result).includes(session.refreshToken));

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
  const { service, users, hasher, sessions } = await setup(context);
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
  assert.equal(sessions.create.mock.callCount(), 0);
  assert.equal(users.create.mock.callCount(), 0);
  assert.equal(
    new InvalidCredentialsError().message.includes(credentials.passwordHash),
    false,
  );
});

void test('refresh uses the persisted session owner to fetch PublicUser and emits a fresh access token', async (context) => {
  const { service, users, sessions, grant, jwt } = await setup(context);
  const first = await service.refresh(grant.refreshToken);
  const second = await service.refresh(grant.refreshToken);
  assert.ok(sessions.rotate.mock.calls[0]?.arguments[0] === grant.refreshToken);
  assert.deepEqual(users.findById.mock.calls[0]?.arguments, [grant.userId]);
  assert.equal(sessions.create.mock.callCount(), 0);
  assert.ok(first.response.accessToken !== second.response.accessToken);
  assert.ok(!JSON.stringify(first.response).includes(grant.refreshToken));
  assert.ok(!JSON.stringify(first.response).includes(credentials.passwordHash));
  assert.equal(
    (await jwt.verifyAsync<Record<string, unknown>>(first.response.accessToken))
      .sub,
    grant.userId,
  );
});

void test('refresh rejects a disappeared user and revokes the rotated credential', async (context) => {
  const { service, users, sessions, grant } = await setup(context);
  users.findById.mock.mockImplementation(async () => null);
  await assert.rejects(
    service.refresh(grant.refreshToken),
    InvalidRefreshTokenError,
  );
  assert.ok(sessions.revoke.mock.calls[0]?.arguments[0] === grant.refreshToken);
});

void test('logout operations delegate exclusively to SessionsService', async (context) => {
  const { service, sessions, grant } = await setup(context);
  await service.logout(grant.refreshToken);
  await service.logoutAll(credentials.id);
  assert.ok(sessions.revoke.mock.calls[0]?.arguments[0] === grant.refreshToken);
  assert.deepEqual(sessions.revokeAll.mock.calls[0]?.arguments, [
    credentials.id,
  ]);
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
