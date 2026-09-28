import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsPersistenceError } from '../src/records/errors/records-persistence.error';
import { recordExerciseSelect } from '../src/records/records.types';

async function setup(context: TestContext) {
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async () => [],
  );
  const findFirst = context.mock.fn<
    (query: Prisma.WorkoutSessionExerciseFindFirstArgs) => Promise<null>
  >(async () => null);
  const tx = { $queryRaw: sql, workoutSessionExercise: { findFirst } };
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
      RecordsRepository,
      { provide: PrismaService, useValue: { $transaction: transaction } },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    sql,
    findFirst,
    transaction,
    repository: module.get(RecordsRepository),
  };
}
void test('records reads are scoped by user, COMPLETED and source UUID in one repeatable snapshot', async (context) => {
  const f = await setup(context);
  const owner = randomUUID();
  const exercise = randomUUID();
  assert.deepEqual(await f.repository.findExerciseRecordData(owner, exercise), {
    exercise: null,
    maxLoad: null,
    estimatedCandidates: [],
  });
  assert.deepEqual(f.findFirst.mock.calls[0]?.arguments, [
    {
      where: {
        sourceExerciseId: exercise,
        workoutSession: { userId: owner, status: 'COMPLETED' },
      },
      select: recordExerciseSelect,
      orderBy: [
        { workoutSession: { startedAt: 'desc' } },
        { workoutSession: { id: 'desc' } },
        { position: 'asc' },
      ],
    },
  ]);
  assert.equal(f.transaction.mock.calls.length, 1);
  assert.equal(f.sql.mock.calls.length, 2);
  for (const {
    arguments: [query],
  } of f.sql.mock.calls) {
    assert.deepEqual(query.values.slice(0, 2), [owner, exercise]);
    assert.match(
      query.text,
      /w.user_id = \$1::uuid AND w.status = 'COMPLETED'/,
    );
    assert.match(
      query.text,
      /e.source_exercise_id = \$2::uuid AND s.load_kg > 0/,
    );
    assert.equal(query.text.includes(owner), false);
    assert.equal(query.text.includes(exercise), false);
    assert.doesNotMatch(
      query.text,
      /CANCELLED|IN_PROGRESS|(?:JOIN|FROM) exercises\b/,
    );
  }
});
void test('MAX_LOAD ignores reps when tied, estimated candidates keep earliest highest load per rep count', async (context) => {
  const f = await setup(context);
  await f.repository.findExerciseRecordData(randomUUID(), randomUUID());
  const max = f.sql.mock.calls[0]!.arguments[0];
  const estimated = f.sql.mock.calls[1]!.arguments[0];
  assert.match(
    max.text,
    /ORDER BY s.load_kg DESC, s.completed_at ASC, s.id ASC LIMIT 1/,
  );
  assert.doesNotMatch(max.text.split('ORDER BY')[1]!, /reps/);
  assert.match(estimated.text, /SELECT DISTINCT ON \(s.reps\)/);
  assert.match(estimated.text, /s.reps BETWEEN 1 AND \$3/);
  assert.equal(estimated.values[2], 20);
  assert.match(
    estimated.text,
    /ORDER BY s.reps, s.load_kg DESC, s.completed_at ASC, s.id ASC/,
  );
  assert.doesNotMatch(estimated.text, /\/\s*30/);
});
void test('fixed read calls and explicit historical select never request mutable catalog, templates or private relations', async (context) => {
  const f = await setup(context);
  for (let index = 0; index < 3; index++)
    await f.repository.findExerciseRecordData(randomUUID(), randomUUID());
  assert.equal(f.sql.mock.calls.length, 6);
  assert.equal(f.findFirst.mock.calls.length, 3);
  assert.deepEqual(
    Object.keys(recordExerciseSelect).sort(),
    [
      'sourceExerciseId',
      'exerciseName',
      'exerciseSlug',
      'primaryMuscle',
      'secondaryMuscles',
      'equipment',
      'movementPattern',
    ].sort(),
  );
  const malicious = "' OR TRUE --";
  await f.repository.findExerciseRecordData(malicious, malicious);
  for (const call of f.sql.mock.calls.slice(-2)) {
    assert.equal(call.arguments[0].text.includes(malicious), false);
    assert.deepEqual(call.arguments[0].values.slice(0, 2), [
      malicious,
      malicious,
    ]);
  }
});
void test('persistence failures remain sanitized errors, not empty record responses', async (context) => {
  const f = await setup(context);
  f.sql.mock.mockImplementation(async () => {
    throw new Error('Private SQL error');
  });
  await assert.rejects(
    f.repository.findExerciseRecordData(randomUUID(), randomUUID()),
    (error: unknown) =>
      error instanceof RecordsPersistenceError &&
      !error.message.includes('SQL') &&
      error.cause === undefined,
  );
});
