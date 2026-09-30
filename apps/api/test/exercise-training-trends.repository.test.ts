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
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async () => [],
  );
  const tx = { $queryRaw: sql };
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
      TrainingTrendsRepository,
      { provide: PrismaService, useValue: { $transaction: transaction } },
    ],
  }).compile();
  context.after(() => module.close());
  return { sql, transaction, repository: module.get(TrainingTrendsRepository) };
}
void test('exercise trends performs three scoped reads in one repeatable snapshot with identical inclusive range', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  const exercise = randomUUID();
  assert.deepEqual(
    await f.repository.findExerciseWeeklyTrends(owner, exercise, range),
    { exercise: null, buckets: [], estimatedCandidates: [] },
  );
  assert.equal(f.transaction.mock.calls.length, 1);
  assert.equal(f.sql.mock.calls.length, 3);
  for (const [index, call] of f.sql.mock.calls.entries()) {
    const query = call.arguments[0];
    assert.deepEqual(query.values, [
      ...(index < 2 ? [range.timezone] : []),
      owner,
      exercise,
      range.from.toISOString(),
      range.to.toISOString(),
      ...(index === 1 ? [20] : []),
    ]);
    assert.match(
      query.text,
      /w.user_id = \$\d::uuid AND w.status = 'COMPLETED'/,
    );
    assert.match(query.text, /e.source_exercise_id = \$\d::uuid/);
    assert.match(query.text, /w.started_at >= \$\d::timestamptz/);
    assert.match(query.text, /w.started_at <= \$\d::timestamptz/);
    assert.doesNotMatch(
      query.text,
      /CANCELLED|IN_PROGRESS|ended_at|created_at|completed_at/,
    );
    assert.doesNotMatch(
      query.text,
      /(?:FROM|JOIN)\s+(?:users|profiles|exercises|workout_templates)\b/i,
    );
  }
});
void test('exercise aggregation requires sets, counts distinct workouts, allows zero load and uses exact NUMERIC', async (context) => {
  const f = await setup(context);
  await f.repository.findExerciseWeeklyTrends(
    randomUUID(),
    randomUUID(),
    range,
  );
  const sql = f.sql.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /JOIN set_entries s ON s.workout_session_exercise_id = e.id/,
  );
  assert.match(sql, /COUNT\(DISTINCT w.id\)::text/);
  assert.match(sql, /COUNT\(s.id\)::text/);
  assert.match(sql, /SUM\(s.reps\)::text/);
  assert.match(sql, /SUM\(s.load_kg \* s.reps\)::text/);
  assert.match(sql, /MAX\(s.load_kg\)::text/);
  assert.match(sql, /date_trunc\('week', w.started_at AT TIME ZONE \$1\)/);
  assert.match(sql, /GROUP BY 1 ORDER BY 1 ASC/);
  assert.doesNotMatch(
    sql,
    /LEFT JOIN|s.load_kg >|float|double precision|generate_series/i,
  );
});
void test('weekly candidate query is bounded by week/reps and metadata requires actual performance within range', async (context) => {
  const f = await setup(context);
  await f.repository.findExerciseWeeklyTrends(
    randomUUID(),
    randomUUID(),
    range,
  );
  const candidate = f.sql.mock.calls[1]!.arguments[0].text;
  assert.match(candidate, /MAX\(s.load_kg\)::text AS "loadKg"/);
  assert.match(candidate, /s.load_kg > 0/);
  assert.match(candidate, /s.reps BETWEEN 1 AND \$6/);
  assert.match(candidate, /GROUP BY 1, s.reps/);
  assert.doesNotMatch(candidate, /\/\s*30|completed_at|s.id|SELECT \*/);
  const metadata = f.sql.mock.calls[2]!.arguments[0].text;
  assert.match(
    metadata,
    /EXISTS \(SELECT 1 FROM set_entries s WHERE s.workout_session_exercise_id = e.id\)/,
  );
  assert.match(
    metadata,
    /ORDER BY w.started_at DESC, w.id DESC, e.position ASC, e.id ASC\s+LIMIT 1/,
  );
  assert.match(metadata, /e.exercise_name AS name, e.exercise_slug AS slug/);
  assert.match(metadata, /e.secondary_muscles::text\[\] AS "secondaryMuscles"/);
});
void test('exercise trend query count is fixed and input cannot become SQL syntax', async (context) => {
  const f = await setup(context);
  const malicious = "' OR TRUE --";
  for (const from of [range.from, new Date('2024-10-01T00:00:00Z')])
    await f.repository.findExerciseWeeklyTrends(malicious, malicious, {
      ...range,
      from,
      timezone: malicious,
    });
  assert.equal(f.sql.mock.calls.length, 6);
  for (const call of f.sql.mock.calls) {
    assert.equal(call.arguments[0].text.includes(malicious), false);
    assert.ok(call.arguments[0].values.includes(malicious));
  }
});
void test('each exercise read failure is sanitized instead of returning false empty history', async (context) => {
  for (const failure of [1, 2, 3]) {
    const f = await setup(context);
    let calls = 0;
    f.sql.mock.mockImplementation(async () => {
      if (++calls === failure) throw new Error('Private SQL details');
      return [];
    });
    await assert.rejects(
      f.repository.findExerciseWeeklyTrends(randomUUID(), randomUUID(), range),
      (error: unknown) =>
        error instanceof TrainingTrendsPersistenceError &&
        !error.message.includes('Private') &&
        error.cause === undefined,
    );
  }
});
