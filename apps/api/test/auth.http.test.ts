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
import { configureHttp } from '../src/http/configure-http';
import { SessionsRepository } from '../src/sessions/sessions.repository';
import { RefreshTokenService } from '../src/sessions/refresh-token.service';
import { UserEmailAlreadyExistsError } from '../src/users/errors/user-email-already-exists.error';
import { UsersRepository } from '../src/users/users.repository';
import type { CreateUserInput } from '../src/users/users.types';
import { testEnvironment } from './support/test-environment';
import { InMemorySessionsRepository } from './support/in-memory-sessions.repository';

const config = testEnvironment();
const password = '  una contraseña de prueba 🏋️  ';
const users = new Map<string, User>();
const sessions = new InMemorySessionsRepository();
const refreshTokens = new RefreshTokenService();
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
    .overrideProvider(SessionsRepository)
    .useValue(sessions)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
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

function post(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: config.frontendOrigin,
      ...headers,
    },
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
  assertSafeAuthResponse(body);
  const cookie = refreshCookie(response);
  return {
    body,
    id: user.id,
    email,
    accessToken: body.accessToken,
    cookie,
    response,
  };
}

function assertSafeAuthResponse(body: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(body).sort(), [
    'accessToken',
    'expiresIn',
    'tokenType',
    'user',
  ]);
  assertPublicUser(body.user);
  for (const privateField of [
    'passwordHash',
    'refreshToken',
    'refreshTokenHash',
    'sessionId',
    'secret',
  ]) {
    assert.ok(!JSON.stringify(body).includes(privateField));
  }
}

