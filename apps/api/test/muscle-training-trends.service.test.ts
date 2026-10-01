import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { InvalidTrainingTrendsQueryError } from '../src/training-trends/errors/invalid-training-trends-query.error';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';
import { MAX_TRAINING_TRENDS_RANGE_MS } from '../src/training-trends/training-trends.validation';
import {
  muscleTrainingTrendsFixture,
  muscleTrendsInput as input,
  expectedMuscleBuckets,
} from './support/in-memory-muscle-training-trends.repository';

async function setup(context: TestContext) {
  const f = muscleTrainingTrendsFixture();
  const read = context.mock.method(f.repository, 'findMuscleGroupWeeklyTrends');
  const module = await Test.createTestingModule({
    providers: [
      TrainingTrendsService,
      { provide: TrainingTrendsRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingTrendsService) };
}
void test('muscle trends empty result scopes authenticated identity and normalizes explicit instants', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  assert.deepEqual(await f.service.getMuscleGroupWeeklyTrends(owner, input), {
    timezone: input.timezone,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T21:59:59.000Z',
    buckets: [],
  });
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [
    owner,
    {
      from: new Date(input.from),
      to: new Date(input.to),
      timezone: input.timezone,
    },
  ]);
});
void test('muscle trends groups multiple weeks and counts distinct workouts across same-primary exercises', async (context) => {
  const f = await setup(context);
  const result = await f.service.getMuscleGroupWeeklyTrends(f.owner, input);
  assert.deepEqual(result.buckets, expectedMuscleBuckets);
  assert.deepEqual(
    Object.keys(result.buckets[0]!.muscleGroups[0]!).sort(),
    [
      'muscleGroup',
      'completedWorkouts',
      'completedSets',
      'totalReps',
      'totalVolumeKg',
    ].sort(),
  );
  assert.equal(JSON.stringify(result).includes('userId'), false);
});
void test('muscle trends attributes bench only to CHEST, never to its TRICEPS/SHOULDERS secondary snapshots', async (context) => {
  const f = await setup(context);
  f.repository.occurrences.splice(1);
  assert.deepEqual(
    (await f.service.getMuscleGroupWeeklyTrends(f.owner, input)).buckets,
    [
      {
        weekStart: '2026-09-14',
        muscleGroups: [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 1,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 1280,
          },
        ],
      },
    ],
  );
});
void test('muscle trends excludes cancelled, active, foreign and zero-set occurrences but counts bodyweight performance', async (context) => {
  const f = await setup(context);
  const foreign = await f.service.getMuscleGroupWeeklyTrends(f.other, input);
  assert.equal(foreign.buckets[0]?.muscleGroups[0]?.totalVolumeKg, 3000);
  const result = await f.service.getMuscleGroupWeeklyTrends(f.owner, input);
  assert.deepEqual(result.buckets[1]?.muscleGroups[0], {
    muscleGroup: 'CORE',
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 20,
    totalVolumeKg: 0,
  });
  assert.deepEqual(
    (
      await f.service.getMuscleGroupWeeklyTrends(f.owner, {
        ...input,
        from: '2026-09-28T00:00:00Z',
      })
    ).buckets,
    [],
  );
});
void test('muscle range uses inclusive startedAt and does not count zero-set CHEST alongside actual TRICEPS sets', async (context) => {
  const f = await setup(context);
  assert.deepEqual(
    (
      await f.service.getMuscleGroupWeeklyTrends(f.owner, {
        ...input,
        from: '2026-09-18T12:00:00+02:00',
        to: '2026-09-18T10:00:00Z',
      })
    ).buckets,
    [
      {
        weekStart: '2026-09-14',
        muscleGroups: [expectedMuscleBuckets[0]!.muscleGroups[2]],
      },
    ],
  );
});
void test('muscle trends converts Decimal results and explicitly sorts without mutating repository rows', async (context) => {
  const f = await setup(context);
  const rows = await f.repository.findMuscleGroupWeeklyTrends(f.owner, {
    from: new Date(input.from),
    to: new Date(input.to),
    timezone: input.timezone,
  });
  rows.reverse();
  const before = structuredClone(rows);
  f.read.mock.mockImplementation(async () => rows);
  assert.deepEqual(
    (await f.service.getMuscleGroupWeeklyTrends(f.owner, input)).buckets,
    expectedMuscleBuckets,
  );
  assert.deepEqual(rows, before);
  rows[0]!.totalVolumeKg = '1879.9999999998';
  const result = await f.service.getMuscleGroupWeeklyTrends(f.owner, input);
  assert.equal(result.buckets.at(-1)?.muscleGroups.at(-1)?.totalVolumeKg, 1880);
  f.repository.occurrences.splice(1);
  f.repository.occurrences[0]!.sets = [
    { loadKg: '80', reps: 8 },
    { loadKg: '80.5', reps: 8 },
    { loadKg: '82.25', reps: 7 },
  ];
  f.read.mock.restore();
  assert.equal(
    (await f.service.getMuscleGroupWeeklyTrends(f.owner, input)).buckets[0]
      ?.muscleGroups[0]?.totalVolumeKg,
    1859.75,
  );
});
void test('muscle trends reuses explicit timezone Monday semantics', async (context) => {
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
    (await f.service.getMuscleGroupWeeklyTrends(f.owner, input)).buckets.map(
      (b) => b.weekStart,
    ),
    ['2026-09-14', '2026-09-21'],
  );
  for (const timezone of ['UTC', 'America/New_York'])
    assert.deepEqual(
      (
        await f.service.getMuscleGroupWeeklyTrends(f.owner, {
          ...input,
          timezone,
        })
      ).buckets.map((b) => b.weekStart),
      ['2026-09-14'],
    );
});
void test('muscle trends rejects invalid range/timezone/identity before persistence and accepts precisely 730 days', async (context) => {
  const f = await setup(context);
  for (const override of [
    { from: '2026-09-01T00:00:00' },
    { from: '2026-10-01T00:00:00Z' },
    { from: '2023-01-01T00:00:00Z' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
  ])
    await assert.rejects(
      f.service.getMuscleGroupWeeklyTrends(f.owner, { ...input, ...override }),
      InvalidTrainingTrendsQueryError,
    );
  await assert.rejects(
    f.service.getMuscleGroupWeeklyTrends('invalid', input),
    InvalidTrainingTrendsQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
  const to = new Date(input.to);
  await f.service.getMuscleGroupWeeklyTrends(f.owner, {
    ...input,
    from: new Date(to.getTime() - MAX_TRAINING_TRENDS_RANGE_MS).toISOString(),
  });
  await assert.rejects(
    f.service.getMuscleGroupWeeklyTrends(f.owner, {
      ...input,
      from: new Date(
        to.getTime() - MAX_TRAINING_TRENDS_RANGE_MS - 1,
      ).toISOString(),
    }),
    InvalidTrainingTrendsQueryError,
  );
});
void test('muscle trends validates raw enum text and sanitizes unsafe numeric/persistence output', async (context) => {
  const f = await setup(context);
  for (const override of [
    { muscleGroup: 'UNKNOWN' },
    { muscleGroup: 'chest' },
    { muscleGroup: 'toString' },
    { completedWorkouts: '9007199254740992' },
    { completedSets: '-1' },
    { totalVolumeKg: 'NaN' },
  ]) {
    f.read.mock.mockImplementation(async () => [
      {
        weekStart: '2026-09-14',
        muscleGroup: 'CHEST',
        completedWorkouts: '1',
        completedSets: '1',
        totalReps: '8',
        totalVolumeKg: '640',
        ...override,
      },
    ]);
    await assert.rejects(
      f.service.getMuscleGroupWeeklyTrends(f.owner, input),
      TrainingTrendsPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => {
    throw new TrainingTrendsPersistenceError();
  });
  await assert.rejects(
    f.service.getMuscleGroupWeeklyTrends(f.owner, input),
    TrainingTrendsPersistenceError,
  );
});
