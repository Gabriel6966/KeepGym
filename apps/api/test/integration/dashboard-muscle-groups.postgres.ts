import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { environmentConfig } from '../../src/config/environment.config';
import {
  Prisma,
  PrismaClient,
  type Exercise,
  type MuscleGroup,
} from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import { TrainingTrendsService } from '../../src/training-trends/training-trends.service';
import { testEnvironment } from '../support/test-environment';

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
}
function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}
const readStatements = (statements: readonly string[]) =>
  statements.filter((sql) => /^\s*\(*\s*(?:WITH|SELECT)\b/i.test(sql));
const selectedWeek = '2026-10-05';
const expectedSelectedGroups = [
  {
    muscleGroup: 'CHEST',
    completedWorkouts: 2,
    completedSets: 5,
    totalReps: 40,
    totalVolumeKg: 3080,
  },
  {
    muscleGroup: 'TRICEPS',
    completedWorkouts: 1,
    completedSets: 2,
    totalReps: 20,
    totalVolumeKg: 500,
  },
];

void test('Dashboard muscle snapshot PostgreSQL HTTP: primary-only selected local week, dedupe, sparse groups, DST, snapshots and ten fixed SELECTs', async (context) => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [{ emit: 'event', level: 'query' }],
  });
  const statements: string[] = [];
  db.$on('query', (event) => statements.push(event.query));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue(db)
    .compile();
  const app = module.createNestApplication({ logger: false });
  const emails: string[] = [],
    sessionIds: string[] = [];
  let base: string;
  async function request(
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: 'http://localhost:3000',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, path);
    const result = object(await response.json());
    assert.doesNotMatch(
      JSON.stringify(result),
      /"(?:userId|passwordHash|stack|Prisma|Decimal|balanced|imbalanced|undertrained|recommendations|rank|distributionPercent)"\s*:/,
    );
    return result;
  }
  async function register() {
    const email = `gym028-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
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
  type Occurrence = {
    exercise: Exercise;
    primary?: MuscleGroup;
    sets: readonly (readonly [string, number])[];
  };
  async function session(
    userId: string,
    instant: string,
    entries: readonly Occurrence[],
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    const startedAt = new Date(instant);
    const result = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-028 historical session',
        status,
        startedAt,
        endedAt:
          status === 'IN_PROGRESS'
            ? null
            : new Date(startedAt.getTime() + 3600000),
        exercises: {
          create: entries.map(({ exercise, primary, sets }, index) => ({
            position: index + 1,
            sourceExerciseId: exercise.id,
            exerciseName: exercise.name,
            exerciseSlug: exercise.slug,
            primaryMuscle: primary ?? exercise.primaryMuscle,
            secondaryMuscles: exercise.secondaryMuscles,
            equipment: exercise.equipment,
            movementPattern: exercise.movementPattern,
            plannedSets: 3,
            plannedRepsMin: 5,
            plannedRepsMax: 10,
            plannedRestSeconds: 90,
            sets: {
              create: sets.map(([loadKg, reps], i) => ({
                position: i + 1,
                loadKg,
                reps,
                completedAt: new Date(startedAt.getTime() + 60000),
              })),
            },
          })),
        },
      },
    });
    sessionIds.push(result.id);
    return result;
  }
  const dashboardPath = (
    weekStart = selectedWeek,
    timezone = 'Europe/Madrid',
  ) => '/dashboard/summary?' + new URLSearchParams({ weekStart, timezone });
  async function observed(
    path: string,
    token: string,
    expectedSelects: number,
  ) {
    statements.length = 0;
    const result = await request(path, token);
    const selects = readStatements(statements);
    assert.equal(selects.length, expectedSelects);
    const muscleReads = selects.filter((sql) =>
      sql.includes('e.primary_muscle::text COLLATE "C"'),
    );
    assert.equal(muscleReads.length, 1);
    assert.match(muscleReads[0]!, /COUNT\(DISTINCT w.id\)/);
    assert.doesNotMatch(
      muscleReads[0]!,
      /secondary_muscles|LEFT JOIN|unnest|load_kg >|float|double precision/i,
    );
    for (const sql of selects)
      assert.doesNotMatch(
        sql,
        /(?:INSERT|UPDATE|DELETE)\s|(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:users|exercises|workout_templates)"?\s/i,
      );
    return result;
  }
  async function crossCheck(
    token: string,
    weekStart: string,
    from: string,
    to: string,
    timezone = 'Europe/Madrid',
  ) {
    const direct = await observed(
      '/training-trends/muscle-groups/weekly?' +
        new URLSearchParams({ from, to, timezone }),
      token,
      1,
    );
    const result = await observed(
      dashboardPath(weekStart, timezone),
      token,
      10,
    );
    const buckets = rows(direct.buckets);
    assert.ok(buckets.every((bucket) => bucket.weekStart === weekStart));
    assert.deepEqual(result.muscleGroups, buckets[0]?.muscleGroups ?? []);
    return result;
  }
  try {
    await db.$connect();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    const bench = await db.exercise.findUniqueOrThrow({
      where: { slug: 'barbell-bench-press' },
    });
    const fly = await db.exercise.findUniqueOrThrow({
      where: { slug: 'incline-dumbbell-press' },
    });
    const triceps = await db.exercise.findUniqueOrThrow({
      where: { slug: 'cable-triceps-pushdown' },
    });
    const pullup = await db.exercise.findUniqueOrThrow({
      where: { slug: 'pull-up' },
    });
    const hamstrings = await db.exercise.findFirstOrThrow({
      where: { primaryMuscle: 'HAMSTRINGS' },
      orderBy: { slug: 'asc' },
    });
    assert.equal(bench.primaryMuscle, 'CHEST');
    assert.ok(
      bench.secondaryMuscles.includes('TRICEPS') &&
        bench.secondaryMuscles.includes('SHOULDERS'),
    );
    assert.equal(fly.primaryMuscle, 'CHEST');
    assert.equal(pullup.primaryMuscle, 'BACK');
    const a = await register(),
      b = await register();
    await context.test(
      'empty/new/future dashboard is sparse, requires auth and retains only weekStart/timezone query fields',
      async () => {
        await request(dashboardPath(), undefined, undefined, 401);
        const empty = await observed(dashboardPath(), a.token, 10);
        assert.deepEqual(empty.muscleGroups, []);
        assert.equal(object(empty.week).completedWorkouts, 0);
        assert.deepEqual(
          (await observed(dashboardPath('2099-01-05'), a.token, 10))
            .muscleGroups,
          [],
        );
        for (const field of [
          'muscleLimit',
          'includeMuscles',
          'metric',
          'userId',
        ])
          await request(
            dashboardPath() + '&' + field + '=1',
            a.token,
            undefined,
            400,
          );
        for (const path of [
          '/dashboard/muscle-groups',
          '/training-trends/muscle-groups/snapshot',
        ])
          await request(path, a.token, undefined, 404);
      },
    );
    const first = await session(a.id, '2026-10-05T00:00:00+02:00', [
      {
        exercise: bench,
        sets: [
          ['75', 8],
          ['75', 8],
          ['75', 8],
        ],
      },
    ]);
    await context.test(
      'secondary-only TRICEPS and SHOULDERS get no entries for the Bench primary CHEST',
      async () => {
        const result = await observed(dashboardPath(), a.token, 10);
        assert.deepEqual(result.muscleGroups, [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 1,
            completedSets: 3,
            totalReps: 24,
            totalVolumeKg: 1800,
          },
        ]);
      },
    );
    await db.workoutSessionExercise.create({
      data: {
        workoutSessionId: first.id,
        position: 2,
        sourceExerciseId: triceps.id,
        exerciseName: triceps.name,
        exerciseSlug: triceps.slug,
        primaryMuscle: triceps.primaryMuscle,
        secondaryMuscles: triceps.secondaryMuscles,
        equipment: triceps.equipment,
        movementPattern: triceps.movementPattern,
        plannedSets: 2,
        plannedRepsMin: 10,
        plannedRepsMax: 10,
        plannedRestSeconds: 90,
        sets: {
          create: [
            { position: 1, loadKg: '25', reps: 10 },
            { position: 2, loadKg: '25', reps: 10 },
          ],
        },
      },
    });
    await session(a.id, '2026-10-07T10:00:00+02:00', [
      {
        exercise: bench,
        sets: [
          ['80', 8],
          ['80', 8],
        ],
      },
    ]);
    await session(a.id, '2026-10-08T10:00:00+02:00', [
      { exercise: hamstrings, sets: [] },
    ]);
    await session(
      a.id,
      '2026-10-09T10:00:00+02:00',
      [{ exercise: bench, sets: [['9000', 10]] }],
      'CANCELLED',
    );
    await session(
      a.id,
      '2026-10-10T10:00:00+02:00',
      [{ exercise: pullup, sets: [['9000', 10]] }],
      'IN_PROGRESS',
    );
    await session(b.id, '2026-10-11T10:00:00+02:00', [
      { exercise: bench, sets: [['9000', 10]] },
    ]);
    await context.test(
      'selected week CHEST 2/5/40/3080 and TRICEPS 1/2/20/500 exclude zero-set/states/foreign and match direct TrainingTrends',
      async () => {
        const result = await crossCheck(
          a.token,
          selectedWeek,
          '2026-10-05T00:00:00+02:00',
          '2026-10-11T23:59:59.999+02:00',
        );
        assert.deepEqual(result.muscleGroups, expectedSelectedGroups);
        assert.equal(object(result.week).completedWorkouts, 3);
        assert.equal(object(result.week).completedSets, 7);
        assert.equal(object(result.week).totalVolumeKg, 3580);
        const foreign = await observed(dashboardPath(), b.token, 10);
        assert.deepEqual(foreign.muscleGroups, [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 10,
            totalVolumeKg: 90000,
          },
        ]);
      },
    );
    await session(a.id, '2026-09-21T10:00:00+02:00', [
      {
        exercise: bench,
        sets: [
          ['75', 8],
          ['75', 8],
          ['75', 8],
        ],
      },
      {
        exercise: fly,
        sets: [
          ['10', 10],
          ['10', 10],
          ['10', 10],
        ],
      },
    ]);
    await context.test(
      'multiple same-primary exercises in one workout count six sets but only one completedWorkout',
      async () => {
        const result = await crossCheck(
          a.token,
          '2026-09-21',
          '2026-09-21T00:00:00+02:00',
          '2026-09-27T23:59:59.999+02:00',
        );
        assert.deepEqual(result.muscleGroups, [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 1,
            completedSets: 6,
            totalReps: 54,
            totalVolumeKg: 2100,
          },
        ]);
      },
    );
    await session(a.id, '2026-10-12T10:00:00+02:00', [
      {
        exercise: pullup,
        sets: [
          ['0', 8],
          ['0', 8],
        ],
      },
      { exercise: hamstrings, sets: [] },
    ]);
    await context.test(
      'week isolation selects CHEST/TRICEPS vs BACK bodyweight; future muscular block empty without losing global historical blocks',
      async () => {
        const selected = await observed(dashboardPath(), a.token, 10);
        const other = await crossCheck(
          a.token,
          '2026-10-12',
          '2026-10-12T00:00:00+02:00',
          '2026-10-18T23:59:59.999+02:00',
        );
        assert.deepEqual(selected.muscleGroups, expectedSelectedGroups);
        assert.deepEqual(other.muscleGroups, [
          {
            muscleGroup: 'BACK',
            completedWorkouts: 1,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 0,
          },
        ]);
        const future = await observed(dashboardPath('2099-01-05'), a.token, 10);
        assert.deepEqual(future.muscleGroups, []);
        for (const key of [
          'recentWorkouts',
          'personalRecords',
          'bodyProgress',
          'exerciseHighlights',
        ])
          assert.deepEqual(future[key], selected[key]);
      },
    );
    await context.test(
      'current catalog primary/name/isActive and template rename/archive do not reconstruct historical muscle attribution',
      async () => {
        const before = await request(dashboardPath(), a.token);
        const template = await db.workoutTemplate.create({
          data: { userId: a.id, name: 'GYM-028 temporary template' },
        });
        await db.workoutSession.update({
          where: { id: first.id, userId: a.id },
          data: { sourceTemplateId: template.id },
        });
        try {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              primaryMuscle: 'SHOULDERS',
              name: 'Mutable renamed catalog',
              isActive: false,
            },
          });
          await db.workoutTemplate.update({
            where: { id: template.id, userId: a.id },
            data: {
              name: 'Changed planning',
              archivedAt: new Date('2026-10-12T00:00:00Z'),
            },
          });
          assert.deepEqual(await request(dashboardPath(), a.token), before);
          await db.workoutTemplate.delete({
            where: { id: template.id, userId: a.id },
          });
          assert.deepEqual(await request(dashboardPath(), a.token), before);
        } finally {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              primaryMuscle: bench.primaryMuscle,
              name: bench.name,
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
      'explicit local Monday boundaries are half-open and Madrid/UTC/New York can select different weeks for the same instant',
      async () => {
        for (const [instant, load] of [
          ['2026-08-23T21:59:59.999Z', '3'],
          ['2026-08-23T22:00:00Z', '10'],
          ['2026-08-30T21:59:59.999Z', '20'],
          ['2026-08-30T22:00:00Z', '50'],
        ] as const)
          await session(a.id, instant, [
            { exercise: bench, sets: [[load, 1]] },
          ]);
        const madrid = await crossCheck(
          a.token,
          '2026-08-24',
          '2026-08-24T00:00:00+02:00',
          '2026-08-30T23:59:59.999+02:00',
        );
        assert.deepEqual(madrid.muscleGroups, [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 2,
            completedSets: 2,
            totalReps: 2,
            totalVolumeKg: 30,
          },
        ]);
        for (const timezone of ['UTC', 'America/New_York']) {
          const other = await observed(
            dashboardPath('2026-08-24', timezone),
            a.token,
            10,
          );
          assert.equal(rows(other.muscleGroups)[0]!.totalVolumeKg, 70);
        }
      },
    );
    await context.test(
      'spring/autumn DST weeks retain calendar midnights, exclusive end and exact NUMERIC totals across 167/169 elapsed hours',
      async () => {
        for (const [weekStart, start, end, hours] of [
          ['2026-03-23', '2026-03-22T23:00:00Z', '2026-03-29T22:00:00Z', 167],
          ['2026-10-19', '2026-10-18T22:00:00Z', '2026-10-25T23:00:00Z', 169],
        ] as const) {
          const from = new Date(start),
            to = new Date(end);
          assert.equal((to.getTime() - from.getTime()) / 3600000, hours);
          for (const [time, load] of [
            [from.getTime() - 1, '1000'],
            [from.getTime(), '82.25'],
            [to.getTime() - 1, '80.5'],
            [to.getTime(), '2000'],
          ] as const)
            await session(a.id, new Date(time).toISOString(), [
              { exercise: bench, sets: [[load, 7]] },
            ]);
          const result = await crossCheck(
            a.token,
            weekStart,
            start,
            new Date(to.getTime() - 1).toISOString(),
          );
          assert.deepEqual(result.muscleGroups, [
            {
              muscleGroup: 'CHEST',
              completedWorkouts: 2,
              completedSets: 2,
              totalReps: 14,
              totalVolumeKg: 1139.25,
            },
          ]);
        }
      },
    );
    await context.test(
      'one reused aggregation is independent of connection timezone; existing indexes and eight migrations remain sufficient',
      async () => {
        const input = { weekStart: selectedWeek, timezone: 'Europe/Madrid' };
        const normal = await app
          .get(TrainingTrendsService)
          .getMuscleGroupWeek(a.id, input);
        let captured: Prisma.Sql | undefined;
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
          const scoped = await Test.createTestingModule({
            providers: [
              TrainingTrendsService,
              TrainingTrendsRepository,
              {
                provide: PrismaService,
                useValue: {
                  $queryRaw: (sql: Prisma.Sql) => {
                    captured = sql;
                    return tx.$queryRaw(sql);
                  },
                },
              },
            ],
          }).compile();
          try {
            assert.deepEqual(
              await scoped
                .get(TrainingTrendsService)
                .getMuscleGroupWeek(a.id, input),
              normal,
            );
          } finally {
            await scoped.close();
          }
        });
        assert.ok(captured);
        const plan = await db.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
        );
        const root = rows(plan[0]!['QUERY PLAN'])[0]!;
        assert.match(JSON.stringify(root.Plan), /Aggregate/);
        const migrations = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
        assert.equal(migrations[0]!.count, 8n);
        context.diagnostic(
          `Observed real HTTP SELECTs: muscle analytics=1; Dashboard=10, empty/populated/future. Reused aggregation EXPLAIN ${String(root['Execution Time'])} ms; no new indexes or SQL in Dashboard.`,
        );
      },
    );
    assert.equal(await db.exercise.count(), catalogBefore);
  } finally {
    try {
      const users = await db.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
      for (const user of users)
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
        await db.workoutSessionExercise.count({
          where: { workoutSessionId: { in: sessionIds } },
        }),
        0,
      );
    } finally {
      await app.close();
      await db.$disconnect();
    }
  }
});
