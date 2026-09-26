import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { AnalyticsPersistenceError } from '../src/analytics/errors/analytics-persistence.error';
import {
  analyticsMetadataSelect,
  analyticsPerformanceSelect,
} from '../src/analytics/analytics.types';

async function setup(context: TestContext) {
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async (query) => {
      if (query.text.includes('"completedWorkouts"'))
        return [
          {
            completedWorkouts: '0',
            completedSets: '0',
            totalReps: '0',
            totalVolumeKg: '0',
          },
        ];
      if (query.text.includes('AS sessions'))
        return [
          {
            sessions: '30',
            sets: '90',
            reps: '720',
            totalVolumeKg: '57600.00',
          },
        ];
      return [];
    },
  );
  const findMany = context.mock.fn<
    (query: Prisma.WorkoutSessionExerciseFindManyArgs) => Promise<unknown[]>
  >(async () => []);
  const findFirst = context.mock.fn<
    (query: Prisma.WorkoutSessionExerciseFindFirstArgs) => Promise<null>
  >(async () => null);
  const tx = {
    $queryRaw: sql,
    workoutSessionExercise: { findMany, findFirst },
  };
  const transaction = context.mock.fn(
    async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return callback(tx);
    },
  );
  const module = await Test.createTestingModule({
    providers: [
      AnalyticsRepository,
      {
        provide: PrismaService,
        useValue: { ...tx, $transaction: transaction },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    sql,
    findMany,
    findFirst,
    transaction,
    repository: module.get(AnalyticsRepository),
  };
}
void test('overview aggregates in one parametrized SELECT, preserves empty workouts and scopes completed owner/date', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-30T00:00:00Z');
  const result = await f.repository.overview(owner, { from, to });
  assert.equal(result.totalVolumeKg, '0');
  const query = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(query.values, [owner, from, to]);
  assert.equal(query.text.includes(owner), false);
  assert.match(query.text, /w\.user_id = \$1::uuid/);
  assert.match(query.text, /w\.status = 'COMPLETED'/);
  assert.match(query.text, /started_at >= \$2/);
  assert.match(query.text, /started_at <= \$3/);
  assert.match(query.text, /COUNT\(DISTINCT w.id\)/);
  assert.match(query.text, /SUM\(s.load_kg \* s.reps\)/);
  assert.match(query.text, /LEFT JOIN set_entries/);
  assert.equal(f.sql.mock.calls.length, 1);
  assert.equal(f.findMany.mock.calls.length, 0);
});
void test('exercise read uses one repeatable snapshot, all-range aggregates, bounded candidates and paginated ordered snapshots', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  const exerciseId = randomUUID();
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-30T00:00:00Z');
  const result = await f.repository.exercise(owner, exerciseId, {
    page: 3,
    limit: 10,
    from,
    to,
  });
  assert.equal(result.summary.sessions, '30');
  const queries = f.sql.mock.calls.map((call) => call.arguments[0]);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.equal(query.text.includes(owner), false);
    assert.equal(query.text.includes(exerciseId), false);
    assert.deepEqual(query.values.slice(0, 4), [owner, from, to, exerciseId]);
    assert.match(query.text, /w\.status = 'COMPLETED'/);
    assert.match(query.text, /e.source_exercise_id = \$4::uuid/);
    assert.doesNotMatch(
      query.text,
      /(?:FROM|JOIN) (?:exercises|users|workout_templates)\b/,
    );
  }
  assert.doesNotMatch(queries[0]!.text, /LIMIT|OFFSET/);
  assert.match(
    queries[1]!.text,
    /ORDER BY s.load_kg DESC, s.reps DESC, s.completed_at DESC, s.id DESC LIMIT 1/,
  );
  assert.match(queries[2]!.text, /DISTINCT ON \(s.reps\)/);
  assert.match(queries[2]!.text, /s.load_kg > 0 AND s.reps BETWEEN 1 AND \$5/);
  assert.equal(queries[2]!.values[4], 20);
  const where = {
    sourceExerciseId: exerciseId,
    workoutSession: {
      userId: owner,
      status: 'COMPLETED',
      startedAt: { gte: from, lte: to },
    },
  };
  const orderBy = [
    { workoutSession: { startedAt: 'desc' } },
    { workoutSession: { id: 'desc' } },
    { position: 'asc' },
  ];
  assert.deepEqual(f.findFirst.mock.calls[0]?.arguments, [
    { where, select: analyticsMetadataSelect, orderBy },
  ]);
  assert.deepEqual(f.findMany.mock.calls[0]?.arguments, [
    { where, select: analyticsPerformanceSelect, orderBy, skip: 20, take: 10 },
  ]);
  assert.deepEqual(analyticsPerformanceSelect.sets.orderBy, {
    position: 'asc',
  });
  assert.equal(f.transaction.mock.calls.length, 1);
});
void test('query count is constant with page size; raw identifiers cannot interpolate SQL syntax', async (context) => {
  const f = await setup(context);
  const unsafe = "' OR TRUE --";
  for (const limit of [1, 100])
    await f.repository.exercise(unsafe, unsafe, { page: 1, limit });
  assert.equal(f.sql.mock.calls.length, 6);
  assert.equal(f.findMany.mock.calls.length, 2);
  assert.equal(f.findFirst.mock.calls.length, 2);
  for (const call of f.sql.mock.calls) {
    assert.equal(call.arguments[0].text.includes(unsafe), false);
    assert.deepEqual(call.arguments[0].values.slice(0, 2), [unsafe, unsafe]);
  }
});
void test('repository sanitizes persistence failures and never fabricates empty success', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => {
    throw new Error('Private SQL detail');
  });
  for (const operation of [
    () => f.repository.overview(randomUUID(), {}),
    () =>
      f.repository.exercise(randomUUID(), randomUUID(), { page: 1, limit: 20 }),
  ])
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof AnalyticsPersistenceError &&
        !error.message.includes('SQL') &&
        error.cause === undefined,
    );
});
