import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutSessionsRepository } from '../src/workout-sessions/workout-sessions.repository';
import { WorkoutSessionNotEditableError } from '../src/workout-sessions/errors/workout-session-not-editable.error';
import { WorkoutSessionNotFoundError } from '../src/workout-sessions/errors/workout-session-not-found.error';
import { WorkoutSessionPersistenceError } from '../src/workout-sessions/errors/workout-session-persistence.error';
import { WorkoutSessionBusyError } from '../src/workout-sessions/errors/workout-session-busy.error';
import {
  WorkoutSessionsPrismaFake,
  sourceTemplate,
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
  const repository = module.get(WorkoutSessionsRepository);
  const session = await repository.createFromTemplateSnapshot(user, source.id);
  const entry = session.exercises[0];
  assert.ok(entry);
  return { db, user, repository, session, entry };
}
function known(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    'Private persistence details',
    { code, meta, clientVersion: '7.10.0' },
  );
}

void test('set repository conditionally locks the owned active session before scoped child reads and Decimal writes', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const calls: string[] = [];
  const update = db.workoutSession.updateMany;
  const touch = context.mock.method(
    db.workoutSession,
    'updateMany',
    async (...args: Parameters<typeof update>) => {
      calls.push('lock');
      return update(...args);
    },
  );
  const find = db.workoutSessionExercise.findFirst;
  const child = context.mock.method(
    db.workoutSessionExercise,
    'findFirst',
    async (...args: Parameters<typeof find>) => {
      calls.push('child');
      return find(...args);
    },
  );
  const insert = db.setEntry.create;
  const create = context.mock.method(
    db.setEntry,
    'create',
    async (...args: Parameters<typeof insert>) => {
      calls.push('insert');
      return insert(...args);
    },
  );
  const tx = context.mock.method(db, '$transaction');
  const result = await repository.addSet(user, session.id, entry.id, {
    loadKg: 82.25,
    reps: 7,
    rpe: 8.5,
    rir: 2,
  });
  assert.deepEqual(calls, ['lock', 'child', 'insert']);
  assert.deepEqual(touch.mock.calls[0]?.arguments[0].where, {
    id: session.id,
    userId: user,
    status: 'IN_PROGRESS',
  });
  assert.deepEqual(child.mock.calls[0]?.arguments, [
    {
      where: { id: entry.id, workoutSessionId: session.id },
      select: { id: true, sets: { orderBy: { position: 'asc' } } },
    },
  ]);
  assert.deepEqual(tx.mock.calls[0]?.arguments[1], {
    isolationLevel: 'ReadCommitted',
  });
  assert.equal(
    create.mock.calls[0]?.arguments[0].data.loadKg.toString(),
    '82.25',
  );
  assert.equal(result.rpe?.toString(), '8.5');
  assert.equal(result.position, 1);
});

void test('concurrent adds append unique contiguous positions through serialized transactions', async (context) => {
  const { user, repository, session, entry } = await setup(context);
  const sets = await Promise.all(
    [80, 80.5, 82.25].map((loadKg) =>
      repository.addSet(user, session.id, entry.id, { loadKg, reps: 8 }),
    ),
  );
  assert.deepEqual(sets.map((set) => set.position).sort(), [1, 2, 3]);
  const detail = await repository.findByIdAndUser(user, session.id);
  assert.deepEqual(
    detail?.exercises[0]?.sets.map((set) => set.position),
    [1, 2, 3],
  );
});

void test('remove compaction uses ascending positive destinations and rolls back deletion plus all moves on a mid-write failure', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const sets = [];
  for (let i = 0; i < 4; i++)
    sets.push(
      await repository.addSet(user, session.id, entry.id, {
        loadKg: 80,
        reps: 8,
      }),
    );
  const before = await repository.findByIdAndUser(user, session.id);
  const original = db.setEntry.update;
  let writes = 0;
  const update = context.mock.method(
    db.setEntry,
    'update',
    async (...args: Parameters<typeof original>) => {
      writes++;
      if (writes === 2) throw new Error('Simulated compaction failure');
      return original(...args);
    },
  );
  await assert.rejects(
    repository.removeSet(user, session.id, entry.id, sets[1]!.id),
    WorkoutSessionPersistenceError,
  );
  assert.deepEqual(await repository.findByIdAndUser(user, session.id), before);
  assert.deepEqual(
    update.mock.calls.map((call) => call.arguments[0].data),
    [{ position: 2 }, { position: 3 }],
  );
  update.mock.restore();
  await repository.removeSet(user, session.id, entry.id, sets[1]!.id);
  assert.deepEqual(
    (
      await repository.findByIdAndUser(user, session.id)
    )?.exercises[0]?.sets.map((set) => set.position),
    [1, 2, 3],
  );
});

