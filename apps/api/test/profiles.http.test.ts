import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfilesRepository } from '../src/profiles/profiles.repository';
import { testEnvironment } from './support/test-environment';
import { InMemoryProfilesRepository } from './support/in-memory-profiles.repository';

const config = testEnvironment();
const repository = new InMemoryProfilesRepository();
let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;

before(async () => {
  // Real controller, DTOs, services and access guard; no Docker in normal tests.
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(config)
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(ProfilesRepository)
    .useValue(repository)
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

function identity() {
  const userId = randomUUID();
  return { userId, token: jwt.sign({ sub: userId }) };
}

function request(
  method: string,
  token?: string,
  body?: unknown,
  path = '/profile',
) {
  return fetch(baseUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

async function profileResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  const body = object(await response.json());
  assert.deepEqual(Object.keys(body).sort(), [
    'birthDate',
    'createdAt',
    'displayName',
    'experienceLevel',
    'heightCm',
    'trainingGoal',
    'unitSystem',
    'updatedAt',
  ]);
  assert.equal(typeof body.createdAt, 'string');
  assert.equal(typeof body.updatedAt, 'string');
  assert.equal(response.headers.get('set-cookie'), null);
  return body;
}

void test('all Profile routes require a valid Bearer access token', async () => {
  for (const method of ['POST', 'GET', 'PATCH']) {
    for (const token of [
      undefined,
      'invalid',
      jwt.sign({ sub: randomUUID() }, { expiresIn: -1 }),
      jwt.sign({ sub: randomUUID() }, { secret: 'untrusted-test-signing-key' }),
    ]) {
      const response = await request(
        method,
        token,
        method === 'GET' ? undefined : { displayName: 'Alex' },
      );
      assert.equal(response.status, 401);
      const body = object(await response.json());
      assert.equal(body.message, 'Invalid access token');
    }
  }
});

void test('Profile POST 201, GET 200 and PATCH 200 preserve safe fields, defaults and partial semantics', async () => {
  const { token, userId } = identity();
  const created = await profileResponse(
    await request('POST', token, { displayName: '  Álex  García  ' }),
    201,
  );
  assert.equal(created.displayName, 'Álex  García');
  assert.equal(created.unitSystem, 'METRIC');
  for (const field of [
    'birthDate',
    'heightCm',
    'experienceLevel',
    'trainingGoal',
  ])
    assert.equal(created[field], null);
  const storedUpdatedAt = repository.records.get(userId)?.updatedAt;
  assert.deepEqual(
    await profileResponse(await request('GET', token), 200),
    created,
  );
  assert.equal(repository.records.get(userId)?.updatedAt, storedUpdatedAt);
  const changed = await profileResponse(
    await request('PATCH', token, {
      birthDate: '1998-04-15',
      heightCm: 180,
      experienceLevel: 'INTERMEDIATE',
      trainingGoal: 'STRENGTH',
      unitSystem: 'IMPERIAL',
    }),
    200,
  );
  assert.equal(changed.birthDate, '1998-04-15');
  assert.equal(changed.displayName, created.displayName);
  assert.equal(changed.createdAt, created.createdAt);
  assert.equal(changed.heightCm, 180);
  const renamed = await profileResponse(
    await request('PATCH', token, { displayName: '  Alex G  ' }),
    200,
  );
  assert.equal(renamed.displayName, 'Alex G');
  assert.equal(renamed.birthDate, '1998-04-15');
  assert.equal(renamed.unitSystem, 'IMPERIAL');
});

void test('duplicate Profile creation returns 409, does not upsert and concurrent creates have only one winner', async () => {
  const { token } = identity();
  const responses = await Promise.all([
    request('POST', token, { displayName: 'Alex' }),
    request('POST', token, { displayName: 'Alex' }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const duplicate = await request('POST', token, {
    displayName: 'Replacement',
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {
    statusCode: 409,
    message: 'A profile already exists for this user.',
    error: 'Conflict',
  });
  assert.equal(
    (await profileResponse(await request('GET', token), 200)).displayName,
    'Alex',
  );
});

void test('Profile GET and PATCH return 404 when missing and never create a profile as a side effect', async () => {
  const { token, userId } = identity();
  for (const method of ['GET', 'PATCH']) {
    const response = await request(
      method,
      token,
      method === 'PATCH' ? { heightCm: 180 } : undefined,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      statusCode: 404,
      message: 'Profile not found.',
      error: 'Not Found',
    });
    assert.equal(repository.records.has(userId), false);
  }
});

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const invalidFields: Array<{ name: string; value: Record<string, unknown> }> = [
  { name: 'empty displayName', value: { displayName: '' } },
  { name: 'whitespace displayName', value: { displayName: ' \t\n ' } },
  { name: 'overlong displayName', value: { displayName: 'a'.repeat(81) } },
  { name: 'null displayName', value: { displayName: null } },
  { name: 'non-string displayName', value: { displayName: 123 } },
  { name: 'height below 50', value: { heightCm: 49 } },
  { name: 'height above 300', value: { heightCm: 301 } },
  { name: 'decimal height', value: { heightCm: 180.5 } },
  { name: 'numeric-string height', value: { heightCm: '180' } },
  { name: 'boolean height', value: { heightCm: true } },
  {
    name: 'future birth date',
    value: { birthDate: tomorrow.toISOString().slice(0, 10) },
  },
  { name: 'impossible birth date', value: { birthDate: '2026-02-31' } },
  { name: 'non-leap birthday', value: { birthDate: '1900-02-29' } },
  {
    name: 'timestamp instead of date',
    value: { birthDate: '1998-04-15T00:00:00.000Z' },
  },
  { name: 'ambiguous date format', value: { birthDate: '15/04/1998' } },
  { name: 'date not zero-padded', value: { birthDate: '1998-4-5' } },
  { name: 'numeric birth date', value: { birthDate: 19980415 } },
  { name: 'date with outer spaces', value: { birthDate: ' 1998-04-15 ' } },
  { name: 'year zero', value: { birthDate: '0000-01-01' } },
  { name: 'invalid experience enum', value: { experienceLevel: 'EXPERT' } },
  { name: 'unsupported training goal', value: { trainingGoal: 'WEIGHT_LOSS' } },
  { name: 'invalid units', value: { unitSystem: 'metric' } },
  { name: 'null units', value: { unitSystem: null } },
  ...[
    'unknown',
    'userId',
    'createdAt',
    'updatedAt',
    'email',
    'passwordHash',
    'weight',
    'bodyWeight',
    'bodyFat',
    'waist',
    'chest',
    'arms',
    'thighs',
    'avatarUrl',
  ].map((field) => ({
    name: `forbidden ${field}`,
    value: { [field]: 'not-allowed' },
  })),
];

void test('both Profile DTOs reject invalid, unsupported and extra fields without changing persistence', async (context) => {
  const owner = identity();
  await request('POST', owner.token, { displayName: 'Original' });
  const beforeUpdate = repository.records.get(owner.userId);
  for (const method of ['POST', 'PATCH']) {
    for (const candidate of invalidFields) {
      await context.test(`${method}: ${candidate.name}`, async () => {
        const target = method === 'POST' ? identity() : owner;
        const response = await request(method, target.token, {
          displayName: 'Alex',
          ...candidate.value,
        });
        assert.equal(response.status, 400);
        const body = object(await response.json());
        assert.equal(body.statusCode, 400);
        assert.equal('stack' in body, false);
        if (method === 'POST')
          assert.equal(repository.records.has(target.userId), false);
        else
          assert.deepEqual(repository.records.get(owner.userId), beforeUpdate);
      });
    }
  }
});

void test('create requires displayName; empty and non-object updates are rejected', async () => {
  const { token } = identity();
  assert.equal((await request('POST', token, {})).status, 400);
  await request('POST', token, { displayName: 'Alex' });
  for (const body of [{}, null, [], 'invalid'])
    assert.equal((await request('PATCH', token, body)).status, 400);
});

void test('nullable Profile fields are cleared explicitly; omitted fields preserve their previous values', async () => {
  const { token } = identity();
  await profileResponse(
    await request('POST', token, {
      displayName: 'Alex',
      birthDate: '2000-02-29',
      heightCm: 180,
      experienceLevel: 'ADVANCED',
      trainingGoal: 'ENDURANCE',
      unitSystem: 'IMPERIAL',
    }),
    201,
  );
  const partial = await profileResponse(
    await request('PATCH', token, { heightCm: null }),
    200,
  );
  assert.equal(partial.heightCm, null);
  assert.equal(partial.birthDate, '2000-02-29');
  assert.equal(partial.experienceLevel, 'ADVANCED');
  const cleared = await profileResponse(
    await request('PATCH', token, {
      birthDate: null,
      experienceLevel: null,
      trainingGoal: null,
    }),
    200,
  );
  for (const field of [
    'birthDate',
    'heightCm',
    'experienceLevel',
    'trainingGoal',
  ])
    assert.equal(cleared[field], null);
  assert.equal(cleared.unitSystem, 'IMPERIAL');
  assert.equal(cleared.displayName, 'Alex');
  const other = identity();
  await profileResponse(
    await request('POST', other.token, {
      displayName: 'Other',
      birthDate: null,
      heightCm: null,
      experienceLevel: null,
      trainingGoal: null,
    }),
    201,
  );
});

void test('Profile accepts height boundaries, Unicode names, all declared enums and today without minimum age', async () => {
  const { token } = identity();
  const name = '🏋'.repeat(80);
  const created = await profileResponse(
    await request('POST', token, {
      displayName: ` ${name} `,
      birthDate: new Date().toISOString().slice(0, 10),
      heightCm: 50,
      experienceLevel: 'BEGINNER',
      trainingGoal: 'GENERAL_FITNESS',
    }),
    201,
  );
  assert.equal(created.displayName, name);
  assert.equal(created.heightCm, 50);
  const updated = await profileResponse(
    await request('PATCH', token, {
      heightCm: 300,
      trainingGoal: 'MUSCLE_GAIN',
    }),
    200,
  );
  assert.equal(updated.heightCm, 300);
  assert.equal(updated.trainingGoal, 'MUSCLE_GAIN');
});

void test('Profile authorization isolates A from B and rejects userId in body/query; no arbitrary-user route exists', async () => {
  const a = identity();
  const b = identity();
  await request('POST', a.token, { displayName: 'Profile A' });
  await request('POST', b.token, { displayName: 'Profile B' });
  assert.equal(
    (await profileResponse(await request('GET', a.token), 200)).displayName,
    'Profile A',
  );
  assert.equal(
    (await profileResponse(await request('GET', b.token), 200)).displayName,
    'Profile B',
  );
  for (const method of ['POST', 'PATCH']) {
    assert.equal(
      (
        await request(method, a.token, {
          displayName: 'Intrusion',
          userId: b.userId,
        })
      ).status,
      400,
    );
  }
  for (const method of ['GET', 'POST', 'PATCH']) {
    const body = method === 'GET' ? undefined : { displayName: 'Intrusion' };
    assert.equal(
      (await request(method, a.token, body, `/profile?userId=${b.userId}`))
        .status,
      400,
    );
    assert.equal(
      (await request(method, a.token, body, `/profile/${b.userId}`)).status,
      404,
    );
  }
  await profileResponse(
    await request('PATCH', a.token, { displayName: 'A updated' }),
    200,
  );
  assert.equal(
    (await profileResponse(await request('GET', b.token), 200)).displayName,
    'Profile B',
  );
});

void test('Profile persistence failures return a generic 500 without Prisma details or query data', async (context) => {
  context.mock.method(repository, 'findByUserId', async () => {
    throw new Error('Internal database query data');
  });
  const response = await request('GET', identity().token);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
