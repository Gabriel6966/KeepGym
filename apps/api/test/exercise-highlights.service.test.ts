import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { AnalyticsPersistenceError } from '../src/analytics/errors/analytics-persistence.error';
import { InvalidAnalyticsQueryError } from '../src/analytics/errors/invalid-analytics-query.error';
import { exerciseHighlightsFixture } from './support/exercise-highlights';

async function setup(context: TestContext) {
  const f = exerciseHighlightsFixture();
  const find = context.mock.fn(
    f.repository.findExerciseHighlightPerformances.bind(f.repository),
  );
  const module = await Test.createTestingModule({
    providers: [
      AnalyticsService,
      {
        provide: AnalyticsRepository,
        useValue: {
          findExerciseHighlightPerformances: find,
          exercise: f.repository.exercise.bind(f.repository),
        },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, find, service: module.get(AnalyticsService) };
}

void test('highlights are empty without eligible owner performances; default limit and identity are passed unchanged', async (context) => {
  const f = await setup(context);
  const userId = randomUUID();
  assert.deepEqual(await f.service.getExerciseHighlights(userId), {
    items: [],
  });
  assert.deepEqual(f.find.mock.calls[0]!.arguments, [userId, 5]);
});
void test('latest/previous actual performance aggregates, snapshot metadata and Epley are not all-time records', async (context) => {
  const f = await setup(context);
  const result = await f.service.getExerciseHighlights(f.owner, 3);
  assert.deepEqual(
    result.items.map((item) => item.exercise.sourceExerciseId),
    [f.benchId, f.squatId, f.rowId],
  );
  const bench = result.items[0]!;
  assert.deepEqual(bench.exercise, {
    sourceExerciseId: f.benchId,
    name: 'Latest Bench snapshot',
    slug: 'snapshot-slug',
  });
  assert.deepEqual(bench.latest, {
    workoutSessionId: f.latestBench.session.id,
    startedAt: f.latestBench.session.startedAt,
    completedSets: 3,
    totalReps: 26,
    totalVolumeKg: 1280,
    maxLoadKg: 80,
    bestEstimated1RMKg: 101.33,
  });
  assert.deepEqual(bench.previous, {
    workoutSessionId: f.previousBench.session.id,
    startedAt: f.previousBench.session.startedAt,
    completedSets: 2,
    totalReps: 16,
    totalVolumeKg: 1200,
    maxLoadKg: 75,
    bestEstimated1RMKg: 95,
  });
  assert.equal(
    (await f.service.exercise(f.owner, f.benchId)).summary.maxLoadKg,
    100,
  );
  assert.deepEqual(result.items[1]!.latest, {
    workoutSessionId: f.squat.session.id,
    startedAt: f.squat.session.startedAt,
    completedSets: 2,
    totalReps: 10,
    totalVolumeKg: 1000,
    maxLoadKg: 100,
    bestEstimated1RMKg: 116.67,
  });
  assert.equal(result.items[1]!.previous, null);
  assert.deepEqual(await f.service.getExerciseHighlights(f.owner, 1), {
    items: [bench],
  });
  assert.equal(
    (await f.service.getExerciseHighlights(f.owner, 20)).items.length,
    3,
  );
  assert.equal(
    (await f.service.getExerciseHighlights(f.other)).items[0]!.latest.maxLoadKg,
    9000,
  );
});
void test('three recent Bench occurrences do not consume the distinct Exercise limit, and zero sets/null source/states cannot replace latest', async (context) => {
  const f = await setup(context);
  const result = await f.service.getExerciseHighlights(f.owner, 3);
  assert.equal(result.items.length, 3);
  assert.equal(
    result.items[0]!.latest.workoutSessionId,
    f.latestBench.session.id,
  );
  assert.equal(
    result.items[0]!.previous!.workoutSessionId,
    f.previousBench.session.id,
  );
});
void test('bodyweight counts sets/reps with zero external volume/load; high reps cannot produce e1RM; Decimal results are clean', async (context) => {
  const f = await setup(context);
  f.repository.records.length = 0;
  const id = randomUUID();
  f.add(id, '2026-09-01', [[50, 25]]);
  f.add(id, '2026-09-02', [[0, 10]]);
  const result = (await f.service.getExerciseHighlights(f.owner)).items[0]!;
  assert.deepEqual(
    [
      result.latest.completedSets,
      result.latest.totalReps,
      result.latest.totalVolumeKg,
      result.latest.maxLoadKg,
      result.latest.bestEstimated1RMKg,
    ],
    [1, 10, 0, 0, null],
  );
  assert.deepEqual(
    [
      result.previous!.totalVolumeKg,
      result.previous!.maxLoadKg,
      result.previous!.bestEstimated1RMKg,
    ],
    [1250, 50, null],
  );
  f.add(id, '2026-09-03', [[82.25, 7]]);
  const decimal = (await f.service.getExerciseHighlights(f.owner)).items[0]!
    .latest;
  assert.equal(decimal.totalVolumeKg, 575.75);
  assert.equal(decimal.maxLoadKg, 82.25);
  assert.equal(decimal.bestEstimated1RMKg, 101.44);
});
void test('service preserves rank semantics and enforces recency/session/source deterministic global ordering without mutating rows', async (context) => {
  const f = await setup(context);
  const data = await f.repository.findExerciseHighlightPerformances(f.owner, 3);
  data.performances.reverse();
  for (const row of data.performances)
    if (row.performanceRank === 1) {
      row.startedAt = new Date('2026-09-30T00:00:00Z');
      row.workoutSessionId =
        row.sourceExerciseId === f.rowId
          ? 'ffffffff-ffff-4fff-afff-ffffffffffff'
          : '00000000-0000-4000-a000-000000000001';
    }
  const before = structuredClone(data);
  f.find.mock.mockImplementation(async () => data);
  const result = await f.service.getExerciseHighlights(f.owner, 3);
  assert.deepEqual(
    result.items.map((item) => item.exercise.sourceExerciseId),
    [f.rowId, ...[f.benchId, f.squatId].sort()],
  );
  assert.equal(
    result.items.find((item) => item.exercise.sourceExerciseId === f.benchId)!
      .previous!.maxLoadKg,
    75,
  );
  assert.deepEqual(data, before);
});
void test('ineligible candidates are ignored; best e1RM is calculated from shared exact-score candidates and only rounded publicly', async (context) => {
  const f = await setup(context);
  const data = await f.repository.findExerciseHighlightPerformances(f.owner, 1);
  const id = data.performances.find(
    (row) => row.performanceRank === 1,
  )!.sessionExerciseId;
  data.estimatedCandidates = [
    { sessionExerciseId: id, loadKg: '0', reps: 10 },
    { sessionExerciseId: id, loadKg: '999', reps: 21 },
    { sessionExerciseId: id, loadKg: '82.25', reps: 7 },
    { sessionExerciseId: id, loadKg: '80', reps: 8 },
  ];
  f.find.mock.mockImplementation(async () => data);
  assert.equal(
    (await f.service.getExerciseHighlights(f.owner, 1)).items[0]!.latest
      .bestEstimated1RMKg,
    101.44,
  );
});
void test('invalid domain inputs fail before persistence; repository and malformed performance errors are sanitized, never converted to empty', async (context) => {
  const f = await setup(context);
  for (const limit of [0, 21, 1.5, NaN, Infinity])
    await assert.rejects(
      f.service.getExerciseHighlights(f.owner, limit),
      InvalidAnalyticsQueryError,
    );
  await assert.rejects(
    f.service.getExerciseHighlights('invalid'),
    InvalidAnalyticsQueryError,
  );
  assert.equal(f.find.mock.calls.length, 0);
  f.find.mock.mockImplementation(async () => {
    throw new Error('Private SQL and credentials');
  });
  await assert.rejects(
    f.service.getExerciseHighlights(f.owner),
    (error: unknown) =>
      error instanceof AnalyticsPersistenceError &&
      !error.message.includes('SQL') &&
      error.cause === undefined,
  );
  const data = await f.repository.findExerciseHighlightPerformances(f.owner, 1);
  for (const corruption of ['rank', 'empty', 'count'] as const) {
    const invalid = structuredClone(data);
    const row = invalid.performances[0]!;
    if (corruption === 'rank') row.performanceRank = 3;
    if (corruption === 'empty') row.completedSets = '0';
    if (corruption === 'count') row.totalReps = 'NaN';
    f.find.mock.mockImplementation(async () => invalid);
    await assert.rejects(
      f.service.getExerciseHighlights(f.owner),
      AnalyticsPersistenceError,
    );
  }
});
