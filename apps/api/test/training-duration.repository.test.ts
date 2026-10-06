import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingDurationRepository } from '../src/training-duration/training-duration.repository';
import { TrainingDurationPersistenceError } from '../src/training-duration/errors/training-duration-persistence.error';
import { durationInput } from './support/in-memory-training-duration.repository';
const query = {
  ...durationInput,
  from: new Date(durationInput.from),
  to: new Date(durationInput.to),
};
async function setup(context: TestContext) {
  const rows = [
    {
      weekStart: '2026-09-07',
      completedWorkouts: '2',
      totalDurationSeconds: '7200.000000',
      invalidDurationCount: '0',
    },
  ];
  const read = context.mock.fn<(sql: Prisma.Sql) => Promise<unknown[]>>(
    async () => rows,
  );
  const module = await Test.createTestingModule({
    providers: [
      TrainingDurationRepository,
      { provide: PrismaService, useValue: { $queryRaw: read } },
    ],
  }).compile();
  context.after(() => module.close());
  return { rows, read, repository: module.get(TrainingDurationRepository) };
}
void test('duration SQL uses one completed-owner scoped read with explicit instant parameters', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  assert.deepEqual(await f.repository.findWeeklyDurations(user, query), f.rows);
  assert.equal(f.read.mock.calls.length, 1);
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [
    query.timezone,
    user,
    query.from.toISOString(),
    query.to.toISOString(),
  ]);
  assert.match(sql.text, /w.user_id = \$2::uuid AND w.status = 'COMPLETED'/);
  assert.match(sql.text, /w.started_at >= \$3::timestamptz/);
  assert.match(sql.text, /w.started_at <= \$4::timestamptz/);
});
void test('duration SQL separates local Monday grouping from NUMERIC instant subtraction without child joins', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyDurations(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /date_trunc\('week', w.started_at AT TIME ZONE \$1\)/);
  assert.match(sql, /COUNT\(w.id\)/);
  assert.match(
    sql,
    /SUM\(EXTRACT\(EPOCH FROM \(w.ended_at - w.started_at\)\)\)::text/,
  );
  assert.match(sql, /GROUP BY 1 ORDER BY 1 ASC/);
  assert.doesNotMatch(
    sql,
    /JOIN|set_entries|workout_session_exercises|created_at|updated_at|float|double precision|generate_series/i,
  );
});
void test('duration SQL detects null and negative intervals without filtering them, ABS or clock fallback', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyDurations(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /COUNT\(\*\) FILTER \(WHERE w.ended_at IS NULL OR w.ended_at < w.started_at\)/,
  );
  const scope = sql.slice(sql.indexOf('FROM workout_sessions'));
  assert.doesNotMatch(scope, /ended_at/);
  assert.doesNotMatch(sql, /ABS\(|COALESCE|NOW\(|CURRENT_TIMESTAMP/i);
});
void test('duration SQL keeps injection strings in bound parameters and query count fixed for empty history', async (context) => {
  const f = await setup(context),
    malicious = "'; SELECT 1 --";
  await f.repository.findWeeklyDurations(malicious, {
    ...query,
    timezone: malicious,
  });
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.equal(sql.text.includes(malicious), false);
  assert.deepEqual(sql.values.slice(0, 2), [malicious, malicious]);
  f.read.mock.mockImplementation(async () => []);
  assert.deepEqual(
    await f.repository.findWeeklyDurations(randomUUID(), query),
    [],
  );
  assert.equal(f.read.mock.calls.length, 2);
});
void test('duration SQL errors never leak persistence details or become empty success', async (context) => {
  const f = await setup(context);
  f.read.mock.mockImplementation(async () => {
    throw new Error('private SQL credentials');
  });
  await assert.rejects(
    f.repository.findWeeklyDurations(randomUUID(), query),
    (error: unknown) =>
      error instanceof TrainingDurationPersistenceError &&
      !error.message.includes('private') &&
      error.cause === undefined,
  );
});