function refreshCookie(response: Response): string {
  const header = response.headers.get('set-cookie');
  assert.ok(header);
  assert.ok(header?.startsWith(config.authRefreshCookieName + '='));
  assert.ok(
    header.includes('HttpOnly') &&
      header.includes('SameSite=Lax') &&
      header.includes('Path=/auth'),
  );
  assert.ok(!header.includes('Domain=') && !header.includes('Secure'));
  const cookie = header.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

function parsedCookie(cookie: string) {
  const value = cookie.slice(cookie.indexOf('=') + 1);
  const parsed = refreshTokens.parse(value);
  assert.ok(parsed);
  return parsed;
}

function assertClearedCookie(response: Response): void {
  const header = response.headers.get('set-cookie');
  assert.ok(header);
  assert.ok(header?.startsWith(config.authRefreshCookieName + '=;'));
  assert.ok(
    header.includes('Path=/auth') &&
      header.includes('HttpOnly') &&
      header.includes('SameSite=Lax'),
  );
  const expires = /Expires=([^;]+)/i.exec(header)?.[1];
  assert.ok(expires && new Date(expires).getTime() < Date.now());
}

void test('register and login establish separate HttpOnly sessions while retaining safe access-token JSON', async () => {
  const registered = await register();
  const login = await post('/auth/login', {
    email: registered.email,
    password,
  });
  assert.equal(login.status, 200);
  const body = object(await login.json());
  assertSafeAuthResponse(body);
  assert.ok(typeof body.accessToken === 'string');
  const cookie = refreshCookie(login);
  assert.ok(cookie !== registered.cookie);
  for (const response of [registered.response, login]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const maxAge = Number(
      /Max-Age=(\d+)/i.exec(response.headers.get('set-cookie') ?? '')?.[1],
    );
    assert.ok(maxAge > 29 * 86400 && maxAge <= 30 * 86400);
  }
  for (const value of [registered.cookie, cookie]) {
    const parsed = parsedCookie(value);
    const stored = sessions.sessions.get(parsed.sessionId);
    assert.ok(stored);
    assert.equal(stored.userId, registered.id);
    assert.ok(stored.refreshTokenHash === refreshTokens.hash(parsed.secret));
    assert.ok(!JSON.stringify(stored).includes(parsed.secret));
    assert.ok(!JSON.stringify(body).includes(parsed.secret));
  }
});

void test('refresh rotates the cookie and access token without extending the session or exposing it in JSON', async () => {
  const first = await register();
  const parsed = parsedCookie(first.cookie);
  const stored = sessions.sessions.get(parsed.sessionId);
  assert.ok(stored);
  stored.expiresAt = new Date(Date.now() + 3600000);
  const expiresAt = stored.expiresAt.getTime();
  const oldHash = stored.refreshTokenHash;
  const response = await post('/auth/refresh', undefined, {
    cookie: first.cookie,
  });
  assert.equal(response.status, 200);
  const body = object(await response.json());
  assertSafeAuthResponse(body);
  assert.ok(
    typeof body.accessToken === 'string' &&
      body.accessToken !== first.accessToken,
  );
  const nextCookie = refreshCookie(response);
  assert.ok(nextCookie !== first.cookie);
  assert.ok(oldHash !== stored.refreshTokenHash);
  assert.equal(stored.expiresAt.getTime(), expiresAt);
  const maxAge = Number(
    /Max-Age=(\d+)/i.exec(response.headers.get('set-cookie') ?? '')?.[1],
  );
  assert.ok(maxAge > 3500 && maxAge <= 3600);
});

void test('replay of A after rotating to B returns generic 401, clears the cookie and invalidates B', async () => {
  const first = await register();
  const rotated = await post('/auth/refresh', undefined, {
    cookie: first.cookie,
  });
  assert.equal(rotated.status, 200);
  const secondCookie = refreshCookie(rotated);
  const replay = await post('/auth/refresh', undefined, {
    cookie: first.cookie,
  });
  assert.equal(replay.status, 401);
  assertClearedCookie(replay);
  assert.deepEqual(await replay.json(), {
    statusCode: 401,
    message: 'Invalid refresh token',
    error: 'Unauthorized',
  });
  const second = await post('/auth/refresh', undefined, {
    cookie: secondCookie,
  });
  assert.equal(second.status, 401);
  assertClearedCookie(second);
  assert.ok(
    sessions.sessions.get(parsedCookie(first.cookie).sessionId)?.revokedAt,
  );
});

void test('concurrent HTTP refreshes cannot both succeed and the resulting credential is revoked on reuse', async () => {
  const first = await register();
  const responses = await Promise.all([
    post('/auth/refresh', undefined, { cookie: first.cookie }),
    post('/auth/refresh', undefined, { cookie: first.cookie }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 401],
  );
  const winner = responses.find((response) => response.status === 200);
  assert.ok(winner);
  const result = await post('/auth/refresh', undefined, {
    cookie: refreshCookie(winner),
  });
  assert.equal(result.status, 401);
});

void test('missing, malformed, expired, revoked, unknown and incorrect refresh credentials all return the same 401', async () => {
  const expired = await register();
  const expiredSession = sessions.sessions.get(
    parsedCookie(expired.cookie).sessionId,
  );
  assert.ok(expiredSession);
  expiredSession.expiresAt = new Date(Date.now() - 1000);
  const revoked = await register();
  await post('/auth/logout', undefined, { cookie: revoked.cookie });
  const incorrect = await register();
  const incorrectCookie =
    config.authRefreshCookieName +
    '=' +
    refreshTokens.build(
      parsedCookie(incorrect.cookie).sessionId,
      refreshTokens.generateSecret(),
    );
  const unknownCookie =
    config.authRefreshCookieName +
    '=' +
    refreshTokens.build(randomUUID(), refreshTokens.generateSecret());
  for (const cookie of [
    undefined,
    config.authRefreshCookieName + '=malformed',
    expired.cookie,
    revoked.cookie,
    incorrectCookie,
    unknownCookie,
  ]) {
    const response = await post(
      '/auth/refresh',
      undefined,
      cookie ? { cookie } : {},
    );
    assert.equal(response.status, 401);
    assertClearedCookie(response);
    assert.deepEqual(await response.json(), {
      statusCode: 401,
      message: 'Invalid refresh token',
      error: 'Unauthorized',
    });
  }
});

void test('refresh takes credentials exclusively from cookies, never the body or query', async () => {
  const registered = await register();
  const token = registered.cookie.slice(registered.cookie.indexOf('=') + 1);
  const response = await post(
    '/auth/refresh?refreshToken=' + encodeURIComponent(token),
    { refreshToken: token, userId: registered.id },
  );
  assert.equal(response.status, 401);
  assert.equal(
    (await post('/auth/refresh', undefined, { cookie: registered.cookie }))
      .status,
    200,
  );
});

void test('logout is idempotent, clears the cookie and revokes refresh, but issued access JWTs remain valid', async () => {
  const first = await register();
  for (const cookie of [first.cookie, first.cookie, undefined]) {
    const logout = await post(
      '/auth/logout',
      undefined,
      cookie ? { cookie } : {},
    );
    assert.equal(logout.status, 204);
    assert.equal(await logout.text(), '');
    assertClearedCookie(logout);
  }
  assert.equal(
    (await post('/auth/refresh', undefined, { cookie: first.cookie })).status,
    401,
  );
  const me = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${first.accessToken}` },
  });
  assert.equal(me.status, 200);
  assertPublicUser(await me.json());
});

void test('logout with a guessed secret cannot revoke an unrelated session', async () => {
  const first = await register();
  const invalidCookie =
    config.authRefreshCookieName +
    '=' +
    refreshTokens.build(
      parsedCookie(first.cookie).sessionId,
      refreshTokens.generateSecret(),
    );
  const logout = await post('/auth/logout', undefined, {
    cookie: invalidCookie,
  });
  assert.equal(logout.status, 204);
  assertClearedCookie(logout);
  assert.equal(
    (await post('/auth/refresh', undefined, { cookie: first.cookie })).status,
    200,
  );
});

void test('logout-all revokes both owner sessions, ignores body/query user ids, and leaves other users and access JWTs intact', async () => {
  const first = await register();
  const login = await post('/auth/login', { email: first.email, password });
  assert.equal(login.status, 200);
  const secondCookie = refreshCookie(login);
  const other = await register();
  assert.equal(
    (await post('/auth/logout-all', undefined, { cookie: first.cookie }))
      .status,
    401,
  );
  const logout = await post(
    '/auth/logout-all?userId=' + other.id,
    { userId: other.id },
    { authorization: `Bearer ${first.accessToken}`, cookie: first.cookie },
  );
  assert.equal(logout.status, 204);
  assertClearedCookie(logout);
  for (const cookie of [first.cookie, secondCookie]) {
    assert.equal(
      (await post('/auth/refresh', undefined, { cookie })).status,
      401,
    );
  }
  assert.equal(
    (await post('/auth/refresh', undefined, { cookie: other.cookie })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/auth/me`, {
        headers: { authorization: `Bearer ${first.accessToken}` },
      })
    ).status,
    200,
  );
});

