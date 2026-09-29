import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { InvalidTrainingTrendsQueryError } from '../src/training-trends/errors/invalid-training-trends-query.error';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';
import {
  MAX_TRAINING_TRENDS_RANGE_MS,
  normalizeTrainingTimezone,
} from '../src/training-trends/training-trends.validation';
import type { WeeklyTrainingTrendsInput } from '../src/training-trends/training-trends.types';
import { trainingTrendsFixture } from './support/in-memory-training-trends.repository';

const input = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-30T23:59:59+02:00',
  timezone: 'Europe/Madrid',
};
async function setup(context: TestContext) {
  const f = trainingTrendsFixture();
  const read = context.mock.method(f.repository, 'findWeeklyTrends');
  const module = await Test.createTestingModule({
    providers: [
      TrainingTrendsService,
      { provide: TrainingTrendsRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingTrendsService) };
}
void test('weekly empty response is sparse, explicitly scoped and canonicalizes response instants to UTC', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  assert.deepEqual(await f.service.getWeeklyTrends(user, input), {
    timezone: 'Europe/Madrid',
    from: input.from.replace('Z', '.000Z'),
    to: '2026-09-30T21:59:59.000Z',
    buckets: [],
  });
  assert.deepEqual(f.read.mock.calls[0]?.arguments, [
    user,
    {
      from: new Date(input.from),
      to: new Date(input.to),
      timezone: input.timezone,
    },
  ]);
});
void test('weekly aggregates only completed owned workouts, keeps zero sets and chronological buckets', async (context) => {
  const f = await setup(context);
  const result = await f.service.getWeeklyTrends(f.owner, input);
  assert.deepEqual(result.buckets, [
    {
      weekStart: '2026-09-14',
      completedWorkouts: 2,
      completedSets: 2,
      totalReps: 16,
      totalVolumeKg: 1280,
    },
    {
      weekStart: '2026-09-21',
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 7,
      totalVolumeKg: 575.75,
    },
  ]);
  assert.equal(
    (await f.service.getWeeklyTrends(f.other, input)).buckets[0]?.totalVolumeKg,
    3000,
  );
  assert.equal(JSON.stringify(result).includes('userId'), false);
});
void test('weekly inclusive range uses startedAt and can isolate a zero-set workout', async (context) => {
  const f = await setup(context);
  const result = await f.service.getWeeklyTrends(f.owner, {
    ...input,
    from: '2026-09-18T12:00:00+02:00',
    to: '2026-09-18T10:00:00Z',
  });
  assert.deepEqual(result.buckets, [
    {
      weekStart: '2026-09-14',
      completedWorkouts: 1,
      completedSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
    },
  ]);
});
void test('weekly zero external load counts reps/sets but not volume; numeric conversion reuses exact analytics rounding', async (context) => {
  const f = await setup(context);
  f.repository.sessions.push({
    userId: f.owner,
    startedAt: new Date('2026-09-28T10:00:00Z'),
    status: 'COMPLETED',
    sets: [{ loadKg: '0', reps: 20 }],
  });
  assert.deepEqual(
    (await f.service.getWeeklyTrends(f.owner, input)).buckets.at(-1),
    {
      weekStart: '2026-09-28',
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 20,
      totalVolumeKg: 0,
    },
  );
  f.read.mock.mockImplementation(async () => [
    {
      weekStart: '2026-09-14',
      completedWorkouts: '1000',
      completedSets: '2000',
      totalReps: '16000',
      totalVolumeKg: '21450.7499999997',
    },
  ]);
  assert.equal(
    (await f.service.getWeeklyTrends(f.owner, input)).buckets[0]?.totalVolumeKg,
    21450.75,
  );
});
void test('weekly accepts exactly 730 elapsed days and rejects one millisecond more', async (context) => {
  const f = await setup(context);
  const from = new Date('2024-09-29T00:00:00Z');
  await f.service.getWeeklyTrends(f.owner, {
    ...input,
    from: from.toISOString(),
    to: new Date(from.getTime() + MAX_TRAINING_TRENDS_RANGE_MS).toISOString(),
  });
  await assert.rejects(
    f.service.getWeeklyTrends(f.owner, {
      ...input,
      from: from.toISOString(),
      to: new Date(
        from.getTime() + MAX_TRAINING_TRENDS_RANGE_MS + 1,
      ).toISOString(),
    }),
    InvalidTrainingTrendsQueryError,
  );
});
void test('timezone validation uses Intl named zones and excludes arbitrary/fixed-offset strings', () => {
  for (const timezone of [
    'Europe/Madrid',
    'America/New_York',
    'UTC',
    'Asia/Kathmandu',
    'Etc/GMT+2',
  ])
    assert.equal(typeof normalizeTrainingTimezone(timezone), 'string');
  assert.equal(normalizeTrainingTimezone('utc'), 'UTC');
  for (const timezone of [
    '',
    ' ',
    ' Europe/Madrid',
    'Europe/Foo',
    'GMT+2',
    '+02:00',
    '-05',
    null,
    undefined,
    2,
    ['UTC'],
    "UTC'; SELECT 1 --",
  ])
    assert.throws(
      () => normalizeTrainingTimezone(timezone),
      InvalidTrainingTrendsQueryError,
    );
});
void test('weekly rejects missing/ambiguous/impossible/reversed dates and identity before reading', async (context) => {
  const f = await setup(context);
  for (const override of [
    { from: undefined },
    { to: undefined },
    { timezone: undefined },
    { from: null },
    { from: '2026-09-01T00:00:00' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-10-01T00:00:00Z' },
  ])
    await assert.rejects(
      f.service.getWeeklyTrends(f.owner, {
        ...input,
        ...override,
      } as WeeklyTrainingTrendsInput),
      InvalidTrainingTrendsQueryError,
    );
  await assert.rejects(
    f.service.getWeeklyTrends('invalid', input),
    InvalidTrainingTrendsQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
});
void test('weekly protects precision and sanitizes impossible persistence values without inventing empty data', async (context) => {
  const f = await setup(context);
  for (const data of [
    { completedWorkouts: '9007199254740992' },
    { totalReps: '-1' },
    { totalVolumeKg: 'Infinity' },
    { totalVolumeKg: '9007199254740992' },
  ]) {
    f.read.mock.mockImplementation(async () => [
      {
        weekStart: '2026-09-14',
        completedWorkouts: '1',
        completedSets: '1',
        totalReps: '8',
        totalVolumeKg: '640',
        ...data,
      },
    ]);
    await assert.rejects(
      f.service.getWeeklyTrends(f.owner, input),
      TrainingTrendsPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => {
    throw new TrainingTrendsPersistenceError();
  });
  await assert.rejects(
    f.service.getWeeklyTrends(f.owner, input),
    TrainingTrendsPersistenceError,
  );
});
