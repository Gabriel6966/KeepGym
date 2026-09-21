import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { ExercisesRepository } from '../src/exercises/exercises.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import { testEnvironment } from './support/test-environment';
import { WorkoutTemplatesPrismaFake } from './support/workout-templates-prisma.fake';

const db = new WorkoutTemplatesPrismaFake();
let app: INestApplication;
let base: string;
let tokenA: string;
let tokenB: string;
const root = '/workout-templates';
const targets = { targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 };
const first = db.catalog[0];
const second = db.catalog[1];
const third = db.catalog[2];
assert.ok(first && second && third);

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(ExercisesRepository)
    .useValue({
      findById: async (id: string) =>
        db.catalog.find((item) => item.id === id && item.isActive) ?? null,
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  tokenA = jwt.sign({ sub: randomUUID() });
  tokenB = jwt.sign({ sub: randomUUID() });
});
after(async () => {
  await app?.close();
});

function request(method: string, path: string, body?: unknown, token = tokenA) {
  return fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
async function result(
  method: string,
  path: string,
  body?: unknown,
  token = tokenA,
  status = 200,
) {
  const response = await request(method, path, body, token);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('set-cookie'), null);
  return object(await response.json());
}
async function create(
  token = tokenA,
  name = 'Push',
): Promise<Record<string, unknown> & { id: string }> {
  const value = await result(
    'POST',
    root,
    { name, description: 'Original' },
    token,
    201,
  );
  assert.equal(typeof value.id, 'string');
  return { ...value, id: String(value.id) };
}
async function add(
  id: string,
  exerciseId = first!.id,
  token = tokenA,
): Promise<Record<string, unknown> & { id: string }> {
  const value = await result(
    'POST',
    root + '/' + id + '/exercises',
    { exerciseId, ...targets },
    token,
    201,
  );
  assert.equal(typeof value.id, 'string');
  return { ...value, id: String(value.id) };
}
function entries(value: Record<string, unknown>) {
  assert.ok(Array.isArray(value.exercises));
  return value.exercises.map(object);
}

void test('all template routes require a valid access token', async () => {
  const id = randomUUID();
  const child = randomUUID();
  for (const [method, path, body] of [
    ['POST', root, { name: 'Push' }],
    ['GET', root, undefined],
    ['GET', root + '/' + id, undefined],
    ['PATCH', root + '/' + id, { name: 'Push' }],
    ['DELETE', root + '/' + id, undefined],
    [
      'POST',
      root + '/' + id + '/exercises',
      { exerciseId: first.id, ...targets },
    ],
    ['PATCH', root + '/' + id + '/exercises/' + child, { targetSets: 2 }],
    ['DELETE', root + '/' + id + '/exercises/' + child, undefined],
    ['PUT', root + '/' + id + '/exercises/order', { templateExerciseIds: [] }],
  ] as const) {
    for (const token of ['', 'malformed'])
      assert.equal((await request(method, path, body, token)).status, 401);
  }
});

void test('template HTTP create/list/detail/update/archive has consistent safe representations and no physical delete', async () => {
  const template = await create(tokenA, '  HTTP lifecycle  ');
  assert.equal(template.name, 'HTTP lifecycle');
  assert.deepEqual(Object.keys(template).sort(), [
    'createdAt',
    'description',
    'exercises',
    'id',
    'name',
    'updatedAt',
  ]);
  assert.deepEqual(template.exercises, []);
  const detail = await result('GET', root + '/' + template.id);
  assert.deepEqual(detail, template);
  const list = await result('GET', root + '?q=%20HTTP%20&page=1&limit=1');
  assert.equal(list.total, 1);
  assert.equal(list.totalPages, 1);
  assert.equal(list.page, 1);
  assert.equal(list.limit, 1);
  assert.ok(Array.isArray(list.items));
  assert.deepEqual(list.items, [template]);
  const updated = await result('PATCH', root + '/' + template.id, {
    name: 'Updated',
  });
  assert.equal(updated.description, 'Original');
  assert.equal(
    (await result('PATCH', root + '/' + template.id, { description: null }))
      .description,
    null,
  );
  assert.equal(
    (await request('PATCH', root + '/' + template.id, {})).status,
    400,
  );
  const archived = await request('DELETE', root + '/' + template.id);
  assert.equal(archived.status, 204);
  assert.equal(await archived.text(), '');
  assert.ok(db.templates.get(template.id)?.archivedAt instanceof Date);
  assert.equal((await request('GET', root + '/' + template.id)).status, 404);
  assert.equal((await request('DELETE', root + '/' + template.id)).status, 404);
  assert.equal((await result('GET', root + '?q=Updated')).total, 0);
});

