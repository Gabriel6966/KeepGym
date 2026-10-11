import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsPersistenceError } from '../src/records/errors/records-persistence.error';

async function setup(context: TestContext) {
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async () => [],
  );
  const transaction = context.mock.fn(
    async (
      callback: (tx: { $queryRaw: typeof sql }) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return callback({ $queryRaw: sql });
    },
  );
  const module = await Test.createTestingModule({
    providers: [
      RecordsRepository,
      { provide: PrismaService, useValue: { $transaction: transaction } },
    ],
  }).compile();
  context.after(() => module.close());
  return { sql, transaction, repository: module.get(RecordsRepository) };
}

void test('current Records uses exactly two consistent scoped SELECTs and excludes null identity, unfinished and zero loads', async (context) => {
  const f = await setup(context),
    owner = randomUUID();
  assert.deepEqual(await f.repository.findCurrentRecordCandidates(owner), {
    maxLoadCandidates: [],
    estimatedCandidates: [],
  });
  assert.equal(f.transaction.mock.calls.length, 1);
  assert.equal(f.sql.mock.calls.length, 2);
  for (const call of f.sql.mock.calls) {
    const query = call.arguments[0];
    assert.match(
      query.text,
      /w.user_id = \$1::uuid AND w.status = 'COMPLETED'/,
    );
    assert.match(
      query.text,
      /e.source_exercise_id IS NOT NULL AND s.load_kg > 0/,
    );
    assert.equal(query.values[0], owner);
    assert.equal(query.text.includes(owner), false);
    assert.doesNotMatch(
      query.text,
      /CANCELLED|IN_PROGRESS|(?:JOIN|FROM) (?:exercises|workout_templates|users)\b|is_active|LIMIT|\/\s*30/,
    );
    for (const name of [
      'sourceExerciseId',
      'exerciseName',
      'exerciseSlug',
      'completedAt',
      'setId',
    ])
      assert.ok(query.text.includes('"' + name + '"'));
  }
});

void test('SQL keeps one earliest MAX_LOAD per exercise and one highest-load earliest Epley candidate per exercise and rep count', async (context) => {
  const f = await setup(context);
  await f.repository.findCurrentRecordCandidates(randomUUID());
  const [max, estimated] = f.sql.mock.calls.map((call) => call.arguments[0]);
  assert.match(max!.text, /DISTINCT ON \(e.source_exercise_id\)/);
  assert.match(
    max!.text,
    /ORDER BY e.source_exercise_id, s.load_kg DESC,\s*s.completed_at ASC, s.id ASC/,
  );
  assert.doesNotMatch(max!.text.split('ORDER BY')[1]!, /reps/);
  assert.match(estimated!.text, /DISTINCT ON \(e.source_exercise_id, s.reps\)/);
  assert.match(estimated!.text, /s.reps BETWEEN 1 AND \$2/);
  assert.equal(estimated!.values[1], 20);
  assert.match(
    estimated!.text,
    /ORDER BY e.source_exercise_id, s.reps, s.load_kg DESC,\s*s.completed_at ASC, s.id ASC/,
  );
});

void test('parameters remain separate from SQL and query count is fixed across users', async (context) => {
  const f = await setup(context);
  for (const owner of [randomUUID(), randomUUID(), "' OR TRUE --"])
    await f.repository.findCurrentRecordCandidates(owner);
  assert.equal(f.sql.mock.calls.length, 6);
  for (const call of f.sql.mock.calls.slice(-2)) {
    assert.equal(call.arguments[0].text.includes("' OR TRUE --"), false);
    assert.equal(call.arguments[0].values[0], "' OR TRUE --");
  }
});

void test('both SELECT failures and transaction failures sanitize without empty fallbacks', async (context) => {
  const f = await setup(context);
  for (const index of [0, 1]) {
    f.sql.mock.mockImplementation(async () => []);
    f.sql.mock.mockImplementationOnce(async () => {
      throw new Error('private database');
    }, f.sql.mock.calls.length + index);
    await assert.rejects(
      f.repository.findCurrentRecordCandidates(randomUUID()),
      RecordsPersistenceError,
    );
  }
  f.transaction.mock.mockImplementation(async () => {
    throw new Error('private transaction');
  });
  await assert.rejects(
    f.repository.findCurrentRecordCandidates(randomUUID()),
    (error: unknown) =>
      error instanceof RecordsPersistenceError && error.cause === undefined,
  );
});
