import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { HistoryRepository } from '../src/history/history.repository';
import { HistoryPersistenceError } from '../src/history/errors/history-persistence.error';
import {
  historyFixture,
  InMemoryHistoryRepository,
} from './support/in-memory-history.repository';

async function setup(context: TestContext) {
  const fixture = historyFixture();
  const rows = await new InMemoryHistoryRepository(
    fixture.records,
  ).findRecentCompletedWorkouts(fixture.owner, 5);
  const read = context.mock.fn<(sql: Prisma.Sql) => Promise<unknown[]>>(
    async () => rows,
  );
  const module = await Test.createTestingModule({
    providers: [
      HistoryRepository,
      { provide: PrismaService, useValue: { $queryRaw: read } },
    ],
  }).compile();
  context.after(() => module.close());
  return { read, rows, repository: module.get(HistoryRepository) };
}
void test('recent SQL is one bounded snapshot read scoped to owner and COMPLETED with canonical ordering before and after grouping', async (context) => {
  const f = await setup(context),
    user = randomUUID();
  assert.deepEqual(
    await f.repository.findRecentCompletedWorkouts(user, 5),
    f.rows,
  );
  assert.equal(f.read.mock.calls.length, 1);
  const sql = f.read.mock.calls[0]!.arguments[0];
  assert.deepEqual(sql.values, [user, 5]);
  assert.match(sql.text, /w.user_id = \$1::uuid AND w.status = 'COMPLETED'/);
  assert.match(sql.text, /ORDER BY w.started_at DESC, w.id DESC\s+LIMIT \$2/);
  assert.ok(sql.text.indexOf('LIMIT') < sql.text.indexOf('LEFT JOIN'));
  assert.match(
    sql.text,
    /GROUP BY r.id, r.name, r.started_at, r.ended_at\s+ORDER BY r.started_at DESC, r.id DESC/,
  );
});
void test('recent SQL preserves zero sets, aggregates children once per workout and keeps NUMERIC/instant duration without mutable joins', async (context) => {
  const f = await setup(context);
  await f.repository.findRecentCompletedWorkouts(randomUUID(), 20);
  const sql = f.read.mock.calls[0]!.arguments[0].text;
  assert.match(
    sql,
    /LEFT JOIN workout_session_exercises e ON e.workout_session_id = r.id/,
  );
  assert.match(
    sql,
    /LEFT JOIN set_entries s ON s.workout_session_exercise_id = e.id/,
  );
  assert.match(sql, /COUNT\(s.id\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.reps\), 0\)::text/);
  assert.match(sql, /COALESCE\(SUM\(s.load_kg \* s.reps\), 0\)::text/);
  assert.match(
    sql,
    /EXTRACT\(EPOCH FROM \(r.ended_at - r.started_at\)\)::text/,
  );
  assert.doesNotMatch(
    sql,
    /SUM\(EXTRACT|INNER JOIN|JOIN exercises|workout_templates|password|float|double precision|ABS\(|NOW\(|ended_at >=|ended_at IS NOT NULL/i,
  );
});
void test('recent SQL parameterizes even hostile owner strings and fixed query count does not grow with limit', async (context) => {
  const f = await setup(context),
    hostile = "'; SELECT 1 --";
  for (const limit of [1, 5, 20]) {
    await f.repository.findRecentCompletedWorkouts(hostile, limit);
    const sql = f.read.mock.calls.at(-1)!.arguments[0];
    assert.deepEqual(sql.values, [hostile, limit]);
    assert.equal(sql.text.includes(hostile), false);
  }
  assert.equal(f.read.mock.calls.length, 3);
  f.read.mock.mockImplementationOnce(async () => []);
  assert.deepEqual(
    await f.repository.findRecentCompletedWorkouts(randomUUID(), 5),
    [],
  );
});
void test('recent repository retains corrupt duration evidence and sanitizes persistence failures', async (context) => {
  const f = await setup(context);
  f.rows[0]!.endedAt = null;
  f.rows[0]!.durationSeconds = null;
  assert.equal(
    (await f.repository.findRecentCompletedWorkouts(randomUUID(), 5))[0]!
      .durationSeconds,
    null,
  );
  f.read.mock.mockImplementationOnce(async () => {
    throw new Error('private SQL');
  });
  await assert.rejects(
    f.repository.findRecentCompletedWorkouts(randomUUID(), 5),
    (error: unknown) =>
      error instanceof HistoryPersistenceError &&
      error.cause === undefined &&
      !error.message.includes('SQL'),
  );
});
