import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import {
  sourceTemplate,
  WorkoutSessionsPrismaFake,
} from './support/workout-sessions-prisma.fake';
import { testEnvironment } from './support/test-environment';

const db = new WorkoutSessionsPrismaFake();
const root = '/workout-sessions';
let app: INestApplication;
let base: string;
let jwt: JwtService;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue(db)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  jwt = app.get(JwtService);
});
after(async () => {
  await app?.close();
});

function fixture(count = 3) {
  const user = randomUUID();
  const source = sourceTemplate(user, count);
  db.templates.set(source.id, source);
  return { user, source, token: jwt.sign({ sub: user }) };
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function request(method: string, path: string, token: string, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function result(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  status = 200,
) {
  const response = await request(method, path, token, body);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('set-cookie'), null);
  return object(await response.json());
}
async function start(
  templateId: string,
  token: string,
): Promise<Record<string, unknown> & { id: string }> {
  const value = await result(
    'POST',
    root,
    token,
    { workoutTemplateId: templateId },
    201,
  );
  assert.equal(typeof value.id, 'string');
  return { ...value, id: String(value.id) };
}

void test('all workout session routes require valid Bearer authentication', async () => {
  const { source, user } = fixture();
  for (const token of [
    '',
    'malformed',
    jwt.sign({ sub: user }, { expiresIn: -1 }),
  ]) {
    for (const [method, path, body] of [
      ['POST', root, { workoutTemplateId: source.id }],
      ['GET', root, undefined],
      ['GET', root + '/' + randomUUID(), undefined],
      ['POST', root + '/' + randomUUID() + '/complete', undefined],
      ['POST', root + '/' + randomUUID() + '/cancel', undefined],
    ] as const)
      assert.equal((await request(method, path, token, body)).status, 401);
  }
});

void test('start returns 201 with explicit ordered snapshot, null notes/endedAt and no ownership or mutable-source payload', async () => {
  const { source, token } = fixture();
  const session = await start(source.id, token);
  assert.equal(session.status, 'IN_PROGRESS');
  assert.equal(session.name, source.name);
  assert.equal(session.endedAt, null);
  assert.equal(session.notes, null);
  assert.deepEqual(Object.keys(session).sort(), [
    'endedAt',
    'exercises',
    'id',
    'name',
    'notes',
    'startedAt',
    'status',
  ]);
  assert.ok(Array.isArray(session.exercises));
  assert.equal(session.exercises.length, 3);
  const entries = session.exercises.map(object);
  assert.deepEqual(
    entries.map((entry) => entry.position),
    [1, 2, 3],
  );
  for (const [index, entry] of entries.entries()) {
    const original = source.exercises[index];
    assert.ok(original);
    assert.deepEqual(Object.keys(entry).sort(), [
      'exercise',
      'id',
      'plannedNotes',
      'plannedRepsMax',
      'plannedRepsMin',
      'plannedRestSeconds',
      'plannedSets',
      'position',
      'sets',
    ]);
    assert.deepEqual(object(entry.exercise), {
      sourceExerciseId: original.exerciseId,
      ...original.exercise,
    });
    assert.equal(entry.plannedSets, original.targetSets);
    assert.equal(entry.plannedRepsMin, original.targetRepsMin);
    assert.equal(entry.plannedRepsMax, original.targetRepsMax);
    assert.equal(entry.plannedRestSeconds, original.restSeconds);
    assert.equal(entry.plannedNotes, original.notes);
  }
  assert.deepEqual(
    await result('GET', root + '/' + session.id, token),
    session,
  );
});

void test('HTTP start rejects missing/foreign/archived templates with identical 404 and empty templates with 409', async () => {
  const { source, token } = fixture();
  const other = fixture();
  const empty = fixture(0);
  source.archivedAt = new Date();
  for (const id of [randomUUID(), source.id, other.source.id]) {
    const response = await request('POST', root, token, {
      workoutTemplateId: id,
    });
    assert.equal(response.status, 404);
    assert.equal(
      object(await response.json()).message,
      'Workout template not found.',
    );
  }
  assert.equal(
    (
      await request('POST', root, empty.token, {
        workoutTemplateId: empty.source.id,
      })
    ).status,
    409,
  );
  assert.equal((await result('GET', root, empty.token)).total, 0);
});

void test('HTTP list filters status, paginates in stable order, returns summaries and never includes other owners', async () => {
  const { source, token } = fixture();
  const other = fixture();
  await start(other.source.id, other.token);
  const a = await start(source.id, token);
  await start(source.id, token);
  const c = await start(source.id, token);
  assert.equal(
    (await result('GET', root + '?status=IN_PROGRESS', token)).total,
    3,
  );
  await result('POST', root + '/' + a.id + '/complete', token);
  await result('POST', root + '/' + c.id + '/cancel', token);
  const first = await result('GET', root + '?page=1&limit=2', token);
  const second = await result('GET', root + '?page=2&limit=2', token);
  assert.equal(first.total, 3);
  assert.equal(first.totalPages, 2);
  assert.equal(second.page, 2);
  assert.equal(second.limit, 2);
  assert.ok(Array.isArray(first.items) && Array.isArray(second.items));
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 1);
  const items = [...first.items, ...second.items].map(object);
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  for (const item of items)
    assert.deepEqual(Object.keys(item).sort(), [
      'endedAt',
      'id',
      'name',
      'notes',
      'startedAt',
      'status',
    ]);
  assert.deepEqual(
    await result('GET', root + '?page=2&limit=2', token),
    second,
  );
  for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
    const filtered = await result('GET', root + '?status=' + status, token);
    assert.equal(filtered.total, 1);
    assert.ok(Array.isArray(filtered.items));
    assert.equal(object(filtered.items[0]).status, status);
  }
  const empty = await result('GET', root + '?page=99', token);
  assert.equal(empty.total, 3);
  assert.deepEqual(empty.items, []);
});

