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
async function fixture() {
  const user = randomUUID();
  const source = sourceTemplate(user);
  db.templates.set(source.id, source);
  const token = jwt.sign({ sub: user });
  const session = await result(
    'POST',
    '/workout-sessions',
    token,
    { workoutTemplateId: source.id },
    201,
  );
  const id = String(session.id);
  assert.ok(Array.isArray(session.exercises));
  const exercise = object(session.exercises[0]);
  const second = object(session.exercises[1]);
  const path =
    '/workout-sessions/' + id + '/exercises/' + String(exercise.id) + '/sets';
  return { user, token, session, id, exercise, second, path };
}
async function add(
  path: string,
  token: string,
  body: unknown = { loadKg: 80, reps: 8 },
): Promise<Record<string, unknown> & { id: string }> {
  const set = await result('POST', path, token, body, 201);
  assert.equal(typeof set.id, 'string');
  return { ...set, id: String(set.id) };
}
function sets(detail: Record<string, unknown>) {
  assert.ok(Array.isArray(detail.exercises));
  const entry = object(detail.exercises[0]);
  assert.ok(Array.isArray(entry.sets));
  return entry.sets.map(object);
}

void test('set endpoints require Bearer authentication without changing cookies', async () => {
  const f = await fixture();
  const set = await add(f.path, f.token);
  for (const token of [
    '',
    'malformed',
    jwt.sign({ sub: f.user }, { expiresIn: -1 }),
  ]) {
    for (const [method, path, body] of [
      ['POST', f.path, { loadKg: 80, reps: 8 }],
      ['PATCH', f.path + '/' + set.id, { reps: 9 }],
      ['DELETE', f.path + '/' + set.id, undefined],
    ] as const)
      assert.equal((await request(method, path, token, body)).status, 401);
  }
});

void test('POST decimal values round-trip as numbers, allocate positions and appear ordered alongside unchanged planned fields', async () => {
  const f = await fixture();
  const added = [];
  for (const loadKg of [80, 80.5, 82.25, 0, 0.29, 10000]) {
    const set = await add(f.path, f.token, {
      loadKg,
      reps: 8,
      rpe: 8.5,
      rir: 0,
    });
    added.push(set);
    assert.equal(set.loadKg, loadKg);
    assert.equal(set.rpe, 8.5);
    assert.equal(set.rir, 0);
    assert.equal(set.position, added.length);
    assert.equal(typeof set.completedAt, 'string');
    assert.deepEqual(Object.keys(set).sort(), [
      'completedAt',
      'id',
      'loadKg',
      'position',
      'reps',
      'rir',
      'rpe',
    ]);
  }
  const detail = await result('GET', '/workout-sessions/' + f.id, f.token);
  assert.deepEqual(sets(detail), added);
  assert.ok(Array.isArray(detail.exercises));
  const { sets: recorded, ...snapshot } = object(detail.exercises[0]);
  const { sets: empty, ...original } = f.exercise;
  assert.deepEqual(snapshot, original);
  assert.deepEqual(empty, []);
  assert.deepEqual(recorded, added);
  const list = await result('GET', '/workout-sessions', f.token);
  assert.ok(Array.isArray(list.items));
  assert.equal('exercises' in object(list.items[0]), false);
});

void test('PATCH corrects performed data, preserves original completedAt/position and clears nullable fields explicitly', async () => {
  const f = await fixture();
  const set = await add(f.path, f.token, {
    loadKg: 80,
    reps: 8,
    rpe: 8.5,
    rir: 2,
  });
  const changed = await result('PATCH', f.path + '/' + set.id, f.token, {
    loadKg: 82.25,
    reps: 7,
  });
  assert.equal(changed.rpe, 8.5);
  assert.equal(changed.rir, 2);
  assert.equal(changed.position, set.position);
  assert.equal(changed.completedAt, set.completedAt);
  assert.equal(changed.loadKg, 82.25);
  assert.equal(changed.reps, 7);
  const cleared = await result('PATCH', f.path + '/' + set.id, f.token, {
    rpe: null,
    rir: null,
  });
  assert.equal(cleared.rpe, null);
  assert.equal(cleared.rir, null);
  assert.equal(cleared.loadKg, 82.25);
  assert.equal(cleared.completedAt, set.completedAt);
  assert.equal(
    (await request('PATCH', f.path + '/' + set.id, f.token, {})).status,
    400,
  );
});