void test('all cookie endpoints reject missing and unauthorized origins before mutating state or cookies', async () => {
  const first = await register();
  const count = sessions.sessions.size;
  for (const path of [
    '/auth/register',
    '/auth/login',
    '/auth/refresh',
    '/auth/logout',
    '/auth/logout-all',
  ]) {
    for (const origin of [undefined, 'http://evil.example', 'null']) {
      const response = await fetch(baseUrl + path, {
        method: 'POST',
        headers: {
          ...(origin ? { origin } : {}),
          cookie: first.cookie,
          authorization: `Bearer ${first.accessToken}`,
        },
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(await response.json(), {
        statusCode: 403,
        message: 'Invalid request origin',
        error: 'Forbidden',
      });
    }
  }
  assert.equal(sessions.sessions.size, count);
  assert.equal(
    (await post('/auth/refresh', undefined, { cookie: first.cookie })).status,
    200,
  );
});

void test('CORS permits credentials for only the exact frontend origin and health remains public', async () => {
  const options = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'OPTIONS',
    headers: {
      origin: config.frontendOrigin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get('access-control-allow-origin'),
    config.frontendOrigin,
  );
  assert.equal(options.headers.get('access-control-allow-credentials'), 'true');
  const rejected = await post('/auth/refresh', undefined, {
    origin: 'https://evil.example',
  });
  assert.equal(rejected.status, 403);
  assert.notEqual(rejected.headers.get('access-control-allow-origin'), '*');
  assert.notEqual(
    rejected.headers.get('access-control-allow-origin'),
    'https://evil.example',
  );
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

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
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'jti', 'sub']);
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
