import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { HistoryRepository } from '../src/history/history.repository';
import { HistoryPersistenceError } from '../src/history/errors/history-persistence.error';
import {
  exerciseHistorySelect,
  workoutHistoryDetailSelect,
  workoutHistorySummarySelect,
} from '../src/history/history.types';
import { historyFixture } from './support/in-memory-history.repository';

async function setup(context: TestContext) {
  const f = historyFixture();
  const workoutSession = {
    findMany: context.mock.fn<
      (args: Prisma.WorkoutSessionFindManyArgs) => Promise<unknown[]>
    >(async () => []),
    count: context.mock.fn<
      (args: Prisma.WorkoutSessionCountArgs) => Promise<number>
    >(async () => 0),
    findFirst: context.mock.fn<
      (
        args: Prisma.WorkoutSessionFindFirstArgs,
      ) => Promise<typeof f.completed.session | null>
    >(async () => f.completed.session),
  };
  const workoutSessionExercise = {
    findMany: context.mock.fn<
      (args: Prisma.WorkoutSessionExerciseFindManyArgs) => Promise<unknown[]>
    >(async () => []),
    count: context.mock.fn<
      (args: Prisma.WorkoutSessionExerciseCountArgs) => Promise<number>
    >(async () => 0),
  };
  const tx = { workoutSession, workoutSessionExercise };
  const transaction = context.mock.fn(
    async (
      operations:
        Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
      options: { isolationLevel: string },
    ) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return typeof operations === 'function'
        ? operations(tx)
        : Promise.all(operations);
    },
  );
  const module = await Test.createTestingModule({
    providers: [
      HistoryRepository,
      {
        provide: PrismaService,
        useValue: { ...tx, $transaction: transaction },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    ...f,
    ...tx,
    transaction,
    repository: module.get(HistoryRepository),
  };
}

void test('workout history scopes page/count to owner and terminal states, orders stably and selects only descriptive counts', async (context) => {
  const f = await setup(context);
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-10-01T00:00:00Z');
  await f.repository.findWorkoutHistory(f.owner, {
    page: 2,
    limit: 10,
    from,
    to,
    q: '50%_\\',
  });
  const where = {
    userId: f.owner,
    status: { in: ['COMPLETED', 'CANCELLED'] },
    startedAt: { gte: from, lte: to },
    name: { contains: '50\\%\\_\\\\', mode: 'insensitive' },
  };
  assert.deepEqual(f.workoutSession.findMany.mock.calls[0]?.arguments, [
    {
      where,
      select: workoutHistorySummarySelect,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    },
  ]);
  assert.deepEqual(f.workoutSession.count.mock.calls[0]?.arguments, [
    { where },
  ]);
  assert.deepEqual(workoutHistorySummarySelect.exercises, {
    select: { _count: { select: { sets: true } } },
  });
  assert.equal(f.workoutSession.findMany.mock.calls.length, 1);
  assert.equal(f.workoutSession.count.mock.calls.length, 1);
  assert.equal(f.workoutSessionExercise.findMany.mock.calls.length, 0);
});

void test('history reads remain bounded by a fixed number of calls regardless of page limit', async (context) => {
  const f = await setup(context);
  for (const limit of [1, 100]) {
    await f.repository.findWorkoutHistory(f.owner, {
      page: 1,
      limit,
      status: 'CANCELLED',
    });
    await f.repository.findExerciseHistory(f.owner, f.exerciseId, {
      page: 1,
      limit,
      status: 'COMPLETED',
    });
  }
  assert.equal(f.workoutSession.findMany.mock.calls.length, 2);
  assert.equal(f.workoutSession.count.mock.calls.length, 2);
  assert.equal(f.workoutSessionExercise.findMany.mock.calls.length, 2);
  assert.equal(f.workoutSessionExercise.count.mock.calls.length, 2);
  assert.equal(f.transaction.mock.calls.length, 4);
});

void test('detail only reads owned terminal sessions and orders snapshots and sets without mutable relations', async (context) => {
  const f = await setup(context);
  assert.equal(
    await f.repository.findWorkoutHistoryById(f.owner, f.completed.session.id),
    f.completed.session,
  );
  assert.deepEqual(f.workoutSession.findFirst.mock.calls[0]?.arguments, [
    {
      where: {
        id: f.completed.session.id,
        userId: f.owner,
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      select: workoutHistoryDetailSelect,
    },
  ]);
  assert.deepEqual(workoutHistoryDetailSelect.exercises.orderBy, {
    position: 'asc',
  });
  assert.deepEqual(workoutHistoryDetailSelect.exercises.select.sets.orderBy, {
    position: 'asc',
  });
  for (const select of [
    workoutHistoryDetailSelect,
    workoutHistorySummarySelect,
    exerciseHistorySelect,
  ]) {
    const keys = JSON.stringify(select);
    for (const forbidden of [
      '"user"',
      '"passwordHash"',
      '"sourceTemplate"',
      '"sourceExercise"',
      '"sessions"',
    ])
      assert.equal(keys.includes(forbidden), false);
  }
});

void test('exercise occurrences filter source UUID plus parent owner/state/date and have deterministic paginated ordering', async (context) => {
  const f = await setup(context);
  const from = new Date('2026-09-20T00:00:00Z');
  await f.repository.findExerciseHistory(f.owner, f.exerciseId, {
    page: 3,
    limit: 5,
    status: 'CANCELLED',
    from,
  });
  const where = {
    sourceExerciseId: f.exerciseId,
    workoutSession: {
      userId: f.owner,
      status: { in: ['CANCELLED'] },
      startedAt: { gte: from, lte: undefined },
    },
  };
  assert.deepEqual(f.workoutSessionExercise.findMany.mock.calls[0]?.arguments, [
    {
      where,
      select: exerciseHistorySelect,
      orderBy: [
        { workoutSession: { startedAt: 'desc' } },
        { workoutSession: { id: 'desc' } },
        { position: 'asc' },
      ],
      skip: 10,
      take: 5,
    },
  ]);
  assert.deepEqual(f.workoutSessionExercise.count.mock.calls[0]?.arguments, [
    { where },
  ]);
  assert.equal('isActive' in where, false);
});

void test('read errors are sanitized rather than becoming empty histories or leaking Prisma/SQL', async (context) => {
  const f = await setup(context);
  f.transaction.mock.mockImplementation(async () => {
    throw new Error('Private SQL detail');
  });
  for (const operation of [
    () => f.repository.findWorkoutHistory(f.owner, { page: 1, limit: 20 }),
    () => f.repository.findWorkoutHistoryById(f.owner, f.completed.session.id),
    () =>
      f.repository.findExerciseHistory(f.owner, f.exerciseId, {
        page: 1,
        limit: 20,
        status: 'COMPLETED',
      }),
  ])
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof HistoryPersistenceError &&
        !error.message.includes('SQL') &&
        error.cause === undefined,
    );
});