void test('creation failures roll back parent timestamp and inserted data; unrelated errors are sanitized, not retried', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const before = await repository.findByIdAndUser(user, session.id);
  const original = db.setEntry.create;
  const create = context.mock.method(
    db.setEntry,
    'create',
    async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw known('P2003');
    },
  );
  await assert.rejects(
    repository.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 }),
    WorkoutSessionPersistenceError,
  );
  assert.equal(create.mock.calls.length, 1);
  assert.deepEqual(await repository.findByIdAndUser(user, session.id), before);
  create.mock.mockImplementation(async () => {
    throw known('P2002', {
      modelName: 'OtherModel',
      target: 'set_entries_exercise_position_key',
    });
  });
  const start = create.mock.calls.length;
  await assert.rejects(
    repository.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 }),
    (error: unknown) => {
      assert.ok(error instanceof WorkoutSessionPersistenceError);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      return true;
    },
  );
  assert.equal(create.mock.calls.length - start, 1);
});

void test('serialization/specific position conflicts retry only the whole mutation with a maximum of three attempts', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const original = db.setEntry.create;
  let attempt = 0;
  const create = context.mock.method(
    db.setEntry,
    'create',
    async (...args: Parameters<typeof original>) => {
      attempt++;
      if (attempt === 1) throw known('P2034');
      if (attempt === 2)
        throw known('P2002', {
          modelName: 'SetEntry',
          driverAdapterError: {
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { index: 'set_entries_exercise_position_key' },
            },
          },
        });
      return original(...args);
    },
  );
  assert.equal(
    (
      await repository.addSet(user, session.id, entry.id, {
        loadKg: 80,
        reps: 8,
      })
    ).position,
    1,
  );
  assert.equal(attempt, 3);
  create.mock.mockImplementation(async () => {
    throw known('P2002', {
      modelName: 'SetEntry',
      target: ['workout_session_exercise_id', 'position'],
    });
  });
  const start = create.mock.calls.length;
  await assert.rejects(
    repository.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 }),
    WorkoutSessionBusyError,
  );
  assert.equal(create.mock.calls.length - start, 3);
});

void test('ownership/state failures happen inside the transaction before any set write, including after completion won', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const set = await repository.addSet(user, session.id, entry.id, {
    loadKg: 80,
    reps: 8,
  });
  await repository.completeIfInProgress(user, session.id);
  const create = context.mock.method(db.setEntry, 'create');
  const update = context.mock.method(db.setEntry, 'update');
  const remove = context.mock.method(db.setEntry, 'delete');
  await assert.rejects(
    repository.addSet(randomUUID(), session.id, entry.id, {
      loadKg: 80,
      reps: 8,
    }),
    WorkoutSessionNotFoundError,
  );
  for (const operation of [
    () =>
      repository.addSet(user, session.id, entry.id, { loadKg: 80, reps: 8 }),
    () => repository.updateSet(user, session.id, entry.id, set.id, { reps: 9 }),
    () => repository.removeSet(user, session.id, entry.id, set.id),
  ])
    await assert.rejects(operation(), WorkoutSessionNotEditableError);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(update.mock.calls.length, 0);
  assert.equal(remove.mock.calls.length, 0);
});

void test('corrections never send completedAt, position or identity as editable fields to persistence', async (context) => {
  const { db, user, repository, session, entry } = await setup(context);
  const set = await repository.addSet(user, session.id, entry.id, {
    loadKg: 80,
    reps: 8,
  });
  const update = context.mock.method(db.setEntry, 'update');
  await repository.updateSet(user, session.id, entry.id, set.id, {
    reps: 7,
    rpe: null,
    rir: 0,
  });
  const args = update.mock.calls[0]?.arguments[0];
  assert.ok(args);
  assert.deepEqual(args.where, {
    id: set.id,
    workoutSessionExerciseId: entry.id,
  });
  assert.deepEqual(Object.keys(args.data).sort(), [
    'loadKg',
    'reps',
    'rir',
    'rpe',
  ]);
  assert.deepEqual(
    (await repository.findByIdAndUser(user, session.id))?.exercises[0]?.sets[0]
      ?.completedAt,
    set.completedAt,
  );
});
