import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutSessionsRepository } from '../src/workout-sessions/workout-sessions.repository';
import { WorkoutSessionsService } from '../src/workout-sessions/workout-sessions.service';
import { InvalidSetEntryError } from '../src/workout-sessions/errors/invalid-set-entry.error';
import { SetEntryNotFoundError } from '../src/workout-sessions/errors/set-entry-not-found.error';
import { WorkoutSessionNotEditableError } from '../src/workout-sessions/errors/workout-session-not-editable.error';
import { WorkoutSessionNotFoundError } from '../src/workout-sessions/errors/workout-session-not-found.error';
import { WorkoutSessionExerciseNotFoundError } from '../src/workout-sessions/errors/workout-session-exercise-not-found.error';
import {
  WorkoutSessionsPrismaFake,
  sourceTemplate,
} from './support/workout-sessions-prisma.fake';

async function setup(context: TestContext) {
  const db = new WorkoutSessionsPrismaFake();
  const user = randomUUID();
  const source = sourceTemplate(user);
  db.templates.set(source.id, source);
  const module = await Test.createTestingModule({
    providers: [
      WorkoutSessionsService,
      WorkoutSessionsRepository,
      { provide: PrismaService, useValue: db },
    ],
  }).compile();
  context.after(() => module.close());
  const service = module.get(WorkoutSessionsService);
  const repository = module.get(WorkoutSessionsRepository);
  const session = await service.start(user, { workoutTemplateId: source.id });
  const entry = session.exercises[0];
  assert.ok(entry);
  return { db, user, source, service, repository, session, entry };
}

