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
import { muscleTrendsInput as query } from '../support/in-memory-muscle-training-trends.repository';

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
const endpoint = '/training-trends/muscle-groups/weekly';
const expectedWeekOne = [
  {
    muscleGroup: 'BACK',
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 10,
    totalVolumeKg: 700,
  },
  {
    muscleGroup: 'CHEST',
    completedWorkouts: 1,
    completedSets: 3,
    totalReps: 26,
    totalVolumeKg: 1880,
  },
  {
    muscleGroup: 'TRICEPS',
    completedWorkouts: 1,
    completedSets: 2,
    totalReps: 22,
    totalVolumeKg: 660,
  },
];

void test('Muscle weekly PostgreSQL HTTP: primary snapshot attribution, distinct workouts, timezones, one query and isolation', async (context) => {
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
      for (const key of [
        'userId',
        'passwordHash',
        'Prisma',
        'Decimal',
        'stack',
      ])
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym018-${randomUUID()}@example.com`;
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
    const weekly = (token = a.token, override: Partial<typeof query> = {}) =>
      request(
        'GET',
        endpoint + '?' + new URLSearchParams({ ...query, ...override }),
        token,
      );
    assert.deepEqual((await weekly()).buckets, []);
    const slugs = [
      'barbell-bench-press',
      'incline-dumbbell-press',
      'barbell-row',
      'cable-triceps-pushdown',
      'back-squat',
      'push-up',
    ];
    const catalog = await db.exercise.findMany({
      where: { slug: { in: slugs }, isActive: true },
      orderBy: { slug: 'asc' },
    });
    assert.equal(
      catalog.length,
      slugs.length,
      'Run db:seed before test:postgres.',
    );
    const bench = catalog.find((exercise) => exercise.slug === slugs[0])!;
    assert.equal(bench.primaryMuscle, 'CHEST');
    assert.ok(bench.secondaryMuscles.includes('TRICEPS'));
    async function template(token: string) {
      const result = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-018 temporary plan' },
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
      instant: string,
      status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS',
      setsBySlug: Record<string, { loadKg: number; reps: number }[]> = {},
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
        data: { startedAt: new Date(instant) },
      });
      const entries = array(result.exercises);
      for (const [slug, sets] of Object.entries(setsBySlug)) {
        const entry = entries.find(
          (entry) => object(entry.exercise).slug === slug,
        );
        assert.ok(entry);
        for (const set of sets)
          await request(
            'POST',
            `/workout-sessions/${id}/exercises/${string(entry.id)}/sets`,
            owner.token,
            set,
            201,
          );
      }
      if (status !== 'IN_PROGRESS')
        await request(
          'POST',
          `/workout-sessions/${id}/${status === 'COMPLETED' ? 'complete' : 'cancel'}`,
          owner.token,
        );
      return { id, entries };
    }
    const first = await session(
      a,
      templateA,
      '2026-09-14T10:00:00Z',
      'COMPLETED',
      {
        'barbell-bench-press': [
          { loadKg: 80, reps: 8 },
          { loadKg: 80, reps: 8 },
        ],
        'incline-dumbbell-press': [{ loadKg: 60, reps: 10 }],
        'barbell-row': [{ loadKg: 70, reps: 10 }],
      },
    );
    await context.test(
      'Bench secondary TRICEPS and SHOULDERS get no bucket; same-primary exercises count one workout',
      async () => {
        assert.deepEqual((await weekly()).buckets, [
          {
            weekStart: '2026-09-14',
            muscleGroups: expectedWeekOne.slice(0, 2),
          },
        ]);
      },
    );
    await session(a, templateA, '2026-09-18T10:00:00Z', 'COMPLETED', {
      'cable-triceps-pushdown': [
        { loadKg: 30, reps: 12 },
        { loadKg: 30, reps: 10 },
      ],
    });
    await session(a, templateA, '2026-09-21T10:00:00Z', 'COMPLETED', {
      'back-squat': [
        { loadKg: 100, reps: 5 },
        { loadKg: 100, reps: 5 },
      ],
      'push-up': [{ loadKg: 0, reps: 20 }],
    });
    await session(a, templateA, '2026-09-22T10:00:00Z', 'CANCELLED', {
      'barbell-bench-press': [{ loadKg: 200, reps: 10 }],
    });
    await session(a, templateA, '2026-09-23T10:00:00Z', 'IN_PROGRESS', {
      'barbell-row': [{ loadKg: 250, reps: 10 }],
    });
    await session(b, templateB, '2026-09-14T10:00:00Z', 'COMPLETED', {
      'barbell-bench-press': [{ loadKg: 300, reps: 10 }],
    });
    await session(a, templateA, '2026-09-28T10:00:00Z', 'COMPLETED');

    await context.test(
      'expected CHEST 1880, BACK 700, TRICEPS 660 and QUADRICEPS 1000; no unfinished/foreign contribution, bodyweight counts',
      async () => {
        assert.deepEqual((await weekly()).buckets, [
          { weekStart: '2026-09-14', muscleGroups: expectedWeekOne },
          {
            weekStart: '2026-09-21',
            muscleGroups: [
              {
                muscleGroup: 'CHEST',
                completedWorkouts: 1,
                completedSets: 1,
                totalReps: 20,
                totalVolumeKg: 0,
              },
              {
                muscleGroup: 'QUADRICEPS',
                completedWorkouts: 1,
                completedSets: 2,
                totalReps: 10,
                totalVolumeKg: 1000,
              },
            ],
          },
        ]);
        assert.deepEqual((await weekly(b.token)).buckets, [
          {
            weekStart: '2026-09-14',
            muscleGroups: [
              {
                muscleGroup: 'CHEST',
                completedWorkouts: 1,
                completedSets: 1,
                totalReps: 10,
                totalVolumeKg: 3000,
              },
            ],
          },
        ]);
        const global = await request(
          'GET',
          '/training-trends/weekly?' + new URLSearchParams(query),
          a.token,
        );
        assert.deepEqual(array(global.buckets)[0], {
          weekStart: '2026-09-14',
          completedWorkouts: 2,
          completedSets: 6,
          totalReps: 58,
          totalVolumeKg: 3240,
        });
        assert.equal(array(global.buckets).at(-1)?.completedWorkouts, 1);
        const exercise = await request(
          'GET',
          `/training-trends/exercises/${bench.id}/weekly?` +
            new URLSearchParams(query),
          a.token,
        );
        assert.deepEqual(exercise.buckets, [
          {
            weekStart: '2026-09-14',
            completedWorkouts: 1,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 1280,
            maxLoadKg: 80,
            maxEstimated1RMKg: 101.33,
          },
        ]);
      },
    );
    await context.test(
      'inclusive startedAt range omits unperformed CHEST in a triceps workout and omits completely empty weeks',
      async () => {
        const bounded = await weekly(a.token, {
          from: '2026-09-18T12:00:00+02:00',
          to: '2026-09-18T10:00:00Z',
        });
        assert.deepEqual(bounded.buckets, [
          { weekStart: '2026-09-14', muscleGroups: [expectedWeekOne[2]] },
        ]);
        for (const day of ['22', '23', '28'])
          assert.deepEqual(
            (
              await weekly(a.token, {
                from: `2026-09-${day}T10:00:00Z`,
                to: `2026-09-${day}T10:00:00Z`,
              })
            ).buckets,
            [],
          );
      },
    );
    await context.test(
      'exact Decimal totals preserve 80, 80.5 and 82.25 without leaking Decimal objects',
      async () => {
        await session(a, templateA, '2026-08-03T10:00:00Z', 'COMPLETED', {
          'barbell-bench-press': [
            { loadKg: 80, reps: 8 },
            { loadKg: 80.5, reps: 8 },
            { loadKg: 82.25, reps: 7 },
          ],
        });
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
            muscleGroups: [
              {
                muscleGroup: 'CHEST',
                completedWorkouts: 1,
                completedSets: 3,
                totalReps: 23,
                totalVolumeKg: 1859.75,
              },
            ],
          },
        ]);
      },
    );
    await context.test(
      'Madrid Monday boundary and DST are explicit; UTC/New York and connection timezone cannot shift requested buckets',
      async () => {
        const from = '2026-09-20T21:59:59.999Z';
        const to = '2026-09-20T22:00:00Z';
        await session(a, templateA, from, 'COMPLETED', {
          'barbell-bench-press': [{ loadKg: 1, reps: 1 }],
        });
        await session(a, templateA, to, 'COMPLETED', {
          'barbell-bench-press': [{ loadKg: 2, reps: 1 }],
        });
        const madrid = array((await weekly(a.token, { from, to })).buckets);
        assert.deepEqual(
          madrid.map((row) => row.weekStart),
          ['2026-09-14', '2026-09-21'],
        );
        assert.deepEqual(
          madrid.map((row) => array(row.muscleGroups)[0]?.totalVolumeKg),
          [1, 2],
        );
        for (const timezone of ['UTC', 'America/New_York'])
          assert.deepEqual(
            (await weekly(a.token, { from, to, timezone })).buckets,
            [
              {
                weekStart: '2026-09-14',
                muscleGroups: [
                  {
                    muscleGroup: 'CHEST',
                    completedWorkouts: 2,
                    completedSets: 2,
                    totalReps: 2,
                    totalVolumeKg: 3,
                  },
                ],
              },
            ],
          );
        for (const [instant, weekStart] of [
          ['2026-01-04T22:30:00Z', '2025-12-29'],
          ['2026-07-05T22:30:00Z', '2026-07-06'],
        ] as const) {
          await session(a, templateA, instant, 'COMPLETED', {
            'barbell-bench-press': [{ loadKg: 1, reps: 1 }],
          });
          assert.equal(
            array(
              (await weekly(a.token, { from: instant, to: instant })).buckets,
            )[0]?.weekStart,
            weekStart,
          );
        }
        const range = {
          from: new Date(from),
          to: new Date(to),
          timezone: query.timezone,
        };
        const normal = await app
          .get(TrainingTrendsRepository)
          .findMuscleGroupWeeklyTrends(a.id, range);
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
          const scoped = await Test.createTestingModule({
            providers: [
              TrainingTrendsRepository,
              {
                provide: PrismaService,
                useValue: { $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql) },
              },
            ],
          }).compile();
          try {
            assert.deepEqual(
              await scoped
                .get(TrainingTrendsRepository)
                .findMuscleGroupWeeklyTrends(a.id, range),
              normal,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'sourceExerciseId null still attributes sets through the historical primary muscle without catalog identity',
      async () => {
        const entry = first.entries.find(
          (value) => object(value.exercise).sourceExerciseId === bench.id,
        )!;
        const before = await weekly();
        try {
          await db.workoutSessionExercise.update({
            where: { id: string(entry.id) },
            data: { sourceExerciseId: null },
          });
          assert.deepEqual(await weekly(), before);
        } finally {
          await db.workoutSessionExercise.update({
            where: { id: string(entry.id) },
            data: { sourceExerciseId: bench.id },
          });
        }
      },
    );
    await context.test(
      'real SQL stays one SELECT, read-only, primary-only and bounded; EXPLAIN uses existing relationships without new indexes',
      async () => {
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        traced.$on('query', (event) => statements.push(event.query));
        let captured: Prisma.Sql | undefined;
        const reads = await Test.createTestingModule({
          providers: [
            TrainingTrendsRepository,
            {
              provide: PrismaService,
              useValue: {
                $queryRaw: (sql: Prisma.Sql) => {
                  captured = sql;
                  return traced.$queryRaw(sql);
                },
              },
            },
          ],
        }).compile();
        try {
          for (const userId of [randomUUID(), a.id])
            for (const from of [
              new Date(query.from),
              new Date('2025-01-01T00:00:00Z'),
            ]) {
              statements.length = 0;
              await reads
                .get(TrainingTrendsRepository)
                .findMuscleGroupWeeklyTrends(userId, {
                  from,
                  to: new Date(query.to),
                  timezone: query.timezone,
                });
              assert.equal(
                statements.filter((sql) => /^\s*SELECT\b/i.test(sql)).length,
                1,
              );
              for (const sql of statements) {
                assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s/i);
                assert.doesNotMatch(
                  sql,
                  /secondary_muscles|unnest|(?:FROM|JOIN)\s+(?:exercises|workout_templates|users|profiles)\b/i,
                );
              }
            }
          assert.ok(captured);
          const plan = await traced.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
          );
          const root = array(plan[0]!['QUERY PLAN'])[0]!;
          const planText = JSON.stringify(root.Plan);
          assert.match(planText, /Aggregate/);
          const used = [...planText.matchAll(/"Index Name":"([^"]+)"/g)].map(
            (match) => match[1],
          );
          context.diagnostic(
            `Muscle weekly SELECT count: 1. EXPLAIN ${String(root['Execution Time'])} ms; indexes: ${[...new Set(used)].join(', ') || 'small-table scans'}.`,
          );
          const indexes = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx', 'workout_session_exercises_position_key', 'set_entries_exercise_position_key')`;
          assert.equal(indexes.length, 4);
        } finally {
          await reads.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'current Exercise primary/secondary changes and template rename/archive leave muscle snapshots unchanged',
      async () => {
        const before = await weekly();
        try {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              primaryMuscle: 'CORE',
              secondaryMuscles: ['BACK'],
              isActive: false,
            },
          });
          await request('PATCH', `/workout-templates/${templateA}`, a.token, {
            name: 'GYM-018 changed current plan',
          });
          await request(
            'DELETE',
            `/workout-templates/${templateA}`,
            a.token,
            undefined,
            204,
          );
          assert.deepEqual(await weekly(), before);
        } finally {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              primaryMuscle: bench.primaryMuscle,
              secondaryMuscles: bench.secondaryMuscles,
              isActive: bench.isActive,
              updatedAt: bench.updatedAt,
            },
          });
        }
        assert.deepEqual(
          await db.exercise.findUniqueOrThrow({ where: { id: bench.id } }),
          bench,
        );
      },
    );
    await context.test(
      'real muscle HTTP enforces auth, required queries, range, allowlist and no writes',
      async () => {
        await request(
          'GET',
          endpoint + '?' + new URLSearchParams(query),
          undefined,
          undefined,
          401,
        );
        for (const field of ['from', 'to', 'timezone']) {
          const params = new URLSearchParams(query);
          params.delete(field);
          await request(
            'GET',
            endpoint + '?' + params,
            a.token,
            undefined,
            400,
          );
        }
        const invalid: Record<string, string>[] = [
          { timezone: 'Europe/Foo' },
          { from: '2026-09-01T00:00:00' },
          { from: '2026-10-01T00:00:00Z' },
          { from: '2023-01-01T00:00:00Z' },
          { userId: b.id },
          { status: 'CANCELLED' },
          { muscleGroup: 'CHEST' },
          { page: '1' },
          { limit: '20' },
        ];
        for (const override of invalid)
          await request(
            'GET',
            endpoint + '?' + new URLSearchParams({ ...query, ...override }),
            a.token,
            undefined,
            400,
          );
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
          await request(method, endpoint, a.token, undefined, 404);
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
