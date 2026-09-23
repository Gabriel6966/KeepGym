import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { environmentConfig } from '../../src/config/environment.config';
import { PrismaClient } from '../../src/generated/prisma/client';
import { HistoryRepository } from '../../src/history/history.repository';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testEnvironment } from '../support/test-environment';

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}
function array(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
}

// Opt-in real HTTP/database verification, never part of Docker-free pnpm test.
void test('History PostgreSQL HTTP: ownership, snapshots, exact sets, filters and bounded read queries', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false });
  const db = app.get(PrismaService);
  const emails: string[] = [];
  const sessionIds: string[] = [];
  let base: string;

  async function request(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: 'http://localhost:3000',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, 'Unexpected HTTP status');
    if (expected === 204) {
      assert.equal(await response.text(), '');
      return {};
    }
    const result = object(await response.json());
    if (path.startsWith('/history')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'sourceTemplateId',
        'stack',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym011-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const auth = await request(
      'POST',
      '/auth/register',
      undefined,
      { email, password: randomBytes(32).toString('base64url') },
      201,
    );
    return {
      id: string(object(auth.user).id),
      token: string(auth.accessToken),
    };
  }
  async function start(templateId: string, token: string, startedAt: string) {
    const session = await request(
      'POST',
      '/workout-sessions',
      token,
      { workoutTemplateId: templateId },
      201,
    );
    const id = string(session.id);
    sessionIds.push(id);
    await db.workoutSession.update({
      where: { id },
      data: { startedAt: new Date(startedAt) },
    });
    return { id, entries: array(session.exercises) };
  }
  function setPath(
    session: { id: string; entries: Record<string, unknown>[] },
    index = 0,
  ) {
    return `/workout-sessions/${session.id}/exercises/${string(session.entries[index]?.id)}/sets`;
  }

  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const catalog = await db.exercise.findMany({ orderBy: { id: 'asc' } });
    const active = catalog.filter((entry) => entry.isActive).slice(0, 2);
    const original = active[0];
    assert.ok(
      original && active.length === 2,
      'Run db:seed before test:postgres.',
    );
    const a = await register();
    const b = await register();
    async function template(token: string) {
      const created = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-011 Push 50%_\\' },
        201,
      );
      const id = string(created.id);
      for (const exercise of active)
        await request(
          'POST',
          `/workout-templates/${id}/exercises`,
          token,
          {
            exerciseId: exercise.id,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 8,
            restSeconds: 120,
          },
          201,
        );
      return id;
    }
    const templateA = await template(a.token);
    const templateB = await template(b.token);
    const completed = await start(templateA, a.token, '2026-09-20T10:00:00Z');
    for (const loadKg of [80, 80.5, 82.25])
      await request(
        'POST',
        setPath(completed),
        a.token,
        { loadKg, reps: 8, rpe: 8.5, rir: 2 },
        201,
      );
    await request(
      'POST',
      setPath(completed, 1),
      a.token,
      { loadKg: 40, reps: 10 },
      201,
    );
    await request(
      'POST',
      `/workout-sessions/${completed.id}/complete`,
      a.token,
    );
    const cancelled = await start(templateA, a.token, '2026-09-21T10:00:00Z');
    await request(
      'POST',
      setPath(cancelled),
      a.token,
      { loadKg: 70, reps: 8 },
      201,
    );
    await request('POST', `/workout-sessions/${cancelled.id}/cancel`, a.token);
    const inProgress = await start(templateA, a.token, '2026-09-22T10:00:00Z');
    await request(
      'POST',
      setPath(inProgress),
      a.token,
      { loadKg: 90, reps: 8 },
      201,
    );
    const foreign = await start(templateB, b.token, '2026-09-23T10:00:00Z');
    await request(
      'POST',
      setPath(foreign),
      b.token,
      { loadKg: 100, reps: 8 },
      201,
    );
    await request('POST', `/workout-sessions/${foreign.id}/complete`, b.token);
    const workouts = '/history/workouts';
    const exercisePath = '/history/exercises/' + original.id;
    const history = () => request('GET', workouts, a.token);

    await context.test(
      'workout history excludes in-progress and other users, counts sets and filters terminal states',
      async () => {
        await request('GET', workouts, undefined, undefined, 401);
        const page = await history();
        assert.deepEqual(
          array(page.items).map((item) => item.id),
          [cancelled.id, completed.id],
        );
        assert.deepEqual(
          array(page.items).map((item) => [item.exerciseCount, item.setCount]),
          [
            [2, 1],
            [2, 4],
          ],
        );
        for (const [status, id] of [
          ['COMPLETED', completed.id],
          ['CANCELLED', cancelled.id],
        ]) {
          const filtered = await request(
            'GET',
            workouts + '?status=' + status,
            a.token,
          );
          assert.deepEqual(
            array(filtered.items).map((item) => item.id),
            [id],
          );
        }
        for (const id of [foreign.id, inProgress.id, randomUUID()])
          await request('GET', workouts + '/' + id, a.token, undefined, 404);
        await request(
          'GET',
          workouts + '/' + completed.id,
          b.token,
          undefined,
          404,
        );
        assert.equal(
          (await request('GET', '/workout-sessions', a.token)).total,
          3,
        );
        assert.equal(
          (await request('GET', '/workout-sessions/' + inProgress.id, a.token))
            .status,
          'IN_PROGRESS',
        );
      },
    );

    const originalDetail = await request(
      'GET',
      workouts + '/' + completed.id,
      a.token,
    );
    const originalPerformance = await request('GET', exercisePath, a.token);
    await context.test(
      'detail preserves ordered planning and actual decimal sets; cancelled sets remain visible',
      async () => {
        const entries = array(originalDetail.exercises);
        assert.deepEqual(
          entries.map((entry) => entry.position),
          [1, 2],
        );
        assert.equal(entries[0]?.plannedSets, 4);
        assert.equal(object(entries[0]?.exercise).name, original.name);
        assert.deepEqual(
          array(entries[0]?.sets).map((set) => set.loadKg),
          [80, 80.5, 82.25],
        );
        assert.deepEqual(
          array(entries[0]?.sets).map((set) => set.position),
          [1, 2, 3],
        );
        assert.equal(array(entries[0]?.sets)[2]?.rpe, 8.5);
        const abandoned = await request(
          'GET',
          workouts + '/' + cancelled.id,
          a.token,
        );
        assert.equal(abandoned.status, 'CANCELLED');
        assert.equal(array(array(abandoned.exercises)[0]?.sets).length, 1);
      },
    );

    await context.test(
      'exercise history defaults to completed and has an empty page for unknown UUIDs without catalog lookup',
      async () => {
        assert.deepEqual(
          array(originalPerformance.items).map((item) => item.sessionId),
          [completed.id],
        );
        assert.deepEqual(
          array(
            (await request('GET', exercisePath + '?status=CANCELLED', a.token))
              .items,
          ).map((item) => item.sessionId),
          [cancelled.id],
        );
        assert.deepEqual(
          array((await request('GET', exercisePath, b.token)).items).map(
            (item) => item.sessionId,
          ),
          [foreign.id],
        );
        assert.deepEqual(
          await request('GET', '/history/exercises/' + randomUUID(), a.token),
          { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
        );
      },
    );

    await context.test(
      'PostgreSQL literal search, inclusive timezone ranges, validation and pagination work over snapshots',
      async () => {
        const query = new URLSearchParams({
          q: '  push 50%_\\  ',
          from: '2026-09-20T12:00:00+02:00',
          to: '2026-09-20T10:00:00Z',
        });
        const searched = await request(
          'GET',
          workouts + '?' + query.toString(),
          a.token,
        );
        assert.deepEqual(
          array(searched.items).map((item) => item.id),
          [completed.id],
        );
        assert.equal(
          (await request('GET', workouts + '?q=50%25X', a.token)).total,
          0,
        );
        const page = await request(
          'GET',
          workouts + '?page=2&limit=1',
          a.token,
        );
        assert.deepEqual([page.total, page.totalPages], [2, 2]);
        assert.equal(array(page.items)[0]?.id, completed.id);
        for (const path of [workouts, exercisePath]) {
          await request(
            'GET',
            path + '?status=IN_PROGRESS',
            a.token,
            undefined,
            400,
          );
          await request(
            'GET',
            path + '?from=2026-09-23T00:00:00Z&to=2026-09-20T00:00:00Z',
            a.token,
            undefined,
            400,
          );
          await request(
            'GET',
            path + '?from=2026-09-20T00:00:00',
            a.token,
            undefined,
            400,
          );
          await request(
            'GET',
            path + '?userId=' + b.id,
            a.token,
            undefined,
            400,
          );
        }
      },
    );

    await context.test(
      'catalog metadata and template changes/archive cannot reconstruct or alter past responses',
      async () => {
        try {
          await db.exercise.update({
            where: { id: original.id },
            data: {
              name: 'GYM-011 temporarily changed',
              slug: 'gym011-' + randomUUID(),
              primaryMuscle: 'CORE',
              secondaryMuscles: [],
              equipment: 'OTHER',
              movementPattern: 'OTHER',
              isActive: false,
            },
          });
          await request('PATCH', '/workout-templates/' + templateA, a.token, {
            name: 'Changed planning',
          });
          const current = await request(
            'GET',
            '/workout-templates/' + templateA,
            a.token,
          );
          const templateEntries = array(current.exercises);
          await request(
            'PATCH',
            `/workout-templates/${templateA}/exercises/${string(templateEntries[0]?.id)}`,
            a.token,
            { targetSets: 1 },
          );
          await request(
            'PUT',
            `/workout-templates/${templateA}/exercises/order`,
            a.token,
            {
              templateExerciseIds: templateEntries
                .map((entry) => string(entry.id))
                .reverse(),
            },
          );
          await request(
            'DELETE',
            `/workout-templates/${templateA}/exercises/${string(templateEntries[0]?.id)}`,
            a.token,
            undefined,
            204,
          );
          await request(
            'DELETE',
            '/workout-templates/' + templateA,
            a.token,
            undefined,
            204,
          );
          assert.deepEqual(
            await request('GET', workouts + '/' + completed.id, a.token),
            originalDetail,
          );
          assert.deepEqual(
            await request('GET', exercisePath, a.token),
            originalPerformance,
          );
        } finally {
          await db.exercise.update({
            where: { id: original.id },
            data: {
              name: original.name,
              slug: original.slug,
              primaryMuscle: original.primaryMuscle,
              secondaryMuscles: original.secondaryMuscles,
              equipment: original.equipment,
              movementPattern: original.movementPattern,
              isActive: original.isActive,
              updatedAt: original.updatedAt,
            },
          });
        }
      },
    );

    const newTemplate = await template(a.token);
    const later = await start(newTemplate, a.token, '2026-09-23T12:00:00Z');
    await request(
      'POST',
      setPath(later),
      a.token,
      { loadKg: 85, reps: 8 },
      201,
    );
    await request('POST', `/workout-sessions/${later.id}/complete`, a.token);
    await context.test(
      'limit=1 selects latest completed occurrence and tied timestamps use descending UUID order',
      async () => {
        assert.equal(
          array(
            (await request('GET', exercisePath + '?limit=1', a.token)).items,
          )[0]?.sessionId,
          later.id,
        );
        assert.equal(
          array(
            (
              await request(
                'GET',
                exercisePath + '?status=CANCELLED&limit=1',
                a.token,
              )
            ).items,
          )[0]?.sessionId,
          cancelled.id,
        );
        await db.workoutSession.update({
          where: { id: later.id },
          data: { startedAt: new Date('2026-09-20T10:00:00Z') },
        });
        const expected = [completed.id, later.id].sort().reverse();
        assert.deepEqual(
          array((await request('GET', exercisePath, a.token)).items).map(
            (item) => item.sessionId,
          ),
          expected,
        );
        assert.deepEqual(
          array(
            (await request('GET', workouts + '?status=COMPLETED', a.token))
              .items,
          ).map((item) => item.id),
          expected,
        );
      },
    );

    await context.test(
      'actual SQL is batched, selects no mutable sources and uses existing indexed keys',
      async () => {
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        // SQL templates only: never capture/log parameter values or authentication data.
        traced.$on('query', (event) => {
          statements.push(event.query);
        });
        const queryModule = await Test.createTestingModule({
          providers: [
            HistoryRepository,
            { provide: PrismaService, useValue: traced },
          ],
        }).compile();
        const reads = queryModule.get(HistoryRepository);
        try {
          async function queryCount(operation: () => Promise<unknown>) {
            statements.length = 0;
            await operation();
            const selects = statements.filter((sql) =>
              /^\s*SELECT\b/i.test(sql),
            );
            assert.ok(selects.length > 0 && selects.length <= 5);
            for (const sql of statements) {
              for (const table of [
                'exercises',
                'workout_templates',
                'users',
                'sessions',
              ])
                assert.equal(sql.includes('"public"."' + table + '"'), false);
              assert.equal(/\b(INSERT|UPDATE|DELETE)\b/.test(sql), false);
            }
            return selects.length;
          }
          const small = await queryCount(() =>
            reads.findWorkoutHistory(a.id, { page: 1, limit: 1 }),
          );
          const large = await queryCount(() =>
            reads.findWorkoutHistory(a.id, { page: 1, limit: 100 }),
          );
          assert.equal(large, small);
          const one = await queryCount(() =>
            reads.findExerciseHistory(a.id, original.id, {
              page: 1,
              limit: 1,
              status: 'COMPLETED',
            }),
          );
          const many = await queryCount(() =>
            reads.findExerciseHistory(a.id, original.id, {
              page: 1,
              limit: 100,
              status: 'COMPLETED',
            }),
          );
          assert.equal(one, many);
          const detail = await queryCount(() =>
            reads.findWorkoutHistoryById(a.id, completed.id),
          );
          context.diagnostic(
            `History SQL SELECT counts: workouts=${small}, exercise occurrences=${one}, detail=${detail}; independent of page size.`,
          );
          const indexes = await db.$queryRaw<
            { name: string }[]
          >`SELECT indexname::text AS name FROM pg_indexes
          WHERE schemaname='public' AND tablename IN ('workout_sessions','workout_session_exercises','set_entries')`;
          for (const name of [
            'workout_sessions_user_started_idx',
            'workout_sessions_user_status_idx',
            'workout_session_exercises_source_idx',
            'workout_session_exercises_position_key',
            'set_entries_exercise_position_key',
          ])
            assert.ok(indexes.some((index) => index.name === name));
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
      },
    );

    await context.test(
      'null sourceExerciseId preserves the detail snapshot without slug-based identity reconstruction',
      async () => {
        const entryId = string(completed.entries[0]?.id);
        await db.workoutSessionExercise.update({
          where: { id: entryId },
          data: { sourceExerciseId: null },
        });
        const detail = await request(
          'GET',
          workouts + '/' + completed.id,
          a.token,
        );
        const source = object(array(detail.exercises)[0]?.exercise);
        assert.equal(source.sourceExerciseId, null);
        assert.equal(source.name, original.name);
        assert.deepEqual(
          array((await request('GET', exercisePath, a.token)).items).map(
            (item) => item.sessionId,
          ),
          [later.id],
        );
      },
    );
    assert.deepEqual(
      await db.exercise.findMany({ orderBy: { id: 'asc' } }),
      catalog,
    );
  } finally {
    try {
      const temporary = await db.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
      for (const user of temporary)
        await db.user.delete({ where: { id: user.id, email: user.email } });
      assert.equal(
        await db.user.count({ where: { email: { in: emails } } }),
        0,
      );
      assert.equal(
        await db.workoutSession.count({ where: { id: { in: sessionIds } } }),
        0,
      );
      assert.equal(
        await db.workoutTemplate.count({
          where: { userId: { in: temporary.map((user) => user.id) } },
        }),
        0,
      );
    } finally {
      await app.close();
    }
  }
});
