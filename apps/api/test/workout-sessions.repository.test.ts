import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  snapshotSourceSelect,
  WorkoutSessionsRepository,
} from '../src/workout-sessions/workout-sessions.repository';
import { sessionInclude } from '../src/workout-sessions/workout-sessions.types';
import { InvalidWorkoutSessionStateError } from '../src/workout-sessions/errors/invalid-workout-session-state.error';
import { WorkoutSessionPersistenceError } from '../src/workout-sessions/errors/workout-session-persistence.error';
import { WorkoutSessionBusyError } from '../src/workout-sessions/errors/workout-session-busy.error';
import {
  sourceTemplate,
  WorkoutSessionsPrismaFake,
} from './support/workout-sessions-prisma.fake';

async function setup(context: TestContext) {
  const db = new WorkoutSessionsPrismaFake();
  const user = randomUUID();
  const source = sourceTemplate(user);
  db.templates.set(source.id, source);
  const module = await Test.createTestingModule({
    providers: [
      WorkoutSessionsRepository,
      { provide: PrismaService, useValue: db },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    db,
    user,
    source,
    repository: module.get(WorkoutSessionsRepository),
  };
}
function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Private SQL details', {
    code,
    clientVersion: '7.10.0',
  });
}

void test('snapshot reads scoped sources inside RepeatableRead and copies all planning/catalog fields in one nested create', async (context) => {
  const { db, user, source, repository } = await setup(context);
  const transaction = context.mock.method(db, '$transaction');
  const create = context.mock.method(db.workoutSession, 'create');
  const session = await repository.createFromTemplateSnapshot(user, source.id);
  assert.deepEqual(db.sourceReads, [
    {
      where: { id: source.id, userId: user, archivedAt: null },
      select: snapshotSourceSelect,
    },
  ]);
  assert.deepEqual(transaction.mock.calls[0]?.arguments[1], {
    isolationLevel: 'RepeatableRead',
  });
  assert.equal(create.mock.calls.length, 1);
  assert.equal(session.sourceTemplateId, source.id);
  assert.equal(session.name, source.name);
  assert.equal(session.exercises.length, 3);
  for (const [i, entry] of session.exercises.entries()) {
    const original = source.exercises[i];
    assert.ok(original);
    assert.equal(entry.position, original.position);
    assert.equal(entry.sourceExerciseId, original.exerciseId);
    assert.equal(entry.exerciseName, original.exercise.name);
    assert.equal(entry.exerciseSlug, original.exercise.slug);
    assert.equal(entry.primaryMuscle, original.exercise.primaryMuscle);
    assert.deepEqual(
      entry.secondaryMuscles,
      original.exercise.secondaryMuscles,
    );
    assert.equal(entry.equipment, original.exercise.equipment);
    assert.equal(entry.movementPattern, original.exercise.movementPattern);
    assert.equal(entry.plannedSets, original.targetSets);
    assert.equal(entry.plannedRepsMin, original.targetRepsMin);
    assert.equal(entry.plannedRepsMax, original.targetRepsMax);
    assert.equal(entry.plannedRestSeconds, original.restSeconds);
    assert.equal(entry.plannedNotes, original.notes);
  }
});

void test('source changes between read and write cannot mix revisions; later rename/targets/reorder/remove/catalog edits/archive leave history unchanged', async (context) => {
  const { db, user, source, repository } = await setup(context);
  const originalSource = structuredClone(source);
  const create = db.workoutSession.create;
  const hook = context.mock.method(
    db.workoutSession,
    'create',
    async (args: Parameters<typeof create>[0]) => {
      source.name = 'Changed concurrently';
      source.exercises.reverse();
      for (const entry of source.exercises) {
        entry.targetSets = 10;
        entry.targetRepsMin = 10;
        entry.targetRepsMax = 20;
        entry.restSeconds = 180;
        entry.notes = 'Changed';
        entry.exercise.name = 'Changed catalog';
        entry.exercise.slug = 'changed-catalog';
        entry.exercise.secondaryMuscles = ['CORE'];
        entry.exercise.primaryMuscle = 'BACK';
        entry.exercise.equipment = 'OTHER';
        entry.exercise.movementPattern = 'OTHER';
      }
      source.exercises.pop();
      source.archivedAt = new Date();
      return create(args);
    },
  );
  const session = await repository.createFromTemplateSnapshot(user, source.id);
  hook.mock.restore();
  assert.equal(session.name, originalSource.name);
  assert.equal(session.exercises.length, originalSource.exercises.length);
  assert.equal(
    session.exercises[0]?.exerciseName,
    originalSource.exercises[0]?.exercise.name,
  );
  const find = context.mock.method(db.workoutSession, 'findFirst');
  assert.deepEqual(await repository.findByIdAndUser(user, session.id), session);
  assert.deepEqual(find.mock.calls[0]?.arguments, [
    { where: { id: session.id, userId: user }, include: sessionInclude },
  ]);
  db.templates.delete(source.id);
  assert.deepEqual(await repository.findByIdAndUser(user, session.id), session);
  assert.equal(db.sourceReads.length, 1);
});

