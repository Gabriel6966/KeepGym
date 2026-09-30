import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { environmentConfig } from '../../src/config/environment.config';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import { testEnvironment } from '../support/test-environment';
import {
  exerciseTrendInput as query,
  expectedExerciseBuckets,
} from '../support/in-memory-exercise-training-trends.repository';

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

void test('Exercise weekly trends PostgreSQL HTTP: actual performance, scoped snapshots, candidates, timezones and consistent bounded queries', async (context) => {
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
    assert.equal(response.status, expected, method + ' ' + path);
    if (expected === 204) return {};
    const result = object(await response.json());
    if (path.startsWith('/training-trends')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'Prisma',
        'Decimal',
        'stack',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym017-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
      'POST',
      '/auth/register',
      undefined,
      { email, password: randomBytes(32).toString('base64url') },
      201,
    );
    return {
      id: string(object(result.user).id),
      token: string(result.accessToken),
    };
  }
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const a = await register();
    const b = await register();
    const catalog = await db.exercise.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    assert.equal(catalog.length, 2, 'Run db:seed before test:postgres.');
    const x = catalog[0]!;
    const y = catalog[1]!;
    const path = (id = x.id) => `/training-trends/exercises/${id}/weekly`;
    const weekly = (
      token = a.token,
      override: Partial<typeof query> = {},
      id = x.id,
    ) =>
      request(
        'GET',
        path(id) + '?' + new URLSearchParams({ ...query, ...override }),
        token,
      );
    assert.equal((await weekly()).exercise, null);
    assert.deepEqual((await weekly()).buckets, []);
    async function template(token: string) {
      const result = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-017 temporary snapshot' },
        201,
      );
      const id = string(result.id);
      for (const exercise of catalog)
        await request(
          'POST',
          `/workout-templates/${id}/exercises`,
          token,
          {
            exerciseId: exercise.id,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 8,
          },
          201,
        );
      return id;
    }
    const templateA = await template(a.token);
    const templateB = await template(b.token);
    async function session(
      owner: typeof a,
      templateId: string,
      startedAt: string,
      status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS',
      sets: { loadKg: number; reps: number }[] = [],
      otherSets: { loadKg: number; reps: number }[] = [],
    ) {
      const result = await request(
        'POST',
        '/workout-sessions',
        owner.token,
        { workoutTemplateId: templateId },
        201,
      );
      const id = string(result.id);
      sessionIds.push(id);
      await db.workoutSession.update({
        where: { id, userId: owner.id },
        data: { startedAt: new Date(startedAt) },
      });
      const entries = array(result.exercises);
      const entryX = string(
        entries.find(
          (entry) => object(entry.exercise).sourceExerciseId === x.id,
        )!.id,
      );
      const entryY = string(
        entries.find(
          (entry) => object(entry.exercise).sourceExerciseId === y.id,
        )!.id,
      );
      for (const [entry, values] of [
        [entryX, sets],
        [entryY, otherSets],
      ] as const)
        for (const set of values)
          await request(
            'POST',
            `/workout-sessions/${id}/exercises/${entry}/sets`,
            owner.token,
            set,
            201,
          );
      if (status !== 'IN_PROGRESS')
        await request(
          'POST',
          `/workout-sessions/${id}/${status === 'COMPLETED' ? 'complete' : 'cancel'}`,
          owner.token,
        );
      return { id, entryX, entryY };
    }
    const first = await session(
      a,
      templateA,
      '2026-09-14T10:00:00Z',
      'COMPLETED',
      [
        { loadKg: 80, reps: 8 },
        { loadKg: 80, reps: 8 },
      ],
      [{ loadKg: 100, reps: 5 }],
    );
    await session(a, templateA, '2026-09-18T10:00:00Z', 'COMPLETED');
    const second = await session(
      a,
      templateA,
      '2026-09-21T10:00:00Z',
      'COMPLETED',
      [{ loadKg: 82.25, reps: 7 }],
    );
    await session(a, templateA, '2026-09-22T10:00:00Z', 'CANCELLED', [
      { loadKg: 200, reps: 3 },
    ]);
    await session(a, templateA, '2026-09-23T10:00:00Z', 'IN_PROGRESS', [
      { loadKg: 250, reps: 1 },
    ]);
    await session(b, templateB, '2026-09-21T10:00:00Z', 'COMPLETED', [
      { loadKg: 300, reps: 1 },
    ]);
    // Historical fixture names distinguish latest performance from latest empty occurrence.
    await db.workoutSessionExercise.update({
      where: { id: second.entryX },
      data: { exerciseName: 'GYM-017 latest performed snapshot' },
    });
    const unused = await session(
      a,
      templateA,
      '2026-09-29T10:00:00Z',
      'COMPLETED',
    );
    await db.workoutSessionExercise.update({
      where: { id: unused.entryX },
      data: { exerciseName: 'GYM-017 unused newer snapshot' },
    });

    await context.test(
      'exact exercise weeks exclude zero sets, other exercises, CANCELLED, IN_PROGRESS and foreign owners; global behavior stays unchanged',
      async () => {
        const result = await weekly();
        assert.deepEqual(result.buckets, expectedExerciseBuckets);
        assert.deepEqual(object(result.exercise), {
          sourceExerciseId: x.id,
          name: 'GYM-017 latest performed snapshot',
          slug: x.slug,
          primaryMuscle: x.primaryMuscle,
          secondaryMuscles: x.secondaryMuscles,
          equipment: x.equipment,
          movementPattern: x.movementPattern,
        });
        assert.equal(
          object(result.exercise).name,
          'GYM-017 latest performed snapshot',
        );
        assert.equal(array((await weekly(b.token)).buckets)[0]?.maxLoadKg, 300);
        assert.deepEqual(
          array((await weekly(a.token, {}, y.id)).buckets).map(
            (row) => row.totalVolumeKg,
          ),
          [500],
        );
        const global = await request(
          'GET',
          '/training-trends/weekly?' + new URLSearchParams(query),
          a.token,
        );
        assert.deepEqual(array(global.buckets)[0], {
          weekStart: '2026-09-14',
          completedWorkouts: 2,
          completedSets: 3,
          totalReps: 21,
          totalVolumeKg: 1780,
        });
        const persisted = await db.setEntry.findFirstOrThrow({
          where: { workoutSessionExerciseId: second.entryX },
        });
        assert.equal(persisted.loadKg.toString(), '82.25');
      },
    );
    await context.test(
      'range is inclusive on startedAt for metadata, aggregates and candidates, with no catalog fill for empty performance',
      async () => {
        const bounded = await weekly(a.token, {
          from: '2026-09-14T12:00:00+02:00',
          to: '2026-09-14T10:00:00Z',
        });
        assert.deepEqual(bounded.buckets, expectedExerciseBuckets.slice(0, 1));
        assert.equal(object(bounded.exercise).name, x.name);
        for (const day of ['18', '22', '23', '29']) {
          const result = await weekly(a.token, {
            from: `2026-09-${day}T10:00:00Z`,
            to: `2026-09-${day}T10:00:00Z`,
          });
          assert.equal(result.exercise, null);
          assert.deepEqual(result.buckets, []);
        }
        const empty = await weekly(a.token, {}, randomUUID());
        assert.equal(empty.exercise, null);
        assert.deepEqual(empty.buckets, []);
      },
    );
    await context.test(
      'exercise Monday boundary uses Madrid local week, not UTC/New York or set completion timestamps',
      async () => {
        const from = '2026-09-20T21:59:59.999Z';
        const to = '2026-09-20T22:00:00Z';
        await session(a, templateA, from, 'COMPLETED', [
          { loadKg: 1, reps: 1 },
        ]);
        await session(a, templateA, to, 'COMPLETED', [{ loadKg: 2, reps: 1 }]);
        const madrid = array((await weekly(a.token, { from, to })).buckets);
        assert.deepEqual(
          madrid.map((row) => row.weekStart),
          ['2026-09-14', '2026-09-21'],
        );
        assert.deepEqual(
          madrid.map((row) => row.totalVolumeKg),
          [1, 2],
        );
        for (const timezone of ['UTC', 'America/New_York']) {
          const buckets = array(
            (await weekly(a.token, { from, to, timezone })).buckets,
          );
          assert.deepEqual(buckets, [
            {
              weekStart: '2026-09-14',
              completedWorkouts: 2,
              completedSets: 2,
              totalReps: 2,
              totalVolumeKg: 3,
              maxLoadKg: 2,
              maxEstimated1RMKg: 2.07,
            },
          ]);
        }
        for (const [instant, weekStart] of [
          ['2026-01-04T22:30:00Z', '2025-12-29'],
          ['2026-07-05T22:30:00Z', '2026-07-06'],
        ] as const) {
          await session(a, templateA, instant, 'COMPLETED', [
            { loadKg: 1, reps: 1 },
          ]);
          assert.equal(
            array(
              (await weekly(a.token, { from: instant, to: instant })).buckets,
            )[0]?.weekStart,
            weekStart,
          );
        }
      },
    );
    await context.test(
      'bodyweight observes max load zero; high reps exclude e1RM; sparse weeks omit empty occurrences',
      async () => {
        await session(a, templateA, '2026-08-03T10:00:00Z', 'COMPLETED', [
          { loadKg: 0, reps: 10 },
        ]);
        await session(a, templateA, '2026-08-10T10:00:00Z', 'COMPLETED');
        await session(a, templateA, '2026-08-17T10:00:00Z', 'COMPLETED', [
          { loadKg: 50, reps: 25 },
        ]);
        const buckets = array(
          (
            await weekly(a.token, {
              from: '2026-08-01T00:00:00Z',
              to: '2026-08-31T00:00:00Z',
            })
          ).buckets,
        );
        assert.deepEqual(buckets, [
          {
            weekStart: '2026-08-03',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 10,
            totalVolumeKg: 0,
            maxLoadKg: 0,
            maxEstimated1RMKg: null,
          },
          {
            weekStart: '2026-08-17',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 25,
            totalVolumeKg: 1250,
            maxLoadKg: 50,
            maxEstimated1RMKg: null,
          },
        ]);
      },
    );
    await context.test(
      'candidate rows are bounded per week/reps and COUNT DISTINCT survives multiple occurrences in one workout',
      async () => {
        const fixture = await session(
          a,
          templateA,
          '2026-06-01T10:00:00Z',
          'COMPLETED',
          Array.from({ length: 20 }, (_, i) => ({
            loadKg: 80 + i / 4,
            reps: 8,
          })),
        );
        // Deliberate exceptional historical fixture: source identity can occur twice in one session.
        await db.workoutSessionExercise.update({
          where: { id: fixture.entryY },
          data: { sourceExerciseId: x.id },
        });
        await db.setEntry.create({
          data: {
            workoutSessionExerciseId: fixture.entryY,
            position: 1,
            loadKg: '90',
            reps: 1,
          },
        });
        const range = {
          from: new Date('2026-06-01T00:00:00Z'),
          to: new Date('2026-06-02T00:00:00Z'),
          timezone: query.timezone,
        };
        const data = await app
          .get(TrainingTrendsRepository)
          .findExerciseWeeklyTrends(a.id, x.id, range);
        assert.equal(data.buckets[0]?.completedWorkouts, '1');
        assert.equal(data.buckets[0]?.completedSets, '21');
        assert.equal(data.estimatedCandidates.length, 2);
        assert.equal(
          data.estimatedCandidates.find((row) => row.reps === 8)?.loadKg,
          '84.75',
        );
        assert.equal(
          data.estimatedCandidates.find((row) => row.reps === 1)?.loadKg,
          '90.00',
        );
        const result = await weekly(a.token, {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        });
        assert.equal(array(result.buckets)[0]?.maxLoadKg, 90);
        assert.equal(array(result.buckets)[0]?.maxEstimated1RMKg, 107.35);
      },
    );
    await context.test(
      'three real SELECTs stay fixed and snapshot-only; plans reuse existing indexes without persistent writes',
      async () => {
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        traced.$on('query', (event) => statements.push(event.query));
        const captured: Prisma.Sql[] = [];
        const queryModule = await Test.createTestingModule({
          providers: [
            TrainingTrendsRepository,
            {
              provide: PrismaService,
              useValue: {
                $transaction: (
                  callback: (tx: {
                    $queryRaw: (sql: Prisma.Sql) => Promise<unknown>;
                  }) => Promise<unknown>,
                  options: { isolationLevel: Prisma.TransactionIsolationLevel },
                ) =>
                  traced.$transaction(
                    (tx) =>
                      callback({
                        $queryRaw: (sql) => {
                          captured.push(sql);
                          return tx.$queryRaw(sql);
                        },
                      }),
                    options,
                  ),
              },
            },
          ],
        }).compile();
        try {
          for (const userId of [a.id, randomUUID()]) {
            for (const from of [
              new Date(query.from),
              new Date('2025-01-01T00:00:00Z'),
            ]) {
              statements.length = 0;
              captured.length = 0;
              const data = await queryModule
                .get(TrainingTrendsRepository)
                .findExerciseWeeklyTrends(userId, x.id, {
                  from,
                  to: new Date(query.to),
                  timezone: query.timezone,
                });
              assert.equal(
                statements.filter((sql) => /^\s*SELECT\b/i.test(sql)).length,
                3,
              );
              assert.equal(
                data.estimatedCandidates.length <= data.buckets.length * 20,
                true,
              );
              for (const sql of statements) {
                assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s/i);
                assert.doesNotMatch(
                  sql,
                  /(?:FROM|JOIN)\s+(?:users|profiles|exercises|workout_templates)\b/i,
                );
              }
            }
          }
          // Explain a populated range, not just an empty owner.
          captured.length = 0;
          await queryModule
            .get(TrainingTrendsRepository)
            .findExerciseWeeklyTrends(a.id, x.id, {
              from: new Date(query.from),
              to: new Date(query.to),
              timezone: query.timezone,
            });
          const plan = await traced.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured[0]!}`,
          );
          const root = array(plan[0]!['QUERY PLAN'])[0]!;
          const planText = JSON.stringify(root.Plan);
          assert.match(planText, /Aggregate/);
          const indexes = [...planText.matchAll(/"Index Name":"([^"]+)"/g)].map(
            (match) => match[1],
          );
          context.diagnostic(
            `Exercise weekly SELECTs: 3, at most 20 candidates/week. EXPLAIN ${String(root['Execution Time'])} ms; indexes: ${[...new Set(indexes)].join(', ') || 'small-table scans'}.`,
          );
          const existing = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx', 'workout_session_exercises_source_idx', 'set_entries_exercise_position_key')`;
          assert.equal(existing.length, 4);
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'repeatable read keeps aggregates, candidates and metadata consistent across a concurrent source correction',
      async () => {
        const range = {
          from: new Date('2026-09-21T10:00:00Z'),
          to: new Date('2026-09-21T10:00:00Z'),
          timezone: query.timezone,
        };
        const expected = await app
          .get(TrainingTrendsRepository)
          .findExerciseWeeklyTrends(a.id, x.id, range);
        const scoped = await Test.createTestingModule({
          providers: [
            TrainingTrendsRepository,
            {
              provide: PrismaService,
              useValue: {
                $transaction: (
                  callback: (tx: {
                    $queryRaw: (sql: Prisma.Sql) => Promise<unknown>;
                  }) => Promise<unknown>,
                  options: { isolationLevel: Prisma.TransactionIsolationLevel },
                ) =>
                  db.$transaction(async (tx) => {
                    // Neither connection timezone nor concurrent source edits may affect the response.
                    await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
                    let count = 0;
                    return callback({
                      $queryRaw: async (sql) => {
                        const result = await tx.$queryRaw(sql);
                        if (++count === 1)
                          await db.workoutSessionExercise.update({
                            where: { id: second.entryX },
                            data: { sourceExerciseId: null },
                          });
                        return result;
                      },
                    });
                  }, options),
              },
            },
          ],
        }).compile();
        try {
          assert.deepEqual(
            await scoped
              .get(TrainingTrendsRepository)
              .findExerciseWeeklyTrends(a.id, x.id, range),
            expected,
          );
          const after = await weekly(a.token, {
            from: range.from.toISOString(),
            to: range.to.toISOString(),
          });
          assert.equal(after.exercise, null);
          assert.deepEqual(after.buckets, []);
          assert.equal(
            object(
              array(
                (
                  await request(
                    'GET',
                    `/workout-sessions/${second.id}`,
                    a.token,
                  )
                ).exercises,
              )[0]!.exercise,
            ).name,
            'GYM-017 latest performed snapshot',
          );
        } finally {
          await db.workoutSessionExercise.update({
            where: { id: second.entryX },
            data: { sourceExerciseId: x.id },
          });
          await scoped.close();
        }
      },
    );
    await context.test(
      'current catalog edits/inactivity and template rename/archive cannot alter historical trends',
      async () => {
        const before = await weekly();
        try {
          await db.exercise.update({
            where: { id: x.id },
            data: {
              name: 'GYM-017 changed current catalog',
              description: 'Temporary metadata',
              primaryMuscle: 'CORE',
              isActive: false,
            },
          });
          await request('PATCH', `/workout-templates/${templateA}`, a.token, {
            name: 'GYM-017 changed mutable template',
          });
          await request(
            'DELETE',
            `/workout-templates/${templateA}`,
            a.token,
            undefined,
            204,
          );
          assert.deepEqual(await weekly(), before);
          assert.equal(
            object(
              (await weekly(a.token, { to: '2026-09-14T10:00:00Z' })).exercise,
            ).name,
            x.name,
          );
        } finally {
          await db.exercise.update({
            where: { id: x.id },
            data: {
              name: x.name,
              description: x.description,
              primaryMuscle: x.primaryMuscle,
              isActive: x.isActive,
              updatedAt: x.updatedAt,
            },
          });
        }
        assert.deepEqual(
          await db.exercise.findUniqueOrThrow({ where: { id: x.id } }),
          x,
        );
        assert.ok(first.id);
      },
    );
    await context.test(
      'real HTTP validates auth/UUID/range/unknown queries and remains read-only',
      async () => {
        await request(
          'GET',
          path() + '?' + new URLSearchParams(query),
          undefined,
          undefined,
          401,
        );
        await request(
          'GET',
          path('invalid') + '?' + new URLSearchParams(query),
          a.token,
          undefined,
          400,
        );
        for (const field of ['from', 'to', 'timezone']) {
          const params = new URLSearchParams(query);
          params.delete(field);
          await request('GET', path() + '?' + params, a.token, undefined, 400);
        }
        const invalid: Record<string, string>[] = [
          { timezone: 'Europe/Foo' },
          { from: '2026-09-01T00:00:00' },
          { from: '2026-10-01T00:00:00Z' },
          { from: '2023-01-01T00:00:00Z' },
          { userId: b.id },
          { status: 'CANCELLED' },
          { page: '1' },
        ];
        for (const override of invalid)
          await request(
            'GET',
            path() + '?' + new URLSearchParams({ ...query, ...override }),
            a.token,
            undefined,
            400,
          );
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(method, path(), a.token, undefined, 404);
      },
    );
  } finally {
    try {
      const users = await db.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
      for (const user of users)
        await db.user.delete({ where: { id: user.id, email: user.email } });
      assert.equal(
        await db.workoutSession.count({ where: { id: { in: sessionIds } } }),
        0,
      );
      assert.equal(
        await db.user.count({ where: { email: { in: emails } } }),
        0,
      );
    } finally {
      await app.close();
    }
  }
});
