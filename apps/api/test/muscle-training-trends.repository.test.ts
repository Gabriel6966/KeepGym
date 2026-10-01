import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';

const range = {
  from: new Date('2026-09-01T00:00:00Z'),
  to: new Date('2026-09-30T00:00:00Z'),
  timezone: 'Europe/Madrid',
};
async function setup(context: TestContext) {
  const rows = [
    {
      weekStart: '2026-09-14',
      muscleGroup: 'CHEST',
      completedWorkouts: '1',
      completedSets: '3',
      totalReps: '26',
      totalVolumeKg: '1880.00',
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
void test('muscle weekly query scopes completed owner and inclusive startedAt using offset-safe parameters', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  assert.deepEqual(
    await f.repository.findMuscleGroupWeeklyTrends(owner, range),
    f.rows,
  );
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [
    range.timezone,
    owner,
    range.from.toISOString(),
    range.to.toISOString(),
  ]);
  assert.match(sql.text, /w.user_id = \$2::uuid AND w.status = 'COMPLETED'/);
  assert.match(sql.text, /w.started_at >= \$3::timestamptz/);
  assert.match(sql.text, /w.started_at <= \$4::timestamptz/);
  assert.doesNotMatch(
    sql.text,
    /ended_at|completed_at|created_at|CANCELLED|IN_PROGRESS/,
  );
});
void test('muscle SQL groups local Monday and historical primary only with deterministic text ordering', async (context) => {
  const f = await setup(context);
  await f.repository.findMuscleGroupWeeklyTrends(randomUUID(), range);
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(sql, /date_trunc\('week', w.started_at AT TIME ZONE \$1\)/);
  assert.match(sql, /e.primary_muscle::text COLLATE "C" AS "muscleGroup"/);
  assert.match(sql, /GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC/);
  assert.doesNotMatch(
    sql,
    /secondary_muscles|unnest|generate_series|(?:FROM|JOIN)\s+(?:exercises|workout_templates|profiles|users)\b/i,
  );
});
void test('muscle SQL requires actual sets, counts distinct same-muscle workouts and exact volume including bodyweight', async (context) => {
  const f = await setup(context);
  await f.repository.findMuscleGroupWeeklyTrends(randomUUID(), range);
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /JOIN workout_session_exercises e ON e.workout_session_id = w.id/,
  );
  assert.match(
    sql,
    /JOIN set_entries s ON s.workout_session_exercise_id = e.id/,
  );
  assert.match(sql, /COUNT\(DISTINCT w.id\)::text/);
  assert.match(sql, /COUNT\(s.id\)::text/);
  assert.match(sql, /SUM\(s.reps\)::text/);
  assert.match(sql, /SUM\(s.load_kg \* s.reps\)::text/);
  assert.doesNotMatch(
    sql,
    /LEFT JOIN|load_kg >|source_exercise_id|float|double precision|MAX\(|AVG\(/i,
  );
});
void test('muscle query count stays one with bounded or empty data and input cannot become SQL syntax', async (context) => {
  const f = await setup(context);
  const malicious = "' OR TRUE --";
  for (const from of [range.from, new Date('2024-10-01T00:00:00Z')])
    await f.repository.findMuscleGroupWeeklyTrends(malicious, {
      ...range,
      from,
      timezone: malicious,
    });
  assert.equal(f.sql.mock.calls.length, 2);
  for (const call of f.sql.mock.calls) {
    assert.equal(call.arguments[0].text.includes(malicious), false);
    assert.deepEqual(call.arguments[0].values.slice(0, 2), [
      malicious,
      malicious,
    ]);
  }
  f.sql.mock.mockImplementation(async () => []);
  assert.deepEqual(
    await f.repository.findMuscleGroupWeeklyTrends(randomUUID(), range),
    [],
  );
});
void test('muscle SQL errors become sanitized persistence errors, never false empty success', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => {
    throw new Error('Private SQL details');
  });
  await assert.rejects(
    f.repository.findMuscleGroupWeeklyTrends(randomUUID(), range),
    (error: unknown) =>
      error instanceof TrainingTrendsPersistenceError &&
      !error.message.includes('Private') &&
      error.cause === undefined,
  );
});
