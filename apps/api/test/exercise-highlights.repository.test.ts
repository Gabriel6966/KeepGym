import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { AnalyticsPersistenceError } from '../src/analytics/errors/analytics-persistence.error';
import { exerciseHighlightsFixture } from './support/exercise-highlights';

async function setup(context: TestContext) {
  const f = exerciseHighlightsFixture();
  const data = await f.repository.findExerciseHighlightPerformances(f.owner, 3);
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async (query) =>
      query.text.includes('ranked_performances')
        ? data.performances
        : data.estimatedCandidates,
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
      AnalyticsRepository,
      { provide: PrismaService, useValue: { $transaction: transaction } },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    ...f,
    data,
    sql,
    transaction,
    repository: module.get(AnalyticsRepository),
  };
}
void test('two scoped parametrized SELECTs rank actual snapshots before distinct Exercise limit and aggregate only selected latest/previous', async (context) => {
  const f = await setup(context);
  assert.deepEqual(
    await f.repository.findExerciseHighlightPerformances(f.owner, 3),
    f.data,
  );
  const [a, b] = f.sql.mock.calls.map((call) => call.arguments[0]);
  assert.ok(a && b);
  assert.deepEqual(a.values, [f.owner, 3]);
  assert.match(a.text, /PARTITION BY e.source_exercise_id/);
  assert.match(
    a.text,
    /w.started_at DESC, w.id DESC, e.position ASC, e.id ASC/,
  );
  assert.match(
    a.text,
    /AND EXISTS[\s\S]+FROM set_entries[\s\S]+selected_exercises/,
  );
  assert.match(
    a.text,
    /WHERE performance_rank = 1[\s\S]+ORDER BY started_at DESC, workout_session_id DESC, source_exercise_id ASC[\s\S]+LIMIT \$2/,
  );
  assert.match(a.text, /WHERE p.performance_rank <= 2/);
  for (const expression of [
    'COUNT(s.id)',
    'SUM(s.reps)',
    'SUM(s.load_kg * s.reps)',
    'MAX(s.load_kg)',
  ])
    assert.ok(a.text.includes(expression));
  assert.match(
    a.text,
    /ORDER BY p.source_exercise_id ASC, p.performance_rank ASC/,
  );
  assert.match(b.text, /MAX\(s.load_kg\)::text/);
  assert.match(b.text, /GROUP BY e.id, s.reps/);
  assert.match(b.text, /s.load_kg > 0 AND s.reps BETWEEN 1 AND/);
  assert.deepEqual(b.values, [
    f.owner,
    ...f.data.performances.map((row) => row.sessionExerciseId),
    20,
  ]);
  for (const query of [a, b]) {
    assert.match(query.text, /w.user_id = \$1::uuid/);
    assert.match(query.text, /w.status = 'COMPLETED'/);
    assert.match(query.text, /e.source_exercise_id IS NOT NULL/);
    assert.equal(query.text.includes(f.owner), false);
    assert.doesNotMatch(
      query.text,
      /(?:FROM|JOIN) (?:exercises|users|workout_templates)\b|\b(?:INSERT|UPDATE|DELETE)\b/,
    );
  }
  assert.equal(f.sql.mock.calls.length, 2);
  assert.equal(f.transaction.mock.calls.length, 1);
});
void test('empty selection still uses exactly two reads within RepeatableRead with FALSE, independent of bounded limit', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => []);
  for (const limit of [1, 5, 20]) {
    assert.deepEqual(
      await f.repository.findExerciseHighlightPerformances(f.owner, limit),
      { performances: [], estimatedCandidates: [] },
    );
    const b = f.sql.mock.calls.at(-1)!.arguments[0];
    assert.match(b.text, /AND FALSE/);
    assert.deepEqual(b.values, [f.owner, 20]);
  }
  assert.equal(f.sql.mock.calls.length, 6);
});
void test('identifiers and candidate IDs remain parameters, not SQL syntax; either query failure is sanitized', async (context) => {
  const f = await setup(context);
  const unsafe = "' OR TRUE --";
  f.data.performances[0]!.sessionExerciseId = unsafe;
  await f.repository.findExerciseHighlightPerformances(unsafe, 5);
  for (const call of f.sql.mock.calls) {
    assert.equal(call.arguments[0].text.includes(unsafe), false);
    assert.equal(call.arguments[0].values[0], unsafe);
  }
  assert.ok(f.sql.mock.calls[1]!.arguments[0].values.includes(unsafe));
  for (const failAt of ['first', 'second']) {
    f.sql.mock.mockImplementation(async (query) => {
      if (failAt === 'first' || !query.text.includes('ranked_performances'))
        throw new Error('Private SQL failure');
      return f.data.performances;
    });
    await assert.rejects(
      f.repository.findExerciseHighlightPerformances(randomUUID(), 5),
      (error: unknown) =>
        error instanceof AnalyticsPersistenceError &&
        !error.message.includes('SQL') &&
        error.cause === undefined,
    );
  }
});