void test('template HTTP add/update/reorder/remove is ordered, handles null/zero, and rejects incomplete or foreign orders without writes', async () => {
  const template = await create();
  const a = await add(template.id, first.id);
  const b = await add(template.id, second.id);
  const c = await add(template.id, third.id);
  assert.deepEqual([a.position, b.position, c.position], [1, 2, 3]);
  assert.equal(a.restSeconds, 90);
  assert.equal(a.notes, null);
  assert.deepEqual(Object.keys(a).sort(), [
    'exercise',
    'id',
    'notes',
    'position',
    'restSeconds',
    'targetRepsMax',
    'targetRepsMin',
    'targetSets',
  ]);
  assert.deepEqual(Object.keys(object(a.exercise)).sort(), [
    'equipment',
    'id',
    'isAvailable',
    'movementPattern',
    'name',
    'primaryMuscle',
    'slug',
  ]);
  assert.equal(
    (
      await request('POST', root + '/' + template.id + '/exercises', {
        exerciseId: first.id,
        ...targets,
      })
    ).status,
    409,
  );
  const entryPath = root + '/' + template.id + '/exercises/' + a.id;
  assert.equal(
    (
      await result('PATCH', entryPath, {
        restSeconds: 0,
        notes: 'Note',
        targetRepsMin: 8,
      })
    ).restSeconds,
    0,
  );
  assert.equal((await result('PATCH', entryPath, { notes: null })).notes, null);
  assert.equal(
    (await request('PATCH', entryPath, { targetRepsMax: 7 })).status,
    400,
  );
  const orderPath = root + '/' + template.id + '/exercises/order';
  const reordered = await result('PUT', orderPath, {
    templateExerciseIds: [c.id, a.id, b.id],
  });
  assert.deepEqual(
    entries(reordered).map((entry) => entry.id),
    [c.id, a.id, b.id],
  );
  assert.deepEqual(
    entries(reordered).map((entry) => entry.position),
    [1, 2, 3],
  );
  for (const ids of [
    [c.id, a.id],
    [c.id, a.id, a.id],
    [c.id, a.id, randomUUID()],
    [],
    [c.id, a.id, b.id, randomUUID()],
  ]) {
    assert.equal(
      (await request('PUT', orderPath, { templateExerciseIds: ids })).status,
      400,
    );
    assert.deepEqual(await result('GET', root + '/' + template.id), reordered);
  }
  assert.equal((await request('DELETE', entryPath)).status, 204);
  const compacted = await result('GET', root + '/' + template.id);
  assert.deepEqual(
    entries(compacted).map((entry) => entry.id),
    [c.id, b.id],
  );
  assert.deepEqual(
    entries(compacted).map((entry) => entry.position),
    [1, 2],
  );
  assert.equal(
    (await request('PATCH', entryPath, { targetSets: 2 })).status,
    404,
  );
  assert.equal((await request('DELETE', entryPath)).status, 404);
});

