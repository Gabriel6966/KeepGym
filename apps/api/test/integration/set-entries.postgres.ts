import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PasswordHasher } from '../../src/auth/password-hasher.service';
import { environmentConfig } from '../../src/config/environment.config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WorkoutSessionNotEditableError } from '../../src/workout-sessions/errors/workout-session-not-editable.error';
import { WorkoutSessionPersistenceError } from '../../src/workout-sessions/errors/workout-session-persistence.error';
import { WorkoutSessionsRepository } from '../../src/workout-sessions/workout-sessions.repository';
import { testEnvironment } from '../support/test-environment';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

// Explicitly opt-in: pnpm --filter @gym/api test:postgres.
// Not named *.test.ts, so normal unit/HTTP tests never require Docker.
void test('SetEntry PostgreSQL: exact decimals, row-lock races, rollback and cascades', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false });
  const db = app.get(PrismaService);
  const repository = app.get(WorkoutSessionsRepository);
  const sessionIds: string[] = [];
  const exerciseIds: string[] = [];
  const email = `gym010-${randomUUID()}@example.com`;
  let userId: string | undefined;

  async function repositoryFor(client: unknown) {
    const fixture = await Test.createTestingModule({
      providers: [
        WorkoutSessionsRepository,
        { provide: PrismaService, useValue: client },
      ],
    }).compile();
    context.after(() => fixture.close());
    return fixture.get(WorkoutSessionsRepository);
  }

  try {
    await app.init();
    const exercise = await db.exercise.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    assert.ok(exercise, 'Run db:deploy and db:seed before test:postgres.');
    const passwordHash = await app
      .get(PasswordHasher)
      .hash(randomBytes(32).toString('base64url'));
    try {
      const user = await db.user.create({ data: { email, passwordHash } });
      userId = user.id;
    } catch {
      throw new Error('Could not create the isolated PostgreSQL test user.');
    }
    const owner = userId;
    const template = await db.workoutTemplate.create({
      data: {
        userId: owner,
        name: 'GYM-010 isolated integration fixture',
        exercises: {
          create: {
            exerciseId: exercise.id,
            position: 1,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 8,
          },
        },
      },
    });
    async function start() {
      const session = await repository.createFromTemplateSnapshot(
        owner,
        template.id,
      );
      sessionIds.push(session.id);
      const entry = session.exercises[0];
      assert.ok(entry);
      exerciseIds.push(entry.id);
      return { session, entry };
    }

    await context.test(
      'concurrent adds keep exact decimals and contiguous positions',
      async () => {
        const { session, entry } = await start();
        const added = await Promise.all(
          [80, 80.5, 82.25].map((loadKg) =>
            repository.addSet(owner, session.id, entry.id, { loadKg, reps: 8 }),
          ),
        );
        assert.deepEqual(added.map((set) => set.position).sort(), [1, 2, 3]);
        const exact = added.find((set) => set.loadKg.toString() === '82.25');
        assert.ok(exact);
        const rows = await db.$queryRaw<{ load: string }[]>`
        SELECT load_kg::text AS load FROM set_entries WHERE id = ${exact.id}::uuid`;
        assert.deepEqual(rows, [{ load: '82.25' }]);
        await repository.removeSet(owner, session.id, entry.id, exact.id);
        const detail = await repository.findByIdAndUser(owner, session.id);
        assert.deepEqual(
          detail?.exercises[0]?.sets.map((set) => set.position),
          [1, 2],
        );
      },
    );

    for (const winner of ['add', 'complete'] as const) {
      await context.test(
        `competing complete/add: ${winner} wins the parent row lock first`,
        async () => {
          const { session, entry } = await start();
          const locked = gate();
          const release = gate();
          const competing = gate();
          function client(hold: boolean) {
            return db.$extends({
              query: {
                workoutSession: {
                  async updateMany({ args, query }) {
                    if (args.where?.id !== session.id) return query(args);
                    if (!hold) competing.resolve();
                    const result = await query(args);
                    if (hold) {
                      locked.resolve();
                      await release.promise;
                    }
                    return result;
                  },
                },
              },
            });
          }
          const firstRepo = await repositoryFor(client(true));
          const secondRepo = await repositoryFor(client(false));
          const add = (repo: WorkoutSessionsRepository) =>
            repo.addSet(owner, session.id, entry.id, {
              loadKg: 82.25,
              reps: 8,
            });
          const complete = (repo: WorkoutSessionsRepository) =>
            repo.completeIfInProgress(owner, session.id);
          const first = winner === 'add' ? add(firstRepo) : complete(firstRepo);
          // Attach handlers immediately, including on setup failures.
          const firstResult = Promise.allSettled([first]);
          let secondResult:
            Promise<PromiseSettledResult<unknown>[]> | undefined;
          try {
            await Promise.race([
              locked.promise,
              first.then(() => {
                throw new Error('Expected parent lock interception.');
              }),
            ]);
            const second =
              winner === 'add' ? complete(secondRepo) : add(secondRepo);
            secondResult = Promise.allSettled([second]);
            await Promise.race([
              competing.promise,
              second.then(() => {
                throw new Error('Expected competing transaction.');
              }),
            ]);
            let blocked = false;
            for (let attempt = 0; attempt < 40; attempt++) {
              const waiting = await db.$queryRaw<{ count: number }[]>`
              SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query LIKE '%workout_sessions%'`;
              if ((waiting[0]?.count ?? 0) > 0) {
                blocked = true;
                break;
              }
              await delay(25);
            }
            assert.equal(
              blocked,
              true,
              'The second PostgreSQL transaction must wait.',
            );
          } finally {
            release.resolve();
            await firstResult;
            await secondResult;
          }
          assert.equal((await firstResult)[0]?.status, 'fulfilled');
          const second = (await secondResult)?.[0];
          if (winner === 'add') assert.equal(second?.status, 'fulfilled');
          else {
            assert.equal(second?.status, 'rejected');
            assert.ok(second.reason instanceof WorkoutSessionNotEditableError);
          }
          const detail = await repository.findByIdAndUser(owner, session.id);
          assert.equal(detail?.status, 'COMPLETED');
          assert.equal(
            detail.exercises[0]?.sets.length,
            winner === 'add' ? 1 : 0,
          );
          await assert.rejects(add(repository), WorkoutSessionNotEditableError);
        },
      );
    }

    await context.test(
      'a mid-compaction failure rolls back deletion, moves and parent timestamp',
      async () => {
        const { session, entry } = await start();
        for (let i = 0; i < 4; i++)
          await repository.addSet(owner, session.id, entry.id, {
            loadKg: 80,
            reps: 8,
          });
        const before = await repository.findByIdAndUser(owner, session.id);
        const removed = before?.exercises[0]?.sets[1];
        assert.ok(removed);
        let moves = 0;
        const failing = await repositoryFor(
          db.$extends({
            query: {
              setEntry: {
                async update({ args, query }) {
                  if (args.data.position !== undefined && ++moves === 2)
                    throw new Error('Controlled compaction failure');
                  return query(args);
                },
              },
            },
          }),
        );
        await assert.rejects(
          failing.removeSet(owner, session.id, entry.id, removed.id),
          WorkoutSessionPersistenceError,
        );
        assert.equal(moves, 2);
        assert.deepEqual(
          await repository.findByIdAndUser(owner, session.id),
          before,
        );
      },
    );

    await context.test(
      'SQL invariants reject invalid data independently of DTOs',
      async () => {
        const { session, entry } = await start();
        for (const invalid of [
          { position: 0 },
          { loadKg: -1 },
          { loadKg: 10000.01 },
          { reps: 0 },
          { reps: 1001 },
          { rpe: 0 },
          { rpe: 10.5 },
          { rpe: 7.3 },
          { rir: -1 },
          { rir: 11 },
        ]) {
          await assert.rejects(
            db.setEntry.create({
              data: {
                workoutSessionExerciseId: entry.id,
                position: 1,
                loadKg: 80,
                reps: 8,
                ...invalid,
              },
            }),
          );
        }
        const set = await repository.addSet(owner, session.id, entry.id, {
          loadKg: 80,
          reps: 8,
        });
        await assert.rejects(
          db.setEntry.create({
            data: {
              workoutSessionExerciseId: entry.id,
              position: set.position,
              loadKg: 80,
              reps: 8,
            },
          }),
        );
        assert.equal(
          await db.setEntry.count({
            where: { workoutSessionExerciseId: entry.id },
          }),
          1,
        );
      },
    );

    await context.test(
      'deleting a temporary exercise or session cascades to its sets',
      async () => {
        for (const target of ['exercise', 'session']) {
          const { session, entry } = await start();
          const set = await repository.addSet(owner, session.id, entry.id, {
            loadKg: 80,
            reps: 8,
          });
          if (target === 'exercise')
            await db.workoutSessionExercise.delete({ where: { id: entry.id } });
          else
            await db.workoutSession.delete({
              where: { id: session.id, userId: owner },
            });
          assert.equal(await db.setEntry.count({ where: { id: set.id } }), 0);
        }
      },
    );
    assert.deepEqual(
      await db.exercise.findUnique({ where: { id: exercise.id } }),
      exercise,
    );
  } finally {
    try {
      if (userId) {
        await db.user.delete({ where: { id: userId, email } });
        assert.equal(
          await db.workoutSession.count({ where: { id: { in: sessionIds } } }),
          0,
        );
        assert.equal(
          await db.workoutSessionExercise.count({
            where: { id: { in: exerciseIds } },
          }),
          0,
        );
        assert.equal(
          await db.setEntry.count({
            where: { workoutSessionExerciseId: { in: exerciseIds } },
          }),
          0,
        );
      }
    } finally {
      await app.close();
    }
  }
});
