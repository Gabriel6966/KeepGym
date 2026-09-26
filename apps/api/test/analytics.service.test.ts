import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { InvalidAnalyticsQueryError } from '../src/analytics/errors/invalid-analytics-query.error';
import {
  analyticsFixture,
  InMemoryAnalyticsRepository,
} from './support/in-memory-analytics.repository';

async function setup(context: TestContext) {
  const f = analyticsFixture();
  const repository = new InMemoryAnalyticsRepository(f.records);
  const module = await Test.createTestingModule({
    providers: [
      AnalyticsService,
      { provide: AnalyticsRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, repository, service: module.get(AnalyticsService) };
}
void test('overview all-time counts COMPLETED only, scopes owner and exposes no additional metrics', async (context) => {
  const f = await setup(context);
  const spy = context.mock.method(f.repository, 'overview');
  assert.deepEqual(await f.service.overview(f.owner), {
    completedWorkouts: 2,
    completedSets: 4,
    totalReps: 33,
    totalVolumeKg: 2255.75,
  });
  assert.deepEqual(spy.mock.calls[0]?.arguments, [
    f.owner,
    { from: undefined, to: undefined },
  ]);
  assert.equal((await f.service.overview(f.other)).totalVolumeKg, 270000);
  assert.deepEqual(await f.service.overview(randomUUID()), {
    completedWorkouts: 0,
    completedSets: 0,
    totalReps: 0,
    totalVolumeKg: 0,
  });
});
void test('inclusive timezone range applies consistently to overview, summary, candidates and performances', async (context) => {
  const f = await setup(context);
  const range = {
    from: '2026-09-20T12:00:00+02:00',
    to: '2026-09-20T10:00:00Z',
  };
  assert.deepEqual(await f.service.overview(f.owner, range), {
    completedWorkouts: 1,
    completedSets: 3,
    totalReps: 23,
    totalVolumeKg: 1855.75,
  });
  const result = await f.service.exercise(f.owner, f.exerciseId, range);
  assert.deepEqual(result.summary, {
    sessions: 1,
    sets: 3,
    reps: 23,
    totalVolumeKg: 1855.75,
    maxLoadKg: 82.25,
    maxEstimated1RMKg: 101.44,
  });
  assert.equal(result.heaviestSet?.loadKg, 82.25);
  assert.equal(result.bestEstimated1RMSet?.estimated1RMKg, 101.44);
  assert.deepEqual(
    result.performances.map((entry) => entry.sessionId),
    [f.completed.session.id],
  );
});
void test('pagination affects only performances, not global summary, maxima or latest snapshot metadata', async (context) => {
  const f = await setup(context);
  const result = await f.service.exercise(f.owner, f.exerciseId, {
    page: 2,
    limit: 1,
  });
  assert.equal(result.total, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.summary.totalVolumeKg, 2255.75);
  assert.equal(result.exercise?.name, 'Original Bench');
  assert.equal(result.performances[0]?.exercise.name, 'Older snapshot');
  const beyond = await f.service.exercise(f.owner, f.exerciseId, { page: 99 });
  assert.deepEqual(beyond.performances, []);
  assert.deepEqual(beyond.summary, result.summary);
  assert.deepEqual(beyond.exercise, result.exercise);
});
void test('empty analytics is 200-compatible, no catalog lookup, null unobserved maxima and candidates', async (context) => {
  const f = await setup(context);
  for (const [owner, id] of [
    [randomUUID(), f.exerciseId],
    [f.owner, randomUUID()],
  ]) {
    const data = await f.service.exercise(owner!, id!);
    assert.deepEqual(data, {
      exercise: null,
      summary: {
        sessions: 0,
        sets: 0,
        reps: 0,
        totalVolumeKg: 0,
        maxLoadKg: null,
        maxEstimated1RMKg: null,
      },
      heaviestSet: null,
      bestEstimated1RMSet: null,
      performances: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  }
});
void test('public sets are ordered numeric allowlists; cancelled/active/foreign data cannot change results', async (context) => {
  const f = await setup(context);
  const result = await f.service.exercise(f.owner, f.exerciseId);
  assert.deepEqual(
    result.performances.map((entry) => entry.sessionId),
    [f.completed.session.id, f.older.session.id],
  );
  const entry = result.performances[0]!;
  assert.deepEqual(
    entry.sets.map((set) => [set.position, set.loadKg]),
    [
      [1, 80],
      [2, 80],
      [3, 82.25],
    ],
  );
  assert.equal(entry.sets[2]?.rpe, 8.5);
  assert.equal(entry.sets[2]?.rir, 2);
  assert.deepEqual(
    [entry.setCount, entry.repCount, entry.volumeKg, entry.maxEstimated1RMKg],
    [3, 23, 1855.75, 101.44],
  );
  for (const field of [
    'userId',
    'passwordHash',
    'sourceTemplateId',
    'plannedSets',
    'createdAt',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  assert.equal(typeof entry.sets[0]?.loadKg, 'number');
});
void test('zero-set occurrences count sessions, bodyweight has volume zero and no estimated strength', async (context) => {
  const f = await setup(context);
  for (const record of [f.completed, f.older])
    record.session.exercises[0]!.sets = [];
  const empty = await f.service.exercise(f.owner, f.exerciseId);
  assert.equal(empty.summary.sessions, 2);
  assert.equal(empty.summary.maxLoadKg, null);
  assert.equal(empty.performances[0]?.maxLoadKg, null);
  assert.equal((await f.service.overview(f.owner)).completedWorkouts, 2);
  f.completed.session.exercises[0]!.sets.push({
    id: randomUUID(),
    position: 1,
    loadKg: new Prisma.Decimal(0),
    reps: 10,
    rpe: null,
    rir: null,
    completedAt: new Date(),
  });
  const bodyweight = await f.service.exercise(f.owner, f.exerciseId);
  assert.equal(bodyweight.summary.maxLoadKg, 0);
  assert.equal(bodyweight.summary.maxEstimated1RMKg, null);
  assert.equal(bodyweight.summary.totalVolumeKg, 0);
  assert.equal(bodyweight.bestEstimated1RMSet, null);
});
void test('best Epley compares exact scores before rounding then load/reps/time/id; heaviest ties are deterministic', async (context) => {
  const f = await setup(context);
  f.older.session.exercises[0]!.sets = [];
  const sets = f.completed.session.exercises[0]!.sets;
  sets.length = 0;
  function add(
    load: number,
    reps: number,
    completedAt: Date,
    id = randomUUID(),
  ) {
    sets.push({
      id,
      position: sets.length + 1,
      loadKg: new Prisma.Decimal(load),
      reps,
      rpe: null,
      rir: null,
      completedAt,
    });
    return id;
  }
  const time = new Date('2026-09-20T11:00:00Z');
  add(1, 1, time);
  const lowerLoad = add(0.97, 2, time);
  assert.equal(
    (await f.service.exercise(f.owner, f.exerciseId)).bestEstimated1RMSet
      ?.setId,
    lowerLoad,
  );
  sets.length = 0;
  add(80, 15, time);
  add(90, 10, time, '00000000-0000-4000-8000-000000000001');
  const tieWinner = add(90, 10, time, '00000000-0000-4000-8000-000000000002');
  const result = await f.service.exercise(f.owner, f.exerciseId);
  assert.equal(result.bestEstimated1RMSet?.setId, tieWinner);
  assert.equal(result.heaviestSet?.setId, tieWinner);
  const moreReps = add(90, 21, new Date(time.getTime() + 1));
  const later = await f.service.exercise(f.owner, f.exerciseId);
  assert.equal(later.heaviestSet?.setId, moreReps);
  assert.equal(later.bestEstimated1RMSet?.setId, tieWinner);
});
void test('service rejects invalid identifiers, reversed ranges, ambiguous dates and unsafe pagination before querying', async (context) => {
  const f = await setup(context);
  for (const input of [
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-20T10:00:00' },
    { from: '2026-09-21T00:00:00Z', to: '2026-09-20T00:00:00Z' },
  ]) {
    await assert.rejects(
      f.service.overview(f.owner, input),
      InvalidAnalyticsQueryError,
    );
    await assert.rejects(
      f.service.exercise(f.owner, f.exerciseId, input),
      InvalidAnalyticsQueryError,
    );
  }
  for (const input of [
    { page: 0 },
    { limit: 101 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER },
  ])
    await assert.rejects(
      f.service.exercise(f.owner, f.exerciseId, input),
      InvalidAnalyticsQueryError,
    );
  await assert.rejects(
    f.service.overview('invalid'),
    InvalidAnalyticsQueryError,
  );
  await assert.rejects(
    f.service.exercise(f.owner, 'invalid'),
    InvalidAnalyticsQueryError,
  );
});