void test('HTTP catalog availability is checked only on add; inactive linked exercises remain visible', async () => {
  const template = await create();
  const entry = await add(template.id, first.id);
  first.isActive = false;
  try {
    const detail = await result('GET', root + '/' + template.id);
    assert.equal(entries(detail)[0]?.id, entry.id);
    assert.equal(object(entries(detail)[0]?.exercise).isAvailable, false);
    const other = await create();
    assert.equal(
      (
        await request('POST', root + '/' + other.id + '/exercises', {
          exerciseId: first.id,
          ...targets,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request('POST', root + '/' + other.id + '/exercises', {
          exerciseId: randomUUID(),
          ...targets,
        })
      ).status,
      404,
    );
  } finally {
    first.isActive = true;
  }
});

void test('HTTP isolation conceals every operation on B from A and prevents cross-template child use', async () => {
  const a = await create(tokenA, 'Owner A');
  const b = await create(tokenB, 'Owner B');
  const entry = await add(b.id, first.id, tokenB);
  const before = await result('GET', root + '/' + b.id, undefined, tokenB);
  const path = root + '/' + b.id;
  for (const [method, url, body] of [
    ['GET', path, undefined],
    ['PATCH', path, { name: 'Attack' }],
    ['DELETE', path, undefined],
    ['POST', path + '/exercises', { exerciseId: second.id, ...targets }],
    ['PATCH', path + '/exercises/' + entry.id, { targetSets: 2 }],
    ['DELETE', path + '/exercises/' + entry.id, undefined],
    ['PUT', path + '/exercises/order', { templateExerciseIds: [entry.id] }],
  ] as const) {
    const response = await request(method, url, body);
    assert.equal(response.status, 404);
    assert.equal(
      object(await response.json()).message,
      'Workout template not found.',
    );
  }
  assert.deepEqual(await result('GET', path, undefined, tokenB), before);
  const aEntries = root + '/' + a.id + '/exercises';
  assert.equal(
    (await request('PATCH', aEntries + '/' + entry.id, { targetSets: 2 }))
      .status,
    404,
  );
  assert.equal(
    (await request('DELETE', aEntries + '/' + entry.id)).status,
    404,
  );
  assert.equal(
    (
      await request('PUT', aEntries + '/order', {
        templateExerciseIds: [entry.id],
      })
    ).status,
    400,
  );
  assert.equal((await result('GET', root + '?q=Owner%20B')).total, 0);
});

void test('HTTP DTOs strictly reject invalid names, extra/immutable fields and oversized descriptions', async (context) => {
  for (const body of [
    {},
    { name: '' },
    { name: '  ' },
    { name: null },
    { name: 3 },
    { name: 'x'.repeat(121) },
    { name: 'Valid', description: 'x'.repeat(1001) },
    { name: 'Valid', description: 42 },
    ...[
      'userId',
      'id',
      'archivedAt',
      'createdAt',
      'updatedAt',
      'exercises',
      'unknown',
    ].map((key) => ({ name: 'Valid', [key]: randomUUID() })),
  ]) {
    await context.test(JSON.stringify(body).slice(0, 90), async () => {
      assert.equal((await request('POST', root, body)).status, 400);
    });
  }
  const template = await create();
  for (const body of [
    {},
    { name: null },
    { name: ' ' },
    { name: 'x'.repeat(121) },
    { description: 1 },
    { description: 'x'.repeat(1001) },
    { userId: randomUUID() },
    { exercises: [] },
    { archivedAt: null },
  ]) {
    assert.equal(
      (await request('PATCH', root + '/' + template.id, body)).status,
      400,
    );
  }
  assert.equal(
    (await request('POST', root, { name: 'x'.repeat(120), description: null }))
      .status,
    201,
  );
});

void test('HTTP add/update target DTOs reject nonintegers, strings, null required fields, ranges and immutable input', async (context) => {
  const template = await create();
  const path = root + '/' + template.id + '/exercises';
  const invalid = [
    { exerciseId: 'invalid' },
    { targetSets: 0 },
    { targetSets: 21 },
    { targetSets: 1.5 },
    { targetSets: '4' },
    { targetSets: null },
    { targetRepsMin: 0 },
    { targetRepsMax: 101 },
    { targetRepsMin: 9, targetRepsMax: 8 },
    { restSeconds: -1 },
    { restSeconds: 1801 },
    { restSeconds: '90' },
    { restSeconds: null },
    { notes: 'x'.repeat(501) },
    { notes: 42 },
    { position: 1 },
    { userId: randomUUID() },
    { workoutTemplateId: template.id },
    { id: randomUUID() },
  ];
  for (const changes of invalid) {
    await context.test(JSON.stringify(changes).slice(0, 90), async () => {
      assert.equal(
        (
          await request('POST', path, {
            exerciseId: first.id,
            ...targets,
            ...changes,
          })
        ).status,
        400,
      );
    });
  }
  const entry = await add(template.id);
  for (const body of [
    {},
    { targetSets: '3' },
    { targetSets: null },
    { restSeconds: null },
    { targetRepsMin: 9 },
    { notes: 'x'.repeat(501) },
    { position: 2 },
    { exerciseId: second.id },
    { workoutTemplateId: randomUUID() },
    { id: randomUUID() },
  ]) {
    assert.equal(
      (await request('PATCH', path + '/' + entry.id, body)).status,
      400,
    );
  }
  assert.equal(
    (
      await request('POST', path, {
        exerciseId: second.id,
        targetSets: 20,
        targetRepsMin: 100,
        targetRepsMax: 100,
        restSeconds: 1800,
        notes: 'x'.repeat(500),
      })
    ).status,
    201,
  );
});

void test('HTTP query/UUID/order validation rejects arbitrary coercion and selectors', async (context) => {
  for (const query of [
    'foo=bar',
    'userId=' + randomUUID(),
    'archivedAt=null',
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1e2',
    'page=01',
    'page=%201%20',
    'page=1&page=2',
    'page=2147483648&limit=100',
    'limit=0',
    'limit=101',
    'limit=1.5',
    'q=',
    'q=%20',
    'q=x&q=y',
    'q=' + 'x'.repeat(101),
  ]) {
    await context.test(query.slice(0, 90), async () => {
      assert.equal((await request('GET', root + '?' + query)).status, 400);
    });
  }
  const template = await create();
  for (const method of ['GET', 'PATCH', 'DELETE'])
    assert.equal(
      (
        await request(
          method,
          root + '/invalid',
          method === 'PATCH' ? { name: 'Valid' } : undefined,
        )
      ).status,
      400,
    );
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    assert.equal(
      (
        await request(
          method,
          root + '/' + template.id + '?userId=' + randomUUID(),
          method === 'PATCH' ? { name: 'Valid' } : undefined,
        )
      ).status,
      400,
    );
  }
  for (const body of [
    {},
    { templateExerciseIds: null },
    { templateExerciseIds: 'x' },
    { templateExerciseIds: ['invalid'] },
    { templateExerciseIds: [], extra: true },
  ]) {
    assert.equal(
      (
        await request(
          'PUT',
          root + '/' + template.id + '/exercises/order',
          body,
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request('PATCH', root + '/' + template.id + '/exercises/invalid', {
        targetSets: 2,
      })
    ).status,
    400,
  );
  assert.equal((await request('GET', root + '/' + randomUUID())).status, 404);
  assert.equal((await result('GET', '/health')).status, 'ok');
});
