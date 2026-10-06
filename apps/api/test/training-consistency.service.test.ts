import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { shiftLocalMonday } from '../src/common/calendar-week';
import { TrainingConsistencyRepository } from '../src/training-consistency/training-consistency.repository';
import { TrainingConsistencyService } from '../src/training-consistency/training-consistency.service';
import { InvalidTrainingConsistencyQueryError } from '../src/training-consistency/errors/invalid-training-consistency-query.error';
import { TrainingConsistencyPersistenceError } from '../src/training-consistency/errors/training-consistency-persistence.error';
import {
  trainingConsistencyFixture,
  consistencyInput as input,
  expectedConsistency,
} from './support/in-memory-training-consistency.repository';

async function setup(context: TestContext) {
  const f = trainingConsistencyFixture();
  const read = context.mock.method(f.repository, 'findWeeklyActivity');
  const module = await Test.createTestingModule({
    providers: [
      TrainingConsistencyService,
      { provide: TrainingConsistencyRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingConsistencyService) };
}
void test('consistency empty response preserves inclusive totalWeeks and scopes principal even for future weeks', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  assert.deepEqual(await f.service.getWeeklyConsistency(user, input), {
    ...expectedConsistency,
    completedWorkouts: 0,
    activeDays: 0,
    activeWeeks: 0,
    longestWeeklyStreak: 0,
    endingWeeklyStreak: 0,
  });
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [
    user,
    { ...input, totalWeeks: 6 },
  ]);
  const future = await f.service.getWeeklyConsistency(user, {
    ...input,
    fromWeekStart: '2099-01-05',
    toWeekStart: '2099-01-05',
  });
  assert.equal(future.totalWeeks, 1);
  assert.equal(future.completedWorkouts, 0);
});
void test('consistency totals 7 workouts, 6 local days, 5 weeks, longest/ending 3 with no sets required', async (context) => {
  const f = await setup(context);
  const result = await f.service.getWeeklyConsistency(f.owner, input);
  assert.deepEqual(result, expectedConsistency);
  assert.equal(JSON.stringify(result).includes('userId'), false);
  assert.equal(Object.keys(result).length, 9);
  const b = await f.service.getWeeklyConsistency(f.other, input);
  assert.equal(b.activeWeeks, 6);
  assert.equal(b.longestWeeklyStreak, 6);
});
void test('consistency ending means exactly toWeekStart, excludes unfinished activity and clips earlier streak', async (context) => {
  const f = await setup(context);
  const result = await f.service.getWeeklyConsistency(f.owner, {
    ...input,
    toWeekStart: '2026-09-07',
  });
  assert.equal(result.totalWeeks, 3);
  assert.equal(result.completedWorkouts, 4);
  assert.equal(result.longestWeeklyStreak, 2);
  assert.equal(result.endingWeeklyStreak, 0);
  const clipped = await f.service.getWeeklyConsistency(f.owner, {
    ...input,
    fromWeekStart: '2026-09-21',
  });
  assert.equal(clipped.longestWeeklyStreak, 2);
  assert.equal(clipped.endingWeeklyStreak, 2);
});
void test('same-day workouts count individually; separate local days sum across weeks', async (context) => {
  const f = await setup(context);
  const first = await f.service.getWeeklyConsistency(f.owner, {
    ...input,
    toWeekStart: input.fromWeekStart,
  });
  assert.equal(first.completedWorkouts, 3);
  assert.equal(first.activeDays, 2);
  assert.equal(first.activeWeeks, 1);
  const zeroSets = await f.service.getWeeklyConsistency(f.owner, {
    ...input,
    fromWeekStart: '2026-08-31',
    toWeekStart: '2026-08-31',
  });
  assert.equal(zeroSets.completedWorkouts, 1);
  assert.equal(zeroSets.endingWeeklyStreak, 1);
});
void test('consistency normalizes duplicate identical week rows, ignores accidental order and never mutates data', async (context) => {
  const f = await setup(context);
  const rows = await f.repository.findWeeklyActivity(f.owner, {
    ...input,
    totalWeeks: 6,
  });
  rows.reverse();
  rows.push({ ...rows[0]! });
  const before = structuredClone(rows);
  f.read.mock.mockImplementation(async () => rows);
  assert.deepEqual(
    await f.service.getWeeklyConsistency(f.owner, input),
    expectedConsistency,
  );
  assert.deepEqual(rows, before);
});
void test('consistency validates real Mondays, identity, IANA, order and inclusive 104-week boundary before DB', async (context) => {
  const f = await setup(context);
  for (const override of [
    { fromWeekStart: '2026-08-25' },
    { toWeekStart: '2026-09-29' },
    { fromWeekStart: '2026-02-30' },
    { fromWeekStart: '2026-08-24T00:00:00Z' },
    { fromWeekStart: '2026-10-05' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { toWeekStart: shiftLocalMonday(input.fromWeekStart, 104) },
  ])
    await assert.rejects(
      f.service.getWeeklyConsistency(f.owner, { ...input, ...override }),
      InvalidTrainingConsistencyQueryError,
    );
  await assert.rejects(
    f.service.getWeeklyConsistency('invalid', input),
    InvalidTrainingConsistencyQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
  const max = await f.service.getWeeklyConsistency(f.owner, {
    ...input,
    toWeekStart: shiftLocalMonday(input.fromWeekStart, 103),
  });
  assert.equal(max.totalWeeks, 104);
});
void test('consistency rejects corrupt/conflicting aggregates and overflow rather than returning misleading totals', async (context) => {
  const f = await setup(context);
  const row = {
    weekStart: input.fromWeekStart,
    completedWorkouts: '3',
    activeDays: '2',
  };
  for (const override of [
    { weekStart: '2026-08-17' },
    { weekStart: '2026-08-25' },
    { completedWorkouts: '-1' },
    { completedWorkouts: 'NaN' },
    { completedWorkouts: '9007199254740992' },
    { activeDays: '8' },
    { activeDays: '0' },
    { activeDays: '4' },
  ]) {
    f.read.mock.mockImplementation(async () => [{ ...row, ...override }]);
    await assert.rejects(
      f.service.getWeeklyConsistency(f.owner, input),
      TrainingConsistencyPersistenceError,
    );
  }
  for (const rows of [
    [row, { ...row, completedWorkouts: '4' }],
    [
      { ...row, completedWorkouts: '9007199254740991' },
      { ...row, weekStart: '2026-08-31' },
    ],
  ]) {
    f.read.mock.mockImplementation(async () => rows);
    await assert.rejects(
      f.service.getWeeklyConsistency(f.owner, input),
      TrainingConsistencyPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => {
    throw new TrainingConsistencyPersistenceError();
  });
  await assert.rejects(
    f.service.getWeeklyConsistency(f.owner, input),
    TrainingConsistencyPersistenceError,
  );
});
