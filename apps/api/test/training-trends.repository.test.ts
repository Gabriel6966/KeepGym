import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';

async function setup(context: TestContext) {
  const rows = [
    {
      weekStart: '2026-09-14',
      completedWorkouts: '2',
      completedSets: '2',
      totalReps: '16',
      totalVolumeKg: '1280.00',
    },
  ];
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
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
const range = {
  from: new Date('2026-09-01T00:00:00Z'),
  to: new Date('2026-09-30T00:00:00Z'),
  timezone: 'Europe/Madrid',
};
void test('weekly SQL parameterizes timezone/owner/range, filters completed startedAt and buckets local ISO Mondays', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  assert.deepEqual(await f.repository.findWeeklyTrends(owner, range), f.rows);
  assert.equal(f.sql.mock.calls.length, 1);
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [range.timezone, owner, range.from, range.to]);
  assert.match(sql.text, /date_trunc\('week', w.started_at AT TIME ZONE \$1\)/);
  assert.match(sql.text, /'YYYY-MM-DD'\) AS "weekStart"/);
  assert.match(sql.text, /w.user_id = \$2::uuid AND w.status = 'COMPLETED'/);
  assert.match(sql.text, /w.started_at >= \$3::timestamptz/);
  assert.match(sql.text, /w.started_at <= \$4::timestamptz/);
  assert.match(sql.text, /GROUP BY 1 ORDER BY 1 ASC/);
  assert.doesNotMatch(
    sql.text,
    /ended_at|created_at|completed_at|CANCELLED|IN_PROGRESS|generate_series/,
  );
});
void test('weekly aggregate preserves zero-set workouts and does not multiply workout counts across exercises or sets', async (context) => {
  const f = await setup(context);
  await f.repository.findWeeklyTrends(randomUUID(), range);
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /LEFT JOIN workout_session_exercises e ON e.workout_session_id = w.id/,
  );
  assert.match(
    sql,
    /LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id/,
  );
  assert.match(sql, /COUNT\(DISTINCT w.id\)::text/);
  assert.match(sql, /COUNT\(s.id\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.reps\), 0\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.load_kg \* s.reps\), 0\)::text/);
  assert.doesNotMatch(
    sql,
    /float|double precision|profiles|workout_templates|FROM exercises|JOIN exercises/i,
  );
});
void test('weekly query count is fixed and untrusted strings are never SQL syntax', async (context) => {
  const f = await setup(context);
  const unsafe = "' OR TRUE --";
  for (const to of [range.to, new Date('2028-01-01T00:00:00Z')])
    await f.repository.findWeeklyTrends(unsafe, {
      ...range,
      to,
      timezone: unsafe,
    });
  assert.equal(f.sql.mock.calls.length, 2);
  for (const call of f.sql.mock.calls) {
    const sql = call.arguments[0];
    assert.equal(sql.text.includes(unsafe), false);
    assert.deepEqual(sql.values.slice(0, 2), [unsafe, unsafe]);
  }
});
void test('weekly empty result is legitimate but SQL failures become sanitized domain errors', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => []);
  assert.deepEqual(
    await f.repository.findWeeklyTrends(randomUUID(), range),
    [],
  );
  f.sql.mock.mockImplementation(async () => {
    throw new Error('Private SQL credentials');
  });
  await assert.rejects(
    f.repository.findWeeklyTrends(randomUUID(), range),
    (error: unknown) =>
      error instanceof TrainingTrendsPersistenceError &&
      !error.message.includes('Private') &&
      error.cause === undefined,
  );
});