void test('sets append at 1/2/3, preserve exact decimal values and expose only public primitives', async (context) => {
  const { db, user, service, repository, session, entry } =
    await setup(context);
  const add = context.mock.method(repository, 'addSet');
  for (const [index, loadKg] of [
    80, 80.5, 82.25, 0, 0.29, 1.01, 8192.01, 10000,
  ].entries()) {
    const set = await service.addSet(user, session.id, entry.id, {
      loadKg,
      reps: 8,
      rpe: 8.5,
      rir: 0,
    });
    assert.equal(set.position, index + 1);
    assert.equal(set.loadKg, loadKg);
    assert.equal(set.rpe, 8.5);
    assert.equal(set.rir, 0);
    assert.deepEqual(Object.keys(set).sort(), [
      'completedAt',
      'id',
      'loadKg',
      'position',
      'reps',
      'rir',
      'rpe',
    ]);
    assert.equal(typeof set.loadKg, 'number');
    assert.equal(typeof set.rpe, 'number');
    assert.ok(set.completedAt instanceof Date);
    const stored = db.sessions.get(session.id)?.exercises[0]?.sets[index];
    assert.ok(stored);
    assert.ok(Prisma.Decimal.isDecimal(stored.loadKg));
    assert.equal(stored.loadKg.toString(), String(loadKg));
    assert.equal(JSON.parse(JSON.stringify(set)).loadKg, loadKg);
  }
  assert.deepEqual(add.mock.calls[0]?.arguments, [
    user,
    session.id,
    entry.id,
    { loadKg: 80, reps: 8, rpe: 8.5, rir: 0 },
  ]);
  const detail = await service.getById(user, session.id);
  assert.equal(detail.exercises[0]?.sets.length, 8);
  const { sets, ...snapshot } = detail.exercises[0]!;
  const { sets: originalSets, ...originalSnapshot } = entry;
  assert.deepEqual(originalSets, []);
  assert.deepEqual(snapshot, originalSnapshot);
  assert.deepEqual(
    sets.map((set) => set.position),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

void test('set correction preserves position/completedAt, omitted optional values and supports explicit null clearing', async (context) => {
  const { user, service, session, entry } = await setup(context);
  const original = await service.addSet(user, session.id, entry.id, {
    loadKg: 80,
    reps: 8,
    rpe: 8.5,
    rir: 2,
  });
  const changed = await service.updateSet(
    user,
    session.id,
    entry.id,
    original.id,
    { loadKg: 82.25, reps: 7 },
  );
  assert.equal(changed.loadKg, 82.25);
  assert.equal(changed.reps, 7);
  assert.equal(changed.rpe, 8.5);
  assert.equal(changed.rir, 2);
  assert.equal(changed.position, original.position);
  assert.deepEqual(changed.completedAt, original.completedAt);
  const cleared = await service.updateSet(
    user,
    session.id,
    entry.id,
    original.id,
    { rpe: null, rir: null },
  );
  assert.equal(cleared.rpe, null);
  assert.equal(cleared.rir, null);
  assert.equal(cleared.loadKg, 82.25);
  await assert.rejects(
    service.updateSet(user, session.id, entry.id, original.id, {}),
    InvalidSetEntryError,
  );
});

void test('service rejects unsupported decimal precision, invalid ranges and non-half-step RPE before persistence', async (context) => {
  const { user, service, repository, session, entry } = await setup(context);
  const add = context.mock.method(repository, 'addSet');
  for (const changes of [
    { loadKg: -1 },
    { loadKg: 10000.01 },
    { loadKg: 80.001 },
    { loadKg: NaN },
    { loadKg: Infinity },
    { reps: 0 },
    { reps: -1 },
    { reps: 1.5 },
    { reps: 1001 },
    { rpe: 0 },
    { rpe: 10.5 },
    { rpe: 7.3 },
    { rpe: Infinity },
    { rir: -1 },
    { rir: 11 },
    { rir: 1.5 },
  ])
    await assert.rejects(
      service.addSet(user, session.id, entry.id, {
        loadKg: 80,
        reps: 8,
        ...changes,
      }),
      InvalidSetEntryError,
    );
  assert.equal(add.mock.calls.length, 0);
  for (const rpe of [1, 1.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
    const set = await service.addSet(user, session.id, entry.id, {
      loadKg: 0,
      reps: 1000,
      rpe,
      rir: 10,
    });
    assert.equal(set.rpe, rpe);
    assert.equal(set.rir, 10);
  }
});

void test('delete compacts ascending positions atomically and later additions append after the compact order', async (context) => {
  const { user, service, session, entry } = await setup(context);
  const sets = [];
  for (let i = 0; i < 4; i++)
    sets.push(
      await service.addSet(user, session.id, entry.id, {
        loadKg: 80,
        reps: 8 - i,
      }),
    );
  await service.removeSet(user, session.id, entry.id, sets[1]!.id);
  const current = (await service.getById(user, session.id)).exercises[0]!.sets;
  assert.deepEqual(
    current.map((set) => set.id),
    [sets[0]!.id, sets[2]!.id, sets[3]!.id],
  );
  assert.deepEqual(
    current.map((set) => set.position),
    [1, 2, 3],
  );
  assert.deepEqual(
    current.map((set) => set.completedAt),
    [sets[0]!.completedAt, sets[2]!.completedAt, sets[3]!.completedAt],
  );
  assert.equal(
    (
      await service.addSet(user, session.id, entry.id, {
        loadKg: 82.25,
        reps: 6,
      })
    ).position,
    4,
  );
});

for (const action of ['complete', 'cancel'] as const) {
  void test(
    action +
      ' preserves recorded sets and permanently rejects create/update/delete',
    async (context) => {
      const { user, service, session, entry } = await setup(context);
      const set = await service.addSet(user, session.id, entry.id, {
        loadKg: 80,
        reps: 8,
      });
      const ended = await service[action](user, session.id);
      assert.deepEqual(ended.exercises[0]?.sets, [set]);
      for (const operation of [
        () =>
          service.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 }),
        () =>
          service.updateSet(user, session.id, entry.id, set.id, { reps: 9 }),
        () => service.removeSet(user, session.id, entry.id, set.id),
      ])
        await assert.rejects(operation(), WorkoutSessionNotEditableError);
      assert.deepEqual(await service.getById(user, session.id), ended);
    },
  );
}

void test('set authorization validates owner, session child and set child; wrong chains are concealed as 404 domain errors', async (context) => {
  const { user, source, service, session, entry } = await setup(context);
  const set = await service.addSet(user, session.id, entry.id, {
    loadKg: 80,
    reps: 8,
  });
  const other = randomUUID();
  const second = await service.start(user, { workoutTemplateId: source.id });
  const sibling = session.exercises[1];
  assert.ok(sibling);
  for (const operation of [
    () => service.addSet(other, session.id, entry.id, { loadKg: 80, reps: 8 }),
    () => service.updateSet(other, session.id, entry.id, set.id, { reps: 9 }),
    () => service.removeSet(other, session.id, entry.id, set.id),
  ])
    await assert.rejects(operation(), WorkoutSessionNotFoundError);
  for (const operation of [
    () => service.addSet(user, second.id, entry.id, { loadKg: 80, reps: 8 }),
    () => service.updateSet(user, second.id, entry.id, set.id, { reps: 9 }),
    () => service.removeSet(user, second.id, entry.id, set.id),
  ])
    await assert.rejects(operation(), WorkoutSessionExerciseNotFoundError);
  await assert.rejects(
    service.updateSet(user, session.id, sibling.id, set.id, { reps: 9 }),
    SetEntryNotFoundError,
  );
  await assert.rejects(
    service.removeSet(user, session.id, sibling.id, set.id),
    SetEntryNotFoundError,
  );
  assert.deepEqual(
    (await service.getById(user, session.id)).exercises[0]?.sets,
    [set],
  );
});

void test('completion remains valid with zero, fewer or more actual sets than planned', async (context) => {
  const { user, source, service } = await setup(context);
  for (const count of [0, 3, 5]) {
    const session = await service.start(user, { workoutTemplateId: source.id });
    const entry = session.exercises[0];
    assert.ok(entry);
    assert.equal(entry.plannedSets, 4);
    for (let i = 0; i < count; i++)
      await service.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 });
    const completed = await service.complete(user, session.id);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.exercises[0]?.sets.length, count);
  }
});
