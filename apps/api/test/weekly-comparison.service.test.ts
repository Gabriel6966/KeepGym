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
  weeklyComparisonFixture,
  comparisonInput as input,
  expectedComparison,
} from './support/in-memory-weekly-comparison.repository';

async function setup(context: TestContext) {
  const f = weeklyComparisonFixture();
  const read = context.mock.method(f.repository, 'findWeeklyComparison');
  const module = await Test.createTestingModule({
    providers: [
      TrainingTrendsService,
      { provide: TrainingTrendsRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingTrendsService) };
}
void test('weekly comparison scopes principal, completed only, zero-set workouts and exact Decimal changes', async (context) => {
  const f = await setup(context);
  assert.deepEqual(
    await f.service.getWeeklyComparison(f.owner, input),
    expectedComparison,
  );
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [
    f.owner,
    { ...input, previousWeekStart: '2026-09-21' },
  ]);
  const other = await f.service.getWeeklyComparison(f.other, input);
  assert.equal(other.current.totalVolumeKg, 3000);
  assert.equal(other.previous.completedWorkouts, 0);
  assert.equal(other.changes.totalVolumeKg.percentageChange, null);
});
void test('comparison zero-fills both periods, accepts future Monday and never adds interpretation', async (context) => {
  const f = await setup(context);
  for (const weekStart of [input.weekStart, '2099-01-05']) {
    const result = await f.service.getWeeklyComparison(randomUUID(), {
      ...input,
      weekStart,
    });
    for (const period of [result.previous, result.current])
      assert.deepEqual(Object.values(period).slice(1), [0, 0, 0, 0]);
    for (const change of Object.values(result.changes))
      assert.deepEqual(change, { delta: 0, percentageChange: null });
    assert.deepEqual(Object.keys(result), [
      'timezone',
      'previous',
      'current',
      'changes',
    ]);
  }
});
void test('comparison handles either empty period, positive/negative/equal changes and minus 100 percent', async (context) => {
  const f = await setup(context);
  const firstWeek = await f.service.getWeeklyComparison(f.owner, {
    ...input,
    weekStart: '2026-09-21',
  });
  assert.deepEqual(firstWeek.changes.completedWorkouts, {
    delta: 2,
    percentageChange: null,
  });
  assert.deepEqual(firstWeek.changes.totalVolumeKg, {
    delta: 1280,
    percentageChange: null,
  });
  const nextWeek = await f.service.getWeeklyComparison(f.owner, {
    ...input,
    weekStart: '2026-10-05',
  });
  assert.deepEqual(nextWeek.changes.completedSets, {
    delta: -2,
    percentageChange: -100,
  });
  assert.deepEqual(nextWeek.changes.totalVolumeKg, {
    delta: -1151.5,
    percentageChange: -100,
  });
  f.repository.sessions[2]!.sets = [{ loadKg: '200', reps: 10 }];
  const positive = await f.service.getWeeklyComparison(f.owner, input);
  assert.deepEqual(positive.changes.totalVolumeKg, {
    delta: 720,
    percentageChange: 56.25,
  });
});
void test('comparison uses local calendar Mondays across year boundaries and does not mutate repository rows', async (context) => {
  const f = await setup(context);
  const rows = await f.repository.findWeeklyComparison(f.owner, {
    ...input,
    previousWeekStart: '2026-09-21',
  });
  rows.reverse();
  const original = structuredClone(rows);
  f.read.mock.mockImplementation(async () => rows);
  assert.deepEqual(
    await f.service.getWeeklyComparison(f.owner, input),
    expectedComparison,
  );
  assert.deepEqual(rows, original);
  f.read.mock.mockImplementation(async () => []);
  for (const timezone of ['UTC', 'Europe/Madrid', 'America/New_York']) {
    const result = await f.service.getWeeklyComparison(f.owner, {
      weekStart: '2026-01-05',
      timezone,
    });
    assert.equal(result.previous.weekStart, '2025-12-29');
    assert.equal(result.timezone, timezone);
  }
});
void test('comparison rejects rollover dates, timestamps, non-Mondays, invalid identity/timezone before reading', async (context) => {
  const f = await setup(context);
  for (const weekStart of [
    '',
    '2026-02-31',
    '2026-09-29',
    '2026-09-28T00:00:00Z',
    '2026-9-28',
    ' 2026-09-28 ',
    '0000-01-01',
    '0001-01-01',
    '9999-12-27',
  ])
    await assert.rejects(
      f.service.getWeeklyComparison(f.owner, { ...input, weekStart }),
      InvalidTrainingTrendsQueryError,
    );
  for (const timezone of ['', 'Europe/Foo', 'GMT+2', '+02:00', ' UTC '])
    await assert.rejects(
      f.service.getWeeklyComparison(f.owner, { ...input, timezone }),
      InvalidTrainingTrendsQueryError,
    );
  await assert.rejects(
    f.service.getWeeklyComparison('invalid', input),
    InvalidTrainingTrendsQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
});
void test('comparison rejects corrupt aggregates safely instead of fabricating zero periods', async (context) => {
  const f = await setup(context);
  const base = {
    weekStart: input.weekStart,
    completedWorkouts: '1',
    completedSets: '1',
    totalReps: '1',
    totalVolumeKg: '82.25',
  };
  for (const override of [
    { weekStart: '2026-09-14' },
    { completedWorkouts: '-1' },
    { completedSets: '9007199254740992' },
    { totalVolumeKg: 'NaN' },
    { totalVolumeKg: '-1.00' },
    { totalVolumeKg: '1.001' },
  ]) {
    f.read.mock.mockImplementation(async () => [{ ...base, ...override }]);
    await assert.rejects(
      f.service.getWeeklyComparison(f.owner, input),
      TrainingTrendsPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => [base, base]);
  await assert.rejects(
    f.service.getWeeklyComparison(f.owner, input),
    TrainingTrendsPersistenceError,
  );
  f.read.mock.mockImplementation(async () => {
    throw new TrainingTrendsPersistenceError();
  });
  await assert.rejects(
    f.service.getWeeklyComparison(f.owner, input),
    TrainingTrendsPersistenceError,
  );
});
