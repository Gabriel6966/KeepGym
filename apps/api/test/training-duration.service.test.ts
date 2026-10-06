import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { TrainingDurationService } from '../src/training-duration/training-duration.service';
import { TrainingDurationRepository } from '../src/training-duration/training-duration.repository';
import { InvalidTrainingDurationQueryError } from '../src/training-duration/errors/invalid-training-duration-query.error';
import { TrainingDurationPersistenceError } from '../src/training-duration/errors/training-duration-persistence.error';
import {
  durationInput as input,
  expectedDuration,
  trainingDurationFixture,
} from './support/in-memory-training-duration.repository';

async function setup(context: TestContext) {
  const f = trainingDurationFixture();
  const read = context.mock.method(f.repository, 'findWeeklyDurations');
  const module = await Test.createTestingModule({
    providers: [
      TrainingDurationService,
      { provide: TrainingDurationRepository, useValue: f.repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(TrainingDurationService) };
}
void test('duration empty summary uses null average and preserves normalized range and owner contract', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  assert.deepEqual(await f.service.getWeeklyDuration(user, input), {
    ...expectedDuration,
    summary: {
      completedWorkouts: 0,
      totalDurationSeconds: 0,
      averageDurationSeconds: null,
    },
    buckets: [],
  });
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [
    user,
    {
      from: new Date(input.from),
      to: new Date(input.to),
      timezone: input.timezone,
    },
  ]);
});
void test('duration public totals and sparse weeks are completed-only, scoped and millisecond exact', async (context) => {
  const f = await setup(context);
  assert.deepEqual(
    await f.service.getWeeklyDuration(f.owner, input),
    expectedDuration,
  );
  assert.equal(
    (await f.service.getWeeklyDuration(f.other, input)).summary
      .totalDurationSeconds,
    900000,
  );
});
void test('duration summary is weighted from totals, not an average of weekly averages', async (context) => {
  const f = await setup(context);
  f.read.mock.mockImplementation(async () => [
    {
      weekStart: '2026-09-14',
      completedWorkouts: '3',
      totalDurationSeconds: '900.000000',
      invalidDurationCount: '0',
    },
    {
      weekStart: '2026-09-07',
      completedWorkouts: '1',
      totalDurationSeconds: '100.000000',
      invalidDurationCount: '0',
    },
  ]);
  const result = await f.service.getWeeklyDuration(f.owner, input);
  assert.deepEqual(result.summary, {
    completedWorkouts: 4,
    totalDurationSeconds: 1000,
    averageDurationSeconds: 250,
  });
  assert.deepEqual(
    result.buckets.map((b) => b.averageDurationSeconds),
    [100, 300],
  );
  assert.deepEqual(
    result.buckets.map((b) => b.weekStart),
    ['2026-09-07', '2026-09-14'],
  );
});
void test('duration zero is an observation and sessions longer than 24 hours have no arbitrary cap', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  f.add(user, '2026-09-14T00:00:00Z', 0);
  const zero = await f.service.getWeeklyDuration(user, input);
  assert.deepEqual(zero.summary, {
    completedWorkouts: 1,
    totalDurationSeconds: 0,
    averageDurationSeconds: 0,
  });
  f.add(user, '2026-09-21T00:00:00Z', 172800.001);
  assert.equal(
    (await f.service.getWeeklyDuration(user, input)).summary
      .totalDurationSeconds,
    172800.001,
  );
});
void test('duration includes full sessions by inclusive startedAt only and assigns crossing-week sessions to start', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  f.add(user, '2026-09-13T21:30:00Z', 3600);
  const query = {
    ...input,
    from: '2026-09-13T21:30:00Z',
    to: '2026-09-13T21:30:00Z',
  };
  const result = await f.service.getWeeklyDuration(user, query);
  assert.equal(result.summary.totalDurationSeconds, 3600);
  assert.equal(result.buckets[0]!.weekStart, '2026-09-07');
  assert.equal(
    (
      await f.service.getWeeklyDuration(user, {
        ...query,
        from: '2026-09-13T21:30:00.001Z',
        to: '2026-09-14T01:00:00Z',
      })
    ).summary.completedWorkouts,
    0,
  );
});
void test('duration validation reuses strict timestamps, named zones and inclusive 730-day maximum', async (context) => {
  const f = await setup(context);
  for (const override of [
    { from: '' },
    { from: '2026-09-07T00:00:00' },
    { from: '2026-02-30T00:00:00Z' },
    { from: input.to, to: input.from },
    { timezone: 'GMT+2' },
    { timezone: 'Europe/Foo' },
    { timezone: '+02:00' },
    { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  ])
    await assert.rejects(
      f.service.getWeeklyDuration(f.owner, { ...input, ...override }),
      InvalidTrainingDurationQueryError,
    );
  await assert.rejects(
    f.service.getWeeklyDuration('invalid', input),
    InvalidTrainingDurationQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
  await f.service.getWeeklyDuration(f.owner, {
    ...input,
    from: '2025-01-01T00:00:00Z',
    to: '2027-01-01T00:00:00Z',
  });
  for (const timezone of ['UTC', 'Europe/Madrid', 'America/New_York'])
    await f.service.getWeeklyDuration(f.owner, { ...input, timezone });
});
void test('duration null or negative completed intervals fail the whole response even if the sum remains positive', async (context) => {
  const f = await setup(context);
  for (const seconds of [null, -1]) {
    const user = randomUUID();
    f.add(user, '2026-09-07T08:00:00Z', 3600);
    f.add(user, '2026-09-07T09:00:00Z', seconds);
    await assert.rejects(
      f.service.getWeeklyDuration(user, input),
      TrainingDurationPersistenceError,
    );
  }
});
void test('duration corrupt aggregate data and unexpected persistence failures are sanitized', async (context) => {
  const f = await setup(context);
  const valid = {
    weekStart: '2026-09-07',
    completedWorkouts: '1',
    totalDurationSeconds: '1',
    invalidDurationCount: '0',
  };
  for (const override of [
    { totalDurationSeconds: null },
    { totalDurationSeconds: '-1' },
    { totalDurationSeconds: 'Infinity' },
    { totalDurationSeconds: '0.0001' },
    { completedWorkouts: '0' },
    { completedWorkouts: '9007199254740992' },
    { invalidDurationCount: '1' },
    { weekStart: '2026-09-08' },
  ]) {
    f.read.mock.mockImplementation(async () => [{ ...valid, ...override }]);
    await assert.rejects(
      f.service.getWeeklyDuration(f.owner, input),
      TrainingDurationPersistenceError,
    );
  }
  f.read.mock.mockImplementation(async () => {
    throw new Error('private SQL detail');
  });
  await assert.rejects(
    f.service.getWeeklyDuration(f.owner, input),
    (error: unknown) =>
      error instanceof TrainingDurationPersistenceError &&
      !error.message.includes('private') &&
      error.cause === undefined,
  );
});
