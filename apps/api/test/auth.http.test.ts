import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import type { User } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserEmailAlreadyExistsError } from '../src/users/errors/user-email-already-exists.error';
import { UsersRepository } from '../src/users/users.repository';
import type { CreateUserInput } from '../src/users/users.types';
import { testEnvironment } from './support/test-environment';

const config = testEnvironment();
const password = '  una contraseña de prueba 🏋️  ';
const users = new Map<string, User>();
let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;

before(async () => {
  // Only persistence is replaced: DTOs, services, Argon2 and JWT are real.
  const repository = {
    async create(input: CreateUserInput): Promise<User> {
      if ([...users.values()].some((user) => user.email === input.email)) {
        throw new UserEmailAlreadyExistsError();
      }
      const user: User = {
        id: randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.set(user.id, user);
      return user;
    },
    async findByEmail(email: string): Promise<User | null> {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findById(id: string): Promise<User | null> {
      return users.get(id) ?? null;
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(config)
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(UsersRepository)
    .useValue(repository)
    .compile();
  app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  jwt = app.get(JwtService);
});

after(async () => {
  await app?.close();
});

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function assertPublicUser(value: unknown): Record<string, unknown> {
  const user = object(value);
  assert.deepEqual(Object.keys(user).sort(), [
    'createdAt',
    'email',
    'id',
    'updatedAt',
  ]);
  for (const field of ['id', 'email', 'createdAt', 'updatedAt']) {
    assert.equal(typeof user[field], 'string');
  }
  return user;
}

async function register(candidate = password) {
  const email = `${randomUUID()}@example.com`;
  const response = await post('/auth/register', {
    email: `  ${email.toUpperCase()}  `,
    password: candidate,
  });
  assert.equal(response.status, 201);
  const body = object(await response.json());
  const user = assertPublicUser(body.user);
  assert.equal(user.email, email);
  assert.ok(typeof user.id === 'string');
  assert.ok(
    typeof body.accessToken === 'string' && body.accessToken.length > 0,
  );
  assert.equal(body.tokenType, 'Bearer');
  assert.equal(body.expiresIn, 900);
  return { body, id: user.id, email, accessToken: body.accessToken };
}

void test('register returns 201, normalizes email and persists a salted Argon2id hash, never plaintext', async () => {
  const { body, id } = await register();
  const stored = users.get(id);
  assert.ok(stored);
  assert.ok(stored.passwordHash !== password);
  assert.ok(stored.passwordHash.startsWith('$argon2id$'));
  assert.ok(!JSON.stringify(body).includes(stored.passwordHash));
  assert.ok(!JSON.stringify(body).includes(password));
});

void test('both auth DTOs reject invalid emails, password lengths/types, missing fields and extra fields', async (context) => {
  const cases = [
    { label: 'invalid email', input: { email: 'not-an-email', password } },
    { label: 'missing email', input: { password } },
    { label: 'non-string email', input: { email: 123, password } },
    {
      label: 'overlong email',
      input: { email: `${'a'.repeat(320)}@example.com`, password },
    },
    {
      label: 'short password',
      input: { email: 'test@example.com', password: 'a'.repeat(14) },
    },
    {
      label: 'short Unicode password',
      input: { email: 'test@example.com', password: '💪'.repeat(14) },
    },
    {
      label: 'long password',
      input: { email: 'test@example.com', password: 'a'.repeat(129) },
    },
    { label: 'missing password', input: { email: 'test@example.com' } },
    {
      label: 'non-string password',
      input: { email: 'test@example.com', password: 123456789012345 },
    },
    {
      label: 'extra field',
      input: { email: 'test@example.com', password, role: 'admin' },
    },
  ];
  for (const path of ['/auth/register', '/auth/login']) {
    for (const entry of cases) {
      await context.test(`${path}: ${entry.label}`, async () => {
        const count = users.size;
        const response = await post(path, entry.input);
        assert.equal(response.status, 400);
        const text = await response.text();
        assert.ok(!text.includes(password));
        assert.ok(!text.includes('passwordHash'));
        assert.ok(!text.includes('stack'));
        assert.equal(users.size, count);
      });
    }
  }
});

void test('password boundaries, Unicode and spaces are accepted without trimming or complexity rules', async () => {
  for (const candidate of [
    'a'.repeat(15),
    'a'.repeat(128),
    '💪'.repeat(15),
    ' '.repeat(15),
  ]) {
    const { email } = await register(candidate);
    assert.equal(
      (await post('/auth/login', { email, password: candidate })).status,
      200,
    );
  }
  const { email } = await register();
  assert.equal(
    (await post('/auth/login', { email, password: password.trim() })).status,
    401,
  );
});

void test('login returns 200 with a safe response and a minimal JWT with the configured lifetime', async () => {
  const { email, id } = await register();
  const response = await post('/auth/login', {
    email: ` ${email.toUpperCase()} `,
    password,
  });
  assert.equal(response.status, 200);
  const body = object(await response.json());
  assertPublicUser(body.user);
  assert.ok(typeof body.accessToken === 'string');
  const payload = await jwt.verifyAsync<Record<string, unknown>>(
    body.accessToken,
  );
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'sub']);
  assert.equal(payload.sub, id);
  assert.equal(Number(payload.exp) - Number(payload.iat), 900);
  assert.equal(body.expiresIn, 900);
  assert.equal(body.tokenType, 'Bearer');
  assert.ok(
    !JSON.stringify(body).includes(
      users.get(id)?.passwordHash ?? 'passwordHash',
    ),
  );
});

void test('wrong password and nonexistent email return identical generic 401 responses', async () => {
  const { email } = await register();
  const wrong = await post('/auth/login', {
    email,
    password: 'incorrect test password',
  });
  const missing = await post('/auth/login', {
    email: 'missing@example.com',
    password,
  });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  const body: unknown = await wrong.json();
  assert.deepEqual(await missing.json(), body);
  assert.deepEqual(body, {
    statusCode: 401,
    message: 'Invalid credentials',
    error: 'Unauthorized',
  });
});

void test('duplicate registration returns 409 without persistence details', async () => {
  const { email } = await register();
  const response = await post('/auth/register', {
    email: email.toUpperCase(),
    password,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    statusCode: 409,
    message: 'Email already exists',
    error: 'Conflict',
  });
});

void test('/auth/me returns the current public user, not data cached in the access JWT', async () => {
  const { id, accessToken } = await register();
  const stored = users.get(id);
  assert.ok(stored);
  stored.email = `updated-${randomUUID()}@example.com`;
  const response = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 200);
  const user = assertPublicUser(await response.json());
  assert.equal(user.id, id);
  assert.equal(user.email, stored.email);
  assert.ok(!JSON.stringify(user).includes(stored.passwordHash));
});

void test('/auth/me rejects deleted identities even with a valid signed token', async () => {
  const { id, accessToken } = await register();
  users.delete(id);
  const response = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 401);
});

