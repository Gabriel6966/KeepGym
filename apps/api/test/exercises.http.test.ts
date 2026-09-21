import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { ExercisesRepository } from '../src/exercises/exercises.repository';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryExercisesRepository } from './support/in-memory-exercises.repository';
import { testEnvironment } from './support/test-environment';

const repository = new InMemoryExercisesRepository();
const inactiveId = randomUUID();
let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let token: string;

before(async () => {
  const example = repository.records[0];
  assert.ok(example);
  repository.records.push({
    ...example,
    id: inactiveId,
    slug: 'inactive-bench',
    isActive: false,
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(ExercisesRepository)
    .useValue(repository)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  jwt = app.get(JwtService);
  token = jwt.sign({ sub: randomUUID() });
});

after(async () => {
  await app?.close();
});

function get(path: string, accessToken = token) {
  return fetch(baseUrl + path, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function assertPublic(value: unknown): Record<string, unknown> {
  const exercise = object(value);
  assert.deepEqual(Object.keys(exercise).sort(), [
    'description',
    'equipment',
    'id',
    'instructions',
    'movementPattern',
    'name',
    'primaryMuscle',
    'secondaryMuscles',
    'slug',
  ]);
  assert.ok(
    Array.isArray(exercise.instructions) &&
      exercise.instructions.every((step: unknown) => typeof step === 'string'),
  );
  assert.ok(Array.isArray(exercise.secondaryMuscles));
  return exercise;
}

async function list(path = '/exercises', accessToken = token) {
  const response = await get(path, accessToken);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = object(await response.json());
  assert.deepEqual(Object.keys(body).sort(), [
    'items',
    'limit',
    'page',
    'total',
    'totalPages',
  ]);
  assert.ok(Array.isArray(body.items));
  const items = body.items.map(assertPublic);
  assert.ok(
    typeof body.page === 'number' &&
      typeof body.limit === 'number' &&
      typeof body.total === 'number' &&
      typeof body.totalPages === 'number',
  );
  return {
    items,
    page: body.page,
    limit: body.limit,
    total: body.total,
    totalPages: body.totalPages,
  };
}

void test('both exercise routes require valid Bearer authentication', async () => {
  const first = repository.records[0];
  assert.ok(first);
  for (const accessToken of [
    '',
    'malformed',
    jwt.sign({ sub: randomUUID() }, { expiresIn: -1 }),
    jwt.sign(
      { sub: randomUUID() },
      { secret: randomBytes(32).toString('hex') },
    ),
  ]) {
    for (const path of ['/exercises', `/exercises/${first.id}`])
      assert.equal((await get(path, accessToken)).status, 401);
  }
});

void test('authenticated exercise list returns a bounded active-only public catalog shared by all users', async () => {
  const result = await list();
  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
  assert.equal(result.total, 24);
  assert.equal(result.totalPages, 2);
  assert.equal(result.items.length, 20);
  assert.ok(result.items.every((item) => item.id !== inactiveId));
  const otherUser = jwt.sign({ sub: randomUUID() });
  assert.deepEqual(await list('/exercises', otherUser), result);
});

const filterCases = [
  { query: 'q=%20BeNcH%20', slug: 'barbell-bench-press', total: 1 },
  { query: 'q=BARBELL-BENCH', slug: 'barbell-bench-press', total: 1 },
  {
    query: 'primaryMuscle=CHEST',
    field: 'primaryMuscle',
    value: 'CHEST',
    total: 3,
  },
  {
    query: 'equipment=DUMBBELL',
    field: 'equipment',
    value: 'DUMBBELL',
    total: 6,
  },
  {
    query: 'movementPattern=HINGE',
    field: 'movementPattern',
    value: 'HINGE',
    total: 3,
  },
  {
    query:
      'q=press&primaryMuscle=CHEST&equipment=DUMBBELL&movementPattern=HORIZONTAL_PUSH',
    slug: 'incline-dumbbell-press',
    total: 1,
  },
];
for (const candidate of filterCases) {
  void test(`exercise HTTP filters: ${candidate.query}`, async () => {
    const result = await list('/exercises?' + candidate.query);
    assert.equal(result.total, candidate.total);
    if (candidate.slug) assert.equal(result.items[0]?.slug, candidate.slug);
    if (candidate.field)
      assert.ok(
        result.items.every((item) => item[candidate.field] === candidate.value),
      );
  });
}

void test('exercise HTTP pagination has stable order, no overlapping pages and consistent metadata', async () => {
  const first = await list('/exercises?page=1&limit=10');
  const second = await list('/exercises?page=2&limit=10');
  const third = await list('/exercises?page=3&limit=10');
  const combined = [...first.items, ...second.items, ...third.items];
  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 10);
  assert.equal(third.items.length, 4);
  assert.equal(second.page, 2);
  assert.equal(second.limit, 10);
  assert.equal(second.totalPages, 3);
  assert.equal(new Set(combined.map((item) => item.id)).size, 24);
  assert.deepEqual(await list('/exercises?page=2&limit=10'), second);
  const names = combined.map((item) => String(item.name));
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  const outside = await list('/exercises?page=10&limit=10');
  assert.equal(outside.items.length, 0);
  assert.equal(outside.total, 24);
  const maximum = await list('/exercises?limit=100');
  assert.equal(maximum.items.length, 24);
});

const invalidQueries = [
  'primaryMuscle=NECK',
  'primaryMuscle=chest',
  'equipment=CHAIR',
  'movementPattern=RUN',
  'page=0',
  'page=-1',
  'page=1.5',
  'page=1e2',
  'page=0x10',
  'page=01',
  'page=%2B1',
  'page=%201%20',
  'page=',
  'page=true',
  'page=Infinity',
  'page=9007199254740992',
  'page=2147483648&limit=100',
  'page=1&page=2',
  'limit=0',
  'limit=101',
  'limit=-1',
  'limit=1.5',
  'limit=20junk',
  'limit=',
  'limit=1&limit=2',
  'q=',
  'q=%20%20',
  'q=' + 'x'.repeat(101),
  'q=bench&q=deadlift',
  'q[x]=bench',
  'equipment=BARBELL&equipment=DUMBBELL',
  'foo=bar',
  'userId=' + randomUUID(),
  'isActive=false',
  'sort=createdAt',
];

void test('exercise query validation rejects invalid enums, pagination, searches and unknown fields', async (context) => {
  for (const query of invalidQueries) {
    await context.test(query, async () => {
      const response = await get('/exercises?' + query);
      assert.equal(response.status, 400);
      const body = object(await response.json());
      assert.equal(body.statusCode, 400);
      assert.equal('stack' in body, false);
      assert.equal('meta' in body, false);
    });
  }
});

void test('empty exercise search results return zero metadata and literal wildcard characters do not match everything', async () => {
  for (const q of ['no-such-exercise', '%', '_', '\\', 'x'.repeat(100)]) {
    const result = await list('/exercises?q=' + encodeURIComponent(q));
    assert.equal(result.total, 0);
    assert.equal(result.totalPages, 0);
    assert.deepEqual(result.items, []);
  }
});

void test('exercise detail returns 200 for an active UUID, 404 for missing/inactive and 400 for malformed IDs', async () => {
  const first = repository.records[0];
  assert.ok(first);
  const response = await get('/exercises/' + first.id);
  assert.equal(response.status, 200);
  assert.equal(assertPublic(await response.json()).slug, first.slug);
  for (const id of [randomUUID(), inactiveId]) {
    const missing = await get('/exercises/' + id);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      statusCode: 404,
      message: 'Exercise not found.',
      error: 'Not Found',
    });
  }
  for (const id of ['invalid', '123', first.slug])
    assert.equal((await get('/exercises/' + id)).status, 400);
  for (const query of ['foo=bar', 'userId=' + randomUUID(), 'isActive=true'])
    assert.equal((await get(`/exercises/${first.id}?${query}`)).status, 400);
});

void test('exercise HTTP exposes no POST, PUT, PATCH or DELETE operations', async () => {
  const first = repository.records[0];
  assert.ok(first);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/exercises', '/exercises/' + first.id]) {
      const response = await fetch(baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Not allowed' }),
      });
      assert.equal(response.status, 404);
    }
  }
});

void test('exercise HTTP sanitizes persistence failures without exposing internal details', async (context) => {
  context.mock.method(repository, 'findMany', async () => {
    throw new Error('Internal query data');
  });
  const response = await get('/exercises');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