void test('DELETE returns 204 and compacts positions without changing completedAt; no standalone GET sets route exists', async () => {
  const f = await fixture();
  const added = [];
  for (let i = 0; i < 4; i++) added.push(await add(f.path, f.token));
  const response = await request(
    'DELETE',
    f.path + '/' + added[1]!.id,
    f.token,
  );
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  const current = sets(
    await result('GET', '/workout-sessions/' + f.id, f.token),
  );
  assert.deepEqual(
    current.map((set) => set.position),
    [1, 2, 3],
  );
  assert.deepEqual(
    current.map((set) => set.id),
    [added[0]!.id, added[2]!.id, added[3]!.id],
  );
  assert.deepEqual(
    current.map((set) => set.completedAt),
    [added[0]!.completedAt, added[2]!.completedAt, added[3]!.completedAt],
  );
  assert.equal((await add(f.path, f.token)).position, 4);
  assert.equal((await request('GET', f.path, f.token)).status, 404);
});

void test('HTTP rejects invalid ranges, decimal precision, RPE increments and numeric strings in create and patch', async (context) => {
  const f = await fixture();
  const set = await add(f.path, f.token);
  const invalid = [
    { loadKg: -1 },
    { loadKg: 10000.01 },
    { loadKg: 80.001 },
    { loadKg: '80' },
    { loadKg: null },
    { loadKg: true },
    { reps: 0 },
    { reps: -1 },
    { reps: 1001 },
    { reps: 1.5 },
    { reps: '8' },
    { reps: null },
    { rpe: 7.3 },
    { rpe: 0 },
    { rpe: 10.5 },
    { rpe: '8.5' },
    { rpe: true },
    { rir: -1 },
    { rir: 11 },
    { rir: 1.5 },
    { rir: '2' },
    { rir: false },
  ];
  for (const changes of invalid)
    await context.test(JSON.stringify(changes), async () => {
      assert.equal(
        (
          await request('POST', f.path, f.token, {
            loadKg: 80,
            reps: 8,
            ...changes,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request('PATCH', f.path + '/' + set.id, f.token, changes))
          .status,
        400,
      );
    });
  for (const body of [{}, { loadKg: 80 }, { reps: 8 }, []])
    assert.equal((await request('POST', f.path, f.token, body)).status, 400);
  for (const rpe of [1, 1.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])
    assert.equal(
      (await add(f.path, f.token, { loadKg: 0, reps: 1000, rpe, rir: 10 })).rpe,
      rpe,
    );
  const nullable = await add(f.path, f.token, {
    loadKg: 0,
    reps: 1,
    rpe: null,
    rir: null,
  });
  assert.equal(nullable.rpe, null);
  assert.equal(nullable.rir, null);
});

void test('HTTP rejects all immutable/unknown fields, queries and malformed resource UUIDs', async (context) => {
  const f = await fixture();
  const set = await add(f.path, f.token);
  for (const field of [
    'position',
    'completedAt',
    'userId',
    'workoutSessionExerciseId',
    'sessionId',
    'createdAt',
    'updatedAt',
    'id',
    'notes',
    'unknown',
  ]) {
    await context.test(field, async () => {
      assert.equal(
        (
          await request('POST', f.path, f.token, {
            loadKg: 80,
            reps: 8,
            [field]: 'untrusted',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('PATCH', f.path + '/' + set.id, f.token, {
            [field]: 'untrusted',
          })
        ).status,
        400,
      );
    });
  }
  for (const [method, path, body] of [
    ['POST', f.path, { loadKg: 80, reps: 8 }],
    ['PATCH', f.path + '/' + set.id, { reps: 9 }],
    ['DELETE', f.path + '/' + set.id, undefined],
  ] as const) {
    assert.equal(
      (await request(method, path + '?userId=' + randomUUID(), f.token, body))
        .status,
      400,
    );
    for (const old of [f.id, String(f.exercise.id)])
      assert.equal(
        (await request(method, path.replace(old, 'invalid'), f.token, body))
          .status,
        400,
      );
  }
  assert.equal(
    (await request('PATCH', f.path + '/invalid', f.token, { reps: 9 })).status,
    400,
  );
  assert.equal(
    (await request('DELETE', f.path + '/invalid', f.token)).status,
    400,
  );
  assert.equal(
    (
      await request('DELETE', f.path + '/' + set.id, f.token, {
        userId: randomUUID(),
      })
    ).status,
    400,
  );
});

void test('HTTP checks the full user/session/exercise/set chain and never discloses foreign identifiers', async () => {
  const a = await fixture();
  const b = await fixture();
  const setA = await add(a.path, a.token);
  const setB = await add(b.path, b.token);
  for (const [method, path, body] of [
    ['POST', a.path, { loadKg: 80, reps: 8 }],
    ['PATCH', a.path + '/' + setA.id, { reps: 9 }],
    ['DELETE', a.path + '/' + setA.id, undefined],
  ] as const)
    assert.equal((await request(method, path, b.token, body)).status, 404);
  const wrongExercise =
    '/workout-sessions/' +
    a.id +
    '/exercises/' +
    String(b.exercise.id) +
    '/sets';
  for (const [method, path, body] of [
    ['POST', wrongExercise, { loadKg: 80, reps: 8 }],
    ['PATCH', wrongExercise + '/' + setB.id, { reps: 9 }],
    ['DELETE', wrongExercise + '/' + setB.id, undefined],
  ] as const)
    assert.equal((await request(method, path, a.token, body)).status, 404);
  const sibling =
    '/workout-sessions/' + a.id + '/exercises/' + String(a.second.id) + '/sets';
  for (const path of [
    a.path + '/' + setB.id,
    sibling + '/' + setA.id,
    a.path + '/' + randomUUID(),
  ]) {
    assert.equal(
      (await request('PATCH', path, a.token, { reps: 9 })).status,
      404,
    );
    assert.equal((await request('DELETE', path, a.token)).status, 404);
  }
  assert.deepEqual(
    sets(await result('GET', '/workout-sessions/' + a.id, a.token)),
    [setA],
  );
});

for (const action of ['complete', 'cancel']) {
  void test(
    'HTTP ' + action + ' freezes all set mutations and retains existing sets',
    async () => {
      const f = await fixture();
      const set = await add(f.path, f.token);
      const ended = await result(
        'POST',
        '/workout-sessions/' + f.id + '/' + action,
        f.token,
      );
      assert.deepEqual(sets(ended), [set]);
      for (const [method, path, body] of [
        ['POST', f.path, { loadKg: 80, reps: 8 }],
        ['PATCH', f.path + '/' + set.id, { reps: 9 }],
        ['DELETE', f.path + '/' + set.id, undefined],
      ] as const)
        assert.equal((await request(method, path, f.token, body)).status, 409);
      assert.deepEqual(
        await result('GET', '/workout-sessions/' + f.id, f.token),
        ended,
      );
    },
  );
}

void test('HTTP concurrent adds allocate contiguous positions and racing completion never allows a later mutation', async () => {
  const f = await fixture();
  const added = await Promise.all(
    [80, 80.5, 82.25].map((loadKg) =>
      add(f.path, f.token, { loadKg, reps: 8 }),
    ),
  );
  assert.deepEqual(added.map((set) => set.position).sort(), [1, 2, 3]);
  const [complete, addResponse] = await Promise.all([
    request('POST', '/workout-sessions/' + f.id + '/complete', f.token),
    request('POST', f.path, f.token, { loadKg: 80, reps: 8 }),
  ]);
  assert.equal(complete.status, 200);
  assert.ok([201, 409].includes(addResponse.status));
  const finished = object(await complete.json());
  assert.equal(sets(finished).length, addResponse.status === 201 ? 4 : 3);
  assert.deepEqual(
    await result('GET', '/workout-sessions/' + f.id, f.token),
    finished,
  );
  assert.equal(
    (await request('POST', f.path, f.token, { loadKg: 80, reps: 8 })).status,
    409,
  );
});