void test('access guard rejects missing, malformed, altered, expired, unsigned and invalid-claim tokens', async (context) => {
  const { id, accessToken } = await register();
  const signatureIndex = accessToken.lastIndexOf('.') + 1;
  const altered =
    accessToken.slice(0, signatureIndex) +
    (accessToken[signatureIndex] === 'A' ? 'B' : 'A') +
    accessToken.slice(signatureIndex + 1);
  const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url')}.`;
  const noDefaults = new JwtService({ secret: config.jwtAccessSecret });
  const cases = [
    { label: 'missing header', authorization: undefined },
    { label: 'wrong scheme', authorization: `Basic ${accessToken}` },
    { label: 'empty bearer', authorization: 'Bearer' },
    { label: 'malformed', authorization: 'Bearer not-a-jwt' },
    { label: 'extra token', authorization: `Bearer ${accessToken} extra` },
    { label: 'altered signature', authorization: `Bearer ${altered}` },
    {
      label: 'expired',
      authorization: `Bearer ${await jwt.signAsync({ sub: id }, { expiresIn: -1 })}`,
    },
    {
      label: 'wrong secret',
      authorization: `Bearer ${await jwt.signAsync({ sub: id }, { secret: testEnvironment().jwtAccessSecret })}`,
    },
    { label: 'unsigned', authorization: `Bearer ${unsigned}` },
    {
      label: 'wrong algorithm',
      authorization: `Bearer ${await jwt.signAsync({ sub: id }, { algorithm: 'HS384' })}`,
    },
    {
      label: 'missing subject',
      authorization: `Bearer ${await jwt.signAsync({})}`,
    },
    {
      label: 'invalid subject',
      authorization: `Bearer ${await jwt.signAsync({ sub: 'not-a-uuid' })}`,
    },
    {
      label: 'missing expiration',
      authorization: `Bearer ${await noDefaults.signAsync({ sub: id })}`,
    },
  ];
  for (const entry of cases) {
    await context.test(entry.label, async () => {
      const response = await fetch(`${baseUrl}/auth/me`, {
        headers: entry.authorization
          ? { authorization: entry.authorization }
          : {},
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        statusCode: 401,
        message: 'Invalid access token',
        error: 'Unauthorized',
      });
    });
  }
  const queryResponse = await fetch(
    `${baseUrl}/auth/me?access_token=${encodeURIComponent(accessToken)}`,
  );
  assert.equal(queryResponse.status, 401);
});
