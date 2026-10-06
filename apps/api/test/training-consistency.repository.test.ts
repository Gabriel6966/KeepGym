import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingConsistencyRepository } from '../src/training-consistency/training-consistency.repository';
import { TrainingConsistencyPersistenceError } from '../src/training-consistency/errors/training-consistency-persistence.error';

const query = {
  fromWeekStart: '2026-08-24',
  toWeekStart: '2026-09-28',
  timezone: 'Europe/Madrid',
  totalWeeks: 6,
};
async function setup(context: TestContext) {
  const rows = [
    { weekStart: query.fromWeekStart, completedWorkouts: '3', activeDays: '2' },
  ];
  const read = context.mock.fn<(sql: Prisma.Sql) => Promise<unknown[]>>(
    async () => rows,
  );
  const module = await Test.createTestingModule({
    providers: [
      TrainingConsistencyRepository,
      { provide: PrismaService, useValue: { $queryRaw: read } },
    ],
  }).compile();
  context.after(() => module.close());
  return { rows, read, repository: module.get(TrainingConsistencyRepository) };
}
void test('consistency SQL parametrizes completed owner, local Monday dates and timezone in one read', async (context) => {
  const f = await setup(context);
  const userId = randomUUID();
  assert.deepEqual(
    await f.repository.findWeeklyActivity(userId, query),
    f.rows,
  );
  assert.equal(f.read.mock.calls.length, 1);
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [
    query.fromWeekStart,
    query.toWeekStart,
    query.timezone,
    userId,
  ]);
  assert.match(sql.text, /w.user_id = \$4::uuid AND w.status = 'COMPLETED'/);
  assert.doesNotMatch(
    sql.text,
    /CANCELLED|IN_PROGRESS|ended_at|created_at|updated_at/,
  );
});
void test('consistency counts sessions and distinct local days in Monday buckets, without requiring any child records', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyActivity(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /date_trunc\('week', w.started_at AT TIME ZONE p.zone\)/);
  assert.match(sql, /COUNT\(w.id\)::text AS "completedWorkouts"/);
  assert.match(
    sql,
    /COUNT\(DISTINCT \(w.started_at AT TIME ZONE p.zone\)::date\)::text AS "activeDays"/,
  );
  assert.match(sql, /FROM workout_sessions w/);
  assert.match(sql, /GROUP BY 1 ORDER BY 1 ASC/);
  assert.doesNotMatch(
    sql,
    /workout_session_exercises|set_entries|users|profiles|workout_templates|EXISTS|LIMIT|OFFSET/i,
  );
});
void test('consistency boundaries are half-open local calendar midnights, not a fixed UTC duration', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyActivity(randomUUID(), query);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /w.started_at >= \(p.first_monday::timestamp AT TIME ZONE p.zone\)/,
  );
  assert.match(
    sql,
    /w.started_at < \(\(p.last_monday \+ 7\)::timestamp AT TIME ZONE p.zone\)/,
  );
  assert.doesNotMatch(sql, /168|23:59|INTERVAL|started_at <=|BETWEEN/i);
});
void test('consistency query count stays fixed and raw inputs cannot become SQL syntax', async (context) => {
  const f = await setup(context);
  const malicious = "'; SELECT 1 --";
  await f.repository.findWeeklyActivity(malicious, {
    ...query,
    fromWeekStart: malicious,
    toWeekStart: malicious,
    timezone: malicious,
  });
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [malicious, malicious, malicious, malicious]);
  assert.equal(sql.text.includes(malicious), false);
  f.read.mock.mockImplementation(async () => []);
  assert.deepEqual(
    await f.repository.findWeeklyActivity(randomUUID(), {
      ...query,
      totalWeeks: 104,
    }),
    [],
  );
  assert.equal(f.read.mock.calls.length, 2);
});
void test('consistency SQL errors are sanitized and never reported as zero activity', async (context) => {
  const f = await setup(context);
  f.read.mock.mockImplementation(async () => {
    throw new Error('Private SQL connection details');
  });
  await assert.rejects(
    f.repository.findWeeklyActivity(randomUUID(), query),
    (error: unknown) =>
      error instanceof TrainingConsistencyPersistenceError &&
      !error.message.includes('Private') &&
      error.cause === undefined,
  );
});
