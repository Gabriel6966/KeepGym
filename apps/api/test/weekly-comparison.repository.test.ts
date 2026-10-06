import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';

const query = {
  weekStart: '2026-09-28',
  previousWeekStart: '2026-09-21',
  timezone: 'Europe/Madrid',
};
async function setup(context: TestContext) {
  const rows = [
    {
      weekStart: query.weekStart,
      completedWorkouts: '1',
      completedSets: '2',
      totalReps: '14',
      totalVolumeKg: '1151.50',
    },
  ];
  const sql = context.mock.fn<(sql: Prisma.Sql) => Promise<unknown[]>>(
    async () => rows,
  );
  const module = await Test.createTestingModule({
    providers: [
      TrainingTrendsRepository,
      { provide: PrismaService, useValue: { $queryRaw: sql } },
    ],
  }).compile();
  context.after(() => module.close());
  return { rows, sql, repository: module.get(TrainingTrendsRepository) };
}
void test('comparison SQL scopes COMPLETED owner and safe date/timezone parameters in one read', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  assert.deepEqual(
    await f.repository.findWeeklyComparison(user, query),
    f.rows,
  );
  assert.equal(f.sql.mock.calls.length, 1);
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [query.weekStart, query.timezone, user]);
  assert.match(sql.text, /w.user_id = \$3::uuid/);
  assert.match(sql.text, /w.status = 'COMPLETED'/);
  assert.doesNotMatch(
    sql.text,
    /CANCELLED|IN_PROGRESS|ended_at|completed_at|created_at/,
  );
});
void test('comparison SQL converts three calendar midnights independently and uses non-overlapping half-open ranges', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyComparison(randomUUID(), query);
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /\(monday - 7\)::timestamp AT TIME ZONE zone AS previous_start/,
  );
  assert.match(sql, /monday::timestamp AT TIME ZONE zone AS current_start/);
  assert.match(
    sql,
    /\(monday \+ 7\)::timestamp AT TIME ZONE zone AS current_end/,
  );
  assert.match(
    sql,
    /w.started_at >= b.previous_start AND w.started_at < b.current_end/,
  );
  assert.match(sql, /CASE WHEN w.started_at < b.current_start/);
  assert.doesNotMatch(sql, /168|23:59|interval|started_at <=|BETWEEN/i);
});
void test('comparison SQL preserves zero-set workouts, avoids duplicate workout counts and keeps NUMERIC volume', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyComparison(randomUUID(), query);
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /LEFT JOIN workout_session_exercises/);
  assert.match(sql, /LEFT JOIN set_entries/);
  assert.match(sql, /COUNT\(DISTINCT w.id\)::text/);
  assert.match(sql, /COUNT\(s.id\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.reps\), 0\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.load_kg \* s.reps\), 0\)::text/);
  assert.doesNotMatch(
    sql,
    /float|double precision|load_kg >|(?:FROM|JOIN)\s+(?:exercises|workout_templates|users|profiles)\b/i,
  );
});
void test('comparison never interpolates raw input and query count remains fixed with empty data', async (context) => {
  const f = await setup(context);
  const malicious = "'; SELECT 1 --";
  await f.repository.findWeeklyComparison(malicious, {
    ...query,
    weekStart: malicious,
    timezone: malicious,
  });
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [malicious, malicious, malicious]);
  assert.equal(sql.text.includes(malicious), false);
  f.sql.mock.mockImplementation(async () => []);
  assert.deepEqual(
    await f.repository.findWeeklyComparison(randomUUID(), query),
    [],
  );
  assert.equal(f.sql.mock.calls.length, 2);
});
void test('comparison persistence failures are sanitized, not empty success', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => {
    throw new Error('SQL private connection details');
  });
  await assert.rejects(
    f.repository.findWeeklyComparison(randomUUID(), query),
    (error: unknown) =>
      error instanceof TrainingTrendsPersistenceError &&
      !error.message.includes('private') &&
      error.cause === undefined,
  );
});