void test('failed nested creation rolls back parent and every child, and serialization retries restart the whole snapshot', async (context) => {
  const { db, user, source, repository } = await setup(context);
  const create = db.workoutSession.create;
  const hook = context.mock.method(
    db.workoutSession,
    'create',
    async (args: Parameters<typeof create>[0]) => {
      await create(args);
      throw prismaError('P2004');
    },
  );
  await assert.rejects(
    repository.createFromTemplateSnapshot(user, source.id),
    WorkoutSessionPersistenceError,
  );
  assert.equal(db.sessions.size, 0);
  let attempts = 0;
  hook.mock.mockImplementation(async (args: Parameters<typeof create>[0]) => {
    attempts++;
    await create(args);
    if (attempts === 1) {
      source.name = 'Fresh retry revision';
      throw prismaError('P2034');
    }
    return [...db.sessions.values()][0]!;
  });
  const session = await repository.createFromTemplateSnapshot(user, source.id);
  assert.equal(session.name, 'Fresh retry revision');
  assert.equal(db.sessions.size, 1);
  assert.equal(attempts, 2);
  hook.mock.mockImplementation(async () => {
    throw prismaError('P2034');
  });
  const before = hook.mock.calls.length;
  await assert.rejects(
    repository.createFromTemplateSnapshot(user, source.id),
    WorkoutSessionBusyError,
  );
  assert.equal(hook.mock.calls.length - before, 3);
  assert.equal(db.sessions.size, 1);
});

void test('complete/cancel use owner+IN_PROGRESS conditional writes and concurrent requests have one winner', async (context) => {
  const { db, user, source, repository } = await setup(context);
  const session = await repository.createFromTemplateSnapshot(user, source.id);
  const update = context.mock.method(db.workoutSession, 'updateMany');
  const transaction = context.mock.method(db, '$transaction');
  const results = await Promise.allSettled([
    repository.completeIfInProgress(user, session.id),
    repository.cancelIfInProgress(user, session.id),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const loser = results.find((result) => result.status === 'rejected');
  assert.ok(loser?.status === 'rejected');
  assert.ok(loser.reason instanceof InvalidWorkoutSessionStateError);
  for (const call of update.mock.calls)
    assert.deepEqual(call.arguments[0].where, {
      id: session.id,
      userId: user,
      status: 'IN_PROGRESS',
    });
  for (const call of transaction.mock.calls)
    assert.deepEqual(call.arguments[1], { isolationLevel: 'ReadCommitted' });
  const final = await repository.findByIdAndUser(user, session.id);
  assert.ok(final?.endedAt);
  assert.deepEqual(final.exercises, session.exercises);
});

void test('history pagination scopes count/items, uses a single snapshot, stable order and no mutable joins', async (context) => {
  const { db, user, repository } = await setup(context);
  const list = context.mock.method(db.workoutSession, 'findMany');
  const count = context.mock.method(db.workoutSession, 'count');
  const result = await repository.findManyByUser(user, {
    status: 'COMPLETED',
    page: 2,
    limit: 10,
  });
  assert.deepEqual(result, { items: [], total: 0 });
  assert.deepEqual(list.mock.calls[0]?.arguments, [
    {
      where: { userId: user, status: 'COMPLETED' },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    },
  ]);
  assert.deepEqual(count.mock.calls[0]?.arguments, [
    { where: { userId: user, status: 'COMPLETED' } },
  ]);
  assert.equal(db.sourceReads.length, 0);
});

void test('unexpected Prisma/SQL errors are sanitized for start/list/get/finish and never treated as missing or invalid transitions', async (context) => {
  const { db, user, source, repository } = await setup(context);
  context.mock.method(db, '$transaction', async () => {
    throw prismaError('P2003');
  });
  context.mock.method(db.workoutSession, 'findFirst', async () => {
    throw new Error('SQL/private fields');
  });
  for (const operation of [
    () => repository.createFromTemplateSnapshot(user, source.id),
    () => repository.findManyByUser(user, { page: 1, limit: 20 }),
    () => repository.findByIdAndUser(user, randomUUID()),
    () => repository.completeIfInProgress(user, randomUUID()),
    () => repository.cancelIfInProgress(user, randomUUID()),
  ])
    await assert.rejects(operation(), (error: unknown) => {
      assert.ok(error instanceof WorkoutSessionPersistenceError);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      assert.equal(error.message.includes('SQL'), false);
      return true;
    });
});