void test('HTTP complete/cancel has terminal states, 200 success, 409 retries and exactly one concurrent winner', async () => {
  const { source, token } = fixture();
  const a = await start(source.id, token);
  const b = await start(source.id, token);
  const complete = await result('POST', root + '/' + a.id + '/complete', token);
  const cancel = await result('POST', root + '/' + b.id + '/cancel', token, {});
  assert.equal(complete.status, 'COMPLETED');
  assert.equal(cancel.status, 'CANCELLED');
  assert.equal(typeof complete.endedAt, 'string');
  assert.equal(typeof cancel.endedAt, 'string');
  assert.deepEqual(complete.exercises, a.exercises);
  assert.deepEqual(cancel.exercises, b.exercises);
  for (const id of [a.id, b.id])
    for (const action of ['complete', 'cancel'])
      assert.equal(
        (await request('POST', root + '/' + id + '/' + action, token)).status,
        409,
      );
  const race = await start(source.id, token);
  const responses = await Promise.all(
    ['complete', 'cancel'].map((action) =>
      request('POST', root + '/' + race.id + '/' + action, token),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const winner = responses.find((response) => response.status === 200);
  assert.ok(winner);
  assert.deepEqual(
    await result('GET', root + '/' + race.id, token),
    await winner.json(),
  );
});

void test('HTTP ownership returns 404 for foreign get/complete/cancel without modifying the original history', async () => {
  const { source, token } = fixture();
  const other = fixture();
  const session = await start(source.id, token);
  for (const id of [session.id, randomUUID()]) {
    for (const [method, path] of [
      ['GET', root + '/' + id],
      ['POST', root + '/' + id + '/complete'],
      ['POST', root + '/' + id + '/cancel'],
    ] as const) {
      const response = await request(method, path, other.token);
      assert.equal(response.status, 404);
      assert.equal(
        object(await response.json()).message,
        'Workout session not found.',
      );
    }
  }
  assert.deepEqual(
    await result('GET', root + '/' + session.id, token),
    session,
  );
});

void test('HTTP snapshot survives source rename/targets/order/removal and changed catalog metadata, including template archive', async () => {
  const { source, token } = fixture();
  const session = await start(source.id, token);
  source.name = 'Push Heavy';
  source.exercises.reverse();
  source.exercises.pop();
  for (const entry of source.exercises) {
    entry.targetSets = 20;
    entry.targetRepsMin = 10;
    entry.targetRepsMax = 12;
    entry.restSeconds = 1800;
    entry.notes = 'Different plan';
    entry.exercise.name = 'Different exercise';
    entry.exercise.slug = 'different-exercise';
    entry.exercise.primaryMuscle = 'CORE';
    entry.exercise.secondaryMuscles = [];
    entry.exercise.equipment = 'OTHER';
    entry.exercise.movementPattern = 'OTHER';
  }
  source.archivedAt = new Date();
  assert.deepEqual(
    await result('GET', root + '/' + session.id, token),
    session,
  );
});

void test('HTTP start strictly validates UUID and rejects client-provided history/identity fields', async (context) => {
  const { source, token } = fixture();
  for (const body of [
    {},
    { workoutTemplateId: 'invalid' },
    { workoutTemplateId: null },
    { workoutTemplateId: 42 },
    { workoutTemplateId: [source.id] },
    [],
    ...[
      'userId',
      'name',
      'status',
      'startedAt',
      'endedAt',
      'notes',
      'exercises',
      'sets',
      'sourceTemplateId',
      'id',
    ].map((key) => ({ workoutTemplateId: source.id, [key]: 'untrusted' })),
  ])
    await context.test(JSON.stringify(body), async () => {
      assert.equal((await request('POST', root, token, body)).status, 400);
    });
});

void test('HTTP query and transition payload validation rejects unknown fields and arbitrary numeric coercion', async (context) => {
  const { source, token } = fixture();
  const session = await start(source.id, token);
  for (const query of [
    'foo=bar',
    'userId=' + randomUUID(),
    'q=Push',
    'status=OTHER',
    'status=in_progress',
    'status=',
    'status=COMPLETED&status=CANCELLED',
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
    'limit=20junk',
  ]) {
    await context.test(query, async () => {
      assert.equal(
        (await request('GET', root + '?' + query, token)).status,
        400,
      );
    });
  }
  for (const suffix of ['', '/complete', '/cancel']) {
    const method = suffix ? 'POST' : 'GET';
    assert.equal(
      (await request(method, root + '/invalid' + suffix, token)).status,
      400,
    );
    assert.equal(
      (
        await request(
          method,
          root + '/' + session.id + suffix + '?userId=' + randomUUID(),
          token,
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request('POST', root + '?extra=1', token, {
        workoutTemplateId: source.id,
      })
    ).status,
    400,
  );
  for (const action of ['complete', 'cancel'])
    for (const body of [
      { status: 'COMPLETED' },
      { userId: randomUUID() },
      { endedAt: new Date().toISOString() },
      { notes: 'not editable' },
      [],
    ])
      assert.equal(
        (
          await request(
            'POST',
            root + '/' + session.id + '/' + action,
            token,
            body,
          )
        ).status,
        400,
      );
  assert.deepEqual(
    await result('GET', root + '/' + session.id, token),
    session,
  );
});

void test('no HTTP snapshot editing/deletion endpoints are introduced and health remains unchanged', async () => {
  const { source, token } = fixture();
  const session = await start(source.id, token);
  for (const [method, path] of [
    ['PATCH', root + '/' + session.id],
    ['DELETE', root + '/' + session.id],
    ['POST', root + '/' + session.id + '/exercises'],
    ['PUT', root + '/' + session.id + '/exercises/order'],
    ['PATCH', root + '/' + session.id + '/exercises/' + randomUUID()],
  ] as const)
    assert.equal((await request(method, path, token, {})).status, 404);
  assert.deepEqual(await result('GET', '/health', ''), { status: 'ok' });
});
