import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { TrainingCalendarService } from '../src/training-calendar/training-calendar.service';
import { TrainingCalendarRepository } from '../src/training-calendar/training-calendar.repository';
import { InvalidTrainingCalendarQueryError } from '../src/training-calendar/errors/invalid-training-calendar-query.error';
import { TrainingCalendarPersistenceError } from '../src/training-calendar/errors/training-calendar-persistence.error';
import {
  calendarInput as input,
  expectedCalendar,
  trainingCalendarFixture,
  zeroDay,
} from './support/in-memory-training-calendar.repository';

async function setup(context: TestContext) {
  const f = trainingCalendarFixture(),
    read = context.mock.method(f.repository, 'findDailyActivity');
  const module = await Test.createTestingModule({
    providers: [
      TrainingCalendarService,
      { provide: TrainingCalendarRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingCalendarService) };
}
void test('calendar empty single/future and multi-day ranges are dense, owner scoped and zero-filled', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  assert.deepEqual(await f.service.getDays(user, input), {
    ...input,
    days: expectedCalendar.days.map((d) => zeroDay(d.date)),
  });
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [
    user,
    { ...input, totalDays: 7 },
  ]);
  const future = { ...input, fromDate: '2099-01-01', toDate: '2099-01-01' };
  assert.deepEqual(await f.service.getDays(user, future), {
    ...future,
    days: [zeroDay(future.fromDate)],
  });
});
void test('calendar exact main result preserves same-day workouts, zero sets, bodyweight and owner/status isolation', async (context) => {
  const f = await setup(context);
  assert.deepEqual(await f.service.getDays(f.owner, input), expectedCalendar);
  assert.equal(
    (await f.service.getDays(f.other, input)).days[0]!.totalVolumeKg,
    100000,
  );
});
void test('calendar several exercises/sets cannot multiply workout duration; fractions remain clean', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  f.add(user, '2026-09-28T08:00:00Z', 3600.001, [
    ...f.sets('80', 8, 3),
    ...f.sets('82.25', 7, 2),
  ]);
  const result = await f.service.getDays(user, input);
  assert.deepEqual(result.days[0], {
    date: input.fromDate,
    completedWorkouts: 1,
    completedSets: 5,
    totalReps: 38,
    totalVolumeKg: 3071.5,
    totalDurationSeconds: 3600.001,
  });
});
void test('calendar order is ASC regardless of repository order and inputs are not mutated', async (context) => {
  const f = await setup(context);
  const rows = await f.repository.findDailyActivity(f.owner, {
    ...input,
    totalDays: 7,
  });
  const reversed = rows.reverse();
  f.read.mock.mockImplementation(async () => reversed);
  const before = structuredClone(reversed);
  assert.deepEqual(await f.service.getDays(f.owner, input), expectedCalendar);
  assert.deepEqual(reversed, before);
});
void test('calendar validation checks real dates, inclusive 366 limit and IANA without a current clock', async (context) => {
  const f = await setup(context);
  for (const override of [
    { fromDate: '2026-02-30' },
    { fromDate: '2026-09-28T00:00:00Z' },
    { toDate: '2026-09-27' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
  ])
    await assert.rejects(
      f.service.getDays(f.owner, { ...input, ...override }),
      InvalidTrainingCalendarQueryError,
    );
  await assert.rejects(
    f.service.getDays('invalid', input),
    InvalidTrainingCalendarQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
  assert.equal(
    (
      await f.service.getDays(f.owner, {
        ...input,
        fromDate: '2024-01-01',
        toDate: '2024-12-31',
      })
    ).days.length,
    366,
  );
});
void test('calendar crossing midnight puts every metric in startedAt local date, not UTC or end date', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  f.add(user, '2026-09-27T21:30:00Z', 3600, f.sets('80', 8));
  f.add(user, '2026-09-27T22:00:00Z', 0);
  const range = { ...input, fromDate: '2026-09-27', toDate: '2026-09-28' };
  const madrid = await f.service.getDays(user, range);
  assert.deepEqual(madrid.days[0], {
    date: '2026-09-27',
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 8,
    totalVolumeKg: 640,
    totalDurationSeconds: 3600,
  });
  assert.equal(madrid.days[1]!.completedWorkouts, 1);
  assert.equal(madrid.days[1]!.totalDurationSeconds, 0);
  assert.equal(
    (await f.service.getDays(user, { ...range, timezone: 'UTC' })).days[0]!
      .completedWorkouts,
    2,
  );
});
void test('calendar rejects duplicate/outside dates and malformed or corrupt aggregates instead of partial success', async (context) => {
  const f = await setup(context);
  const valid = {
    date: input.fromDate,
    completedWorkouts: '1',
    completedSets: '0',
    totalReps: '0',
    totalVolumeKg: '0',
    totalDurationSeconds: '0',
    invalidDurationCount: '0',
  };
  for (const rows of [
    [valid, valid],
    ...[
      { date: '2026-09-27' },
      { date: '2026-02-30' },
      { completedWorkouts: '0' },
      { completedSets: '9007199254740992' },
      { totalReps: '-1' },
      { totalVolumeKg: '-1' },
      { totalVolumeKg: 'NaN' },
      { totalDurationSeconds: null },
      { totalDurationSeconds: '-1' },
      { totalDurationSeconds: '0.0001' },
      { invalidDurationCount: '1' },
    ].map((override) => [{ ...valid, ...override }]),
  ]) {
    f.read.mock.mockImplementation(async () => rows);
    await assert.rejects(
      f.service.getDays(f.owner, input),
      TrainingCalendarPersistenceError,
    );
  }
});
void test('calendar null/negative durations and unexpected SQL failures are sanitized', async (context) => {
  const f = await setup(context);
  for (const seconds of [null, -1]) {
    const user = randomUUID();
    f.add(user, '2026-09-28T08:00:00Z', 600);
    f.add(user, '2026-09-28T10:00:00Z', seconds);
    await assert.rejects(
      f.service.getDays(user, input),
      TrainingCalendarPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => {
    throw new Error('private SQL');
  });
  await assert.rejects(
    f.service.getDays(f.owner, input),
    (error: unknown) =>
      error instanceof TrainingCalendarPersistenceError &&
      !error.message.includes('private') &&
      error.cause === undefined,
  );
});
