import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { InvalidTrainingTrendsQueryError } from '../src/training-trends/errors/invalid-training-trends-query.error';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';
import {
  exerciseTrainingTrendsFixture,
  exerciseTrendInput as input,
  expectedExerciseBuckets,
} from './support/in-memory-exercise-training-trends.repository';

async function setup(context: TestContext) {
  const f = exerciseTrainingTrendsFixture();
  const read = context.mock.method(f.repository, 'findExerciseWeeklyTrends');
  const module = await Test.createTestingModule({
    providers: [
      TrainingTrendsService,
      { provide: TrainingTrendsRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingTrendsService) };
}
void test('exercise weekly empty results preserve explicit scope and canonical instants without catalog lookup', async (context) => {
  const f = await setup(context);
  const result = await f.service.getExerciseWeeklyTrends(
    f.owner,
    randomUUID(),
    input,
  );
  assert.deepEqual(result, {
    exercise: null,
    timezone: input.timezone,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T21:59:59.000Z',
    buckets: [],
  });
  assert.equal(f.read.mock.calls[0]!.arguments[0], f.owner);
  assert.deepEqual(f.read.mock.calls[0]!.arguments[2], {
    from: new Date(input.from),
    to: new Date(input.to),
    timezone: input.timezone,
  });
});
void test('exercise weekly calculates exact ordered aggregates/Epley; skips zero-set, unfinished, foreign and other-exercise data', async (context) => {
  const f = await setup(context);
  const result = await f.service.getExerciseWeeklyTrends(
    f.owner,
    f.exerciseId,
    input,
  );
  assert.deepEqual(result.buckets, expectedExerciseBuckets);
  assert.equal(result.exercise?.name, 'Latest historical bench');
  assert.equal(
    (await f.service.getExerciseWeeklyTrends(f.other, f.exerciseId, input))
      .buckets[0]?.maxLoadKg,
    300,
  );
  assert.equal(JSON.stringify(result).includes('userId'), false);
  assert.deepEqual(
    Object.keys(result.exercise!).sort(),
    [
      'sourceExerciseId',
      'name',
      'slug',
      'primaryMuscle',
      'secondaryMuscles',
      'equipment',
      'movementPattern',
    ].sort(),
  );
});
void test('exercise weekly range scopes metadata and candidates too; zero-set occurrence yields no bucket or metadata', async (context) => {
  const f = await setup(context);
  const first = await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, {
    ...input,
    to: '2026-09-14T10:00:00Z',
  });
  assert.equal(first.exercise?.name, 'Historical Bench');
  assert.deepEqual(first.buckets, expectedExerciseBuckets.slice(0, 1));
  const empty = await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, {
    ...input,
    from: '2026-09-18T12:00:00+02:00',
    to: '2026-09-18T10:00:00Z',
  });
  assert.equal(empty.exercise, null);
  assert.deepEqual(empty.buckets, []);
});
void test('exercise weekly counts distinct workouts even if one workout contains multiple occurrences', async (context) => {
  const f = await setup(context);
  const first = f.repository.occurrences[0]!;
  f.repository.occurrences.push({
    ...first,
    sets: [{ loadKg: '80.5', reps: 8 }],
  });
  const bucket = (
    await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, input)
  ).buckets[0]!;
  assert.equal(bucket.completedWorkouts, 1);
  assert.equal(bucket.completedSets, 3);
  assert.equal(bucket.totalReps, 24);
  assert.equal(bucket.totalVolumeKg, 1924);
  assert.equal(bucket.maxLoadKg, 80.5);
  assert.equal(bucket.maxEstimated1RMKg, 101.97);
});
void test('weekly maximum load includes zero; Epley eligibility and maxima are independent from max load and record holders', async (context) => {
  const f = await setup(context);
  f.repository.occurrences.length = 1;
  const occurrence = f.repository.occurrences[0]!;
  for (const [sets, maxLoad, e1rm] of [
    [[{ loadKg: '0', reps: 10 }], 0, null],
    [[{ loadKg: '50', reps: 21 }], 50, null],
    [[{ loadKg: '50', reps: 20 }], 50, 83.33],
    [
      [
        { loadKg: '100', reps: 1 },
        { loadKg: '82.25', reps: 10 },
      ],
      100,
      109.67,
    ],
  ] as const) {
    occurrence.sets = [...sets];
    const bucket = (
      await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, input)
    ).buckets[0]!;
    assert.equal(bucket.maxLoadKg, maxLoad);
    assert.equal(bucket.maxEstimated1RMKg, e1rm);
  }
});
void test('exercise weekly reuses timezone boundaries independently of process TZ', async (context) => {
  const f = await setup(context);
  const first = f.repository.occurrences[0]!;
  f.repository.occurrences.splice(
    0,
    f.repository.occurrences.length,
    { ...first, startedAt: new Date('2026-09-20T21:59:59.999Z') },
    {
      ...first,
      sessionId: randomUUID(),
      startedAt: new Date('2026-09-20T22:00:00Z'),
    },
  );
  assert.deepEqual(
    (
      await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, input)
    ).buckets.map((b) => b.weekStart),
    ['2026-09-14', '2026-09-21'],
  );
  for (const timezone of ['UTC', 'America/New_York'])
    assert.deepEqual(
      (
        await f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, {
          ...input,
          timezone,
        })
      ).buckets.map((b) => b.weekStart),
      ['2026-09-14'],
    );
});
void test('exercise weekly rejects invalid identifiers/ranges/timezones before repository access', async (context) => {
  const f = await setup(context);
  for (const override of [
    { from: '2026-09-01T00:00:00' },
    { from: '2026-10-01T00:00:00Z' },
    { from: '2023-01-01T00:00:00Z' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
  ])
    await assert.rejects(
      f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, {
        ...input,
        ...override,
      }),
      InvalidTrainingTrendsQueryError,
    );
  await assert.rejects(
    f.service.getExerciseWeeklyTrends(f.owner, 'invalid', input),
    InvalidTrainingTrendsQueryError,
  );
  await assert.rejects(
    f.service.getExerciseWeeklyTrends('invalid', f.exerciseId, input),
    InvalidTrainingTrendsQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
});
void test('exercise weekly rounds public decimals, copies snapshot arrays and rejects unsafe persistence values', async (context) => {
  const f = await setup(context);
  const data = await f.repository.findExerciseWeeklyTrends(
    f.owner,
    f.exerciseId,
    {
      from: new Date(input.from),
      to: new Date(input.to),
      timezone: input.timezone,
    },
  );
  f.read.mock.mockImplementation(async () => data);
  data.buckets[0]!.totalVolumeKg = '21450.7499999997';
  const result = await f.service.getExerciseWeeklyTrends(
    f.owner,
    f.exerciseId,
    input,
  );
  assert.equal(result.buckets[0]?.totalVolumeKg, 21450.75);
  result.exercise!.secondaryMuscles.push('SHOULDERS');
  assert.deepEqual(data.exercise?.secondaryMuscles, ['TRICEPS']);
  for (const overrides of [
    { maxLoadKg: 'Infinity' },
    { completedSets: '9007199254740992' },
    { totalVolumeKg: 'NaN' },
  ]) {
    f.read.mock.mockImplementation(async () => ({
      ...data,
      buckets: [{ ...data.buckets[0]!, ...overrides }],
    }));
    await assert.rejects(
      f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, input),
      TrainingTrendsPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => ({ ...data, exercise: null }));
  await assert.rejects(
    f.service.getExerciseWeeklyTrends(f.owner, f.exerciseId, input),
    TrainingTrendsPersistenceError,
  );
});
