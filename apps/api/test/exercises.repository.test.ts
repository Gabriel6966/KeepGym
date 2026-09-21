import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma, type Exercise } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExercisesRepository } from '../src/exercises/exercises.repository';
import { ExercisePersistenceError } from '../src/exercises/errors/exercise-persistence.error';
import { catalogRecords } from './support/in-memory-exercises.repository';

async function setup(context: TestContext) {
  const records = catalogRecords();
  const exercise = {
    findMany: context.mock.fn<
      (args: Prisma.ExerciseFindManyArgs) => Promise<Exercise[]>
    >(async () => records.slice(0, 10)),
    count: context.mock.fn<(args: Prisma.ExerciseCountArgs) => Promise<number>>(
      async () => records.length,
    ),
    findFirst: context.mock.fn<
      (args: Prisma.ExerciseFindFirstArgs) => Promise<Exercise | null>
    >(async () => records[0] ?? null),
  };
  const transaction = context.mock.fn(
    async (
      operations: Promise<unknown>[],
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ): Promise<unknown[]> => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return Promise.all(operations);
    },
  );
  const module = await Test.createTestingModule({
    providers: [
      ExercisesRepository,
      {
        provide: PrismaService,
        useValue: { exercise, $transaction: transaction },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    repository: module.get(ExercisesRepository),
    exercise,
    transaction,
    records,
  };
}

void test('exercise repository applies active/combined filters, deterministic ordering and bounded pagination in one snapshot', async (context) => {
  const { repository, exercise, transaction } = await setup(context);
  const result = await repository.findMany({
    page: 2,
    limit: 10,
    q: 'Bench',
    primaryMuscle: 'CHEST',
    equipment: 'BARBELL',
    movementPattern: 'HORIZONTAL_PUSH',
  });
  const where = {
    isActive: true,
    primaryMuscle: 'CHEST',
    equipment: 'BARBELL',
    movementPattern: 'HORIZONTAL_PUSH',
    OR: [
      { name: { contains: 'Bench', mode: 'insensitive' } },
      { slug: { contains: 'Bench', mode: 'insensitive' } },
    ],
  };
  assert.deepEqual(exercise.findMany.mock.calls[0]?.arguments, [
    { where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: 10, take: 10 },
  ]);
  assert.deepEqual(exercise.count.mock.calls[0]?.arguments, [{ where }]);
  assert.deepEqual(transaction.mock.calls[0]?.arguments[1], {
    isolationLevel: 'RepeatableRead',
  });
  assert.equal(result.total, 24);
  assert.equal(result.items.length, 10);
});

void test('exercise repository escapes LIKE wildcards so q is literal and never injects raw SQL', async (context) => {
  const { repository, exercise } = await setup(context);
  await repository.findMany({ page: 1, limit: 20, q: '50%_\\' });
  assert.deepEqual(exercise.findMany.mock.calls[0]?.arguments[0].where?.OR, [
    { name: { contains: '50\\%\\_\\\\', mode: 'insensitive' } },
    { slug: { contains: '50\\%\\_\\\\', mode: 'insensitive' } },
  ]);
});

void test('exercise repository detail always filters active by UUID and preserves missing results', async (context) => {
  const { repository, exercise, records } = await setup(context);
  const record = records[0];
  assert.ok(record);
  assert.equal(await repository.findById(record.id), record);
  assert.deepEqual(exercise.findFirst.mock.calls[0]?.arguments, [
    { where: { id: record.id, isActive: true } },
  ]);
  exercise.findFirst.mock.mockImplementation(async () => null);
  assert.equal(await repository.findById(record.id), null);
});

void test('exercise repository sanitizes list/count/detail errors instead of leaking Prisma or returning empty results', async (context) => {
  const { repository, exercise } = await setup(context);
  const fail = async (): Promise<never> => {
    throw new Error('Internal SQL query details');
  };
  exercise.count.mock.mockImplementation(fail);
  exercise.findFirst.mock.mockImplementation(fail);
  for (const operation of [
    repository.findMany({ page: 1, limit: 20 }),
    repository.findById('4506bce7-785c-477f-8ac1-cb1296f4d867'),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof ExercisePersistenceError);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      assert.equal(error.message.includes('SQL'), false);
      return true;
    });
  }
});
