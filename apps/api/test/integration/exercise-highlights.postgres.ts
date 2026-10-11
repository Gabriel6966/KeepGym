import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { AnalyticsRepository } from '../../src/analytics/analytics.repository';
import { environmentConfig } from '../../src/config/environment.config';
import {
  Prisma,
  PrismaClient,
  type Exercise,
} from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
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
const endpoint = '/analytics/exercise-highlights';
const selects = (statements: readonly string[]) =>
  statements.filter((sql) => /^\s*\(*\s*(?:WITH|SELECT)\b/i.test(sql));

void test('Exercise highlights PostgreSQL HTTP: actual latest/previous, distinct bounded exercises, exact snapshots, RepeatableRead and two/ten SELECTs', async (context) => {
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
    expected = 200,
    body?: unknown,
    method = 'GET',
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
    const result = object(await response.json());
    assert.doesNotMatch(
      JSON.stringify(result),
      /"(?:passwordHash|stack|Prisma|userId|Decimal)"\s*:/,
    );
    return result;
  }
  async function register() {
    const email = `gym027-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
      '/auth/register',
      undefined,
      201,
      { email, password: randomBytes(32).toString('base64url') },
      'POST',
    );
    return {
      id: string(object(result.user).id),
      token: string(result.accessToken),
    };
  }
  function snapshot(
    exercise: Exercise,
    name: string,
    time: Date,
    sets: readonly (readonly [string, number])[],
    position = 1,
    canonical = true,
  ) {
    return {
      position,
      sourceExerciseId: canonical ? exercise.id : null,
      exerciseName: name,
      exerciseSlug: exercise.slug,
      primaryMuscle: exercise.primaryMuscle,
      secondaryMuscles: exercise.secondaryMuscles,
      equipment: exercise.equipment,
      movementPattern: exercise.movementPattern,
      plannedSets: 3,
      plannedRepsMin: 5,
      plannedRepsMax: 10,
      plannedRestSeconds: 90,
      sets: {
        create: sets.map(([loadKg, reps], index) => ({
          position: index + 1,
          loadKg,
          reps,
          completedAt: new Date(time.getTime() + 60000),
        })),
      },
    };
  }
  async function session(
    userId: string,
    exercise: Exercise,
    date: string,
    sets: readonly (readonly [string, number])[],
    name: string,
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
    canonical = true,
    id = randomUUID(),
  ) {
    const time = new Date(date + 'T10:00:00Z');
    const result = await db.workoutSession.create({
      data: {
        id,
        userId,
        name: 'GYM-027 workout snapshot',
        status,
        startedAt: time,
        endedAt:
          status === 'IN_PROGRESS' ? null : new Date(time.getTime() + 3600000),
        exercises: {
          create: snapshot(exercise, name, time, sets, 1, canonical),
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
    sessionIds.push(result.id);
    return result;
  }
  async function observed(path: string, token: string, count: number) {
    statements.length = 0;
    const result = await request(path, token);
    const reads = selects(statements);
    assert.equal(reads.length, count);
    for (const sql of reads)
      assert.doesNotMatch(
        sql,
        /(?:INSERT|UPDATE|DELETE)\s|(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:users|exercises|workout_templates)"?\s/i,
      );
    return result;
  }
  try {
    await db.$connect();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    const catalog = await db.exercise.findMany({ orderBy: { slug: 'asc' } });
    const bench = catalog.find(
      (exercise) => exercise.slug === 'barbell-bench-press',
    );
    const squat = catalog.find((exercise) => exercise.slug === 'back-squat');
    assert.ok(bench && squat);
    const remaining = catalog.filter(
      (exercise) => exercise.id !== bench.id && exercise.id !== squat.id,
    );
    const row = remaining[0]!,
      bodyweightExercise = remaining[1]!,
      highRepsExercise = remaining[2]!,
      decimalExercise = remaining[3]!;
    assert.ok(decimalExercise);
    const a = await register(),
      b = await register();
    const feed = (limit?: number, token = a.token) =>
      request(endpoint + (limit === undefined ? '' : '?limit=' + limit), token);
    const dashboard = (weekStart = '2026-10-05') =>
      '/dashboard/summary?' +
      new URLSearchParams({ weekStart, timezone: 'Europe/Madrid' });
    await context.test(
      'empty authenticated feeds use two SELECTs; empty Dashboard uses ten, strict limits and routes coexist',
      async () => {
        await request(endpoint, undefined, 401);
        assert.deepEqual(await observed(endpoint, a.token, 2), { items: [] });
        const empty = await observed(dashboard(), a.token, 10);
        assert.deepEqual(empty.exerciseHighlights, []);
        for (const limit of [1, 20])
          assert.deepEqual(await feed(limit), { items: [] });
        for (const query of [
          'limit=0',
          'limit=21',
          'limit=1.5',
          'limit=abc',
          'limit=01',
          'limit=1e1',
          'limit=1&limit=2',
          'limit=%201%20',
          'foo=bar',
          'userId=' + b.id,
        ])
          await request(endpoint + '?' + query, a.token, 400);
        await request('/analytics/overview', a.token);
        await request('/analytics/exercises/' + bench.id, a.token);
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
          await request(endpoint, a.token, 404, undefined, method);
      },
    );
    await session(a.id, bench, '2026-01-01', [['100', 5]], 'Old PR snapshot');
    const previous = await session(
      a.id,
      bench,
      '2026-09-19',
      [
        ['75', 8],
        ['75', 8],
      ],
      'Previous Bench snapshot',
    );
    const latest = await session(
      a.id,
      bench,
      '2026-09-20',
      [
        ['80', 8],
        ['80', 8],
        ['0', 10],
      ],
      'Latest Bench snapshot',
    );
    const squatSession = await session(
      a.id,
      squat,
      '2026-09-10',
      [
        ['100', 5],
        ['100', 5],
      ],
      'Squat snapshot',
    );
    await session(a.id, row, '2026-09-01', [['70', 10]], 'Row snapshot');
    await session(a.id, bench, '2026-09-25', [], 'More recent but zero sets');
    await session(
      a.id,
      bench,
      '2026-09-26',
      [['9000', 10]],
      'Cancelled',
      'CANCELLED',
    );
    await session(
      a.id,
      bench,
      '2026-09-27',
      [['9000', 10]],
      'Active',
      'IN_PROGRESS',
    );
    await session(
      a.id,
      bench,
      '2026-09-29',
      [['9000', 10]],
      'Null canonical source',
      'COMPLETED',
      false,
    );
    await session(
      b.id,
      bench,
      '2026-09-30',
      [['9000', 10]],
      'Foreign snapshot',
    );
    await context.test(
      'Bench latest 3/26/1280/80/101.33, previous 2/16/1200/75/95; limit after distinct and old PR never substitutes latest',
      async () => {
        const items = rows(
          (await observed(endpoint + '?limit=3', a.token, 2)).items,
        );
        assert.deepEqual(
          items.map((item) => object(item.exercise).sourceExerciseId),
          [bench.id, squat.id, row.id],
        );
        assert.deepEqual(items[0], {
          exercise: {
            sourceExerciseId: bench.id,
            name: 'Latest Bench snapshot',
            slug: bench.slug,
          },
          latest: {
            workoutSessionId: latest.id,
            startedAt: latest.startedAt.toISOString(),
            completedSets: 3,
            totalReps: 26,
            totalVolumeKg: 1280,
            maxLoadKg: 80,
            bestEstimated1RMKg: 101.33,
          },
          previous: {
            workoutSessionId: previous.id,
            startedAt: previous.startedAt.toISOString(),
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 1200,
            maxLoadKg: 75,
            bestEstimated1RMKg: 95,
          },
        });
        assert.deepEqual(items[1], {
          exercise: {
            sourceExerciseId: squat.id,
            name: 'Squat snapshot',
            slug: squat.slug,
          },
          latest: {
            workoutSessionId: squatSession.id,
            startedAt: squatSession.startedAt.toISOString(),
            completedSets: 2,
            totalReps: 10,
            totalVolumeKg: 1000,
            maxLoadKg: 100,
            bestEstimated1RMKg: 116.67,
          },
          previous: null,
        });
        assert.deepEqual(rows((await feed(1)).items), [items[0]]);
        assert.equal(rows((await feed(20)).items).length, 3);
        assert.equal(
          object(
            (await request('/analytics/exercises/' + bench.id, a.token))
              .summary,
          ).maxLoadKg,
          100,
        );
        assert.equal(
          object(
            (await request('/records/exercises/' + bench.id, a.token))
              .maxLoadRecord,
          ).valueKg,
          100,
        );
        const foreign = rows((await feed(5, b.token)).items)[0]!;
        assert.equal(object(foreign.latest).maxLoadKg, 9000);
        assert.equal(object(foreign.exercise).name, 'Foreign snapshot');
      },
    );
    await context.test(
      'catalog mutation and renamed/archived/deleted planning cannot reconstruct historical latest metadata',
      async () => {
        const before = await feed();
        const template = await db.workoutTemplate.create({
          data: { userId: a.id, name: 'GYM-027 temporary planning' },
        });
        await db.workoutSession.update({
          where: { id: latest.id, userId: a.id },
          data: { sourceTemplateId: template.id },
        });
        try {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              name: 'Changed mutable catalog',
              slug: 'gym027-' + randomUUID(),
              isActive: false,
            },
          });
          await db.workoutTemplate.update({
            where: { id: template.id, userId: a.id },
            data: {
              name: 'Changed template',
              archivedAt: new Date('2026-09-30T10:00:00Z'),
            },
          });
          assert.deepEqual(await feed(), before);
          await db.workoutTemplate.delete({
            where: { id: template.id, userId: a.id },
          });
          assert.deepEqual(await feed(), before);
        } finally {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
              name: bench.name,
              slug: bench.slug,
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
      'same instant ties use parent UUID DESC then canonical source ASC; same-session occurrences use position ASC',
      async () => {
        const first = await session(
          a.id,
          bench,
          '2040-01-01',
          [['60', 5]],
          'Tie lower parent',
        );
        const second = await session(
          a.id,
          bench,
          '2040-01-01',
          [['70', 5]],
          'Tie higher parent',
        );
        const [low, high] = [first, second].sort((x, y) =>
          x.id.localeCompare(y.id),
        );
        assert.ok(low && high);
        await db.workoutSessionExercise.create({
          data: {
            workoutSessionId: high.id,
            ...snapshot(
              squat,
              'Same session Squat',
              high.startedAt,
              [['90', 5]],
              2,
            ),
          },
        });
        const items = rows((await feed(2)).items);
        assert.deepEqual(
          items.map((item) => object(item.exercise).sourceExerciseId),
          [bench.id, squat.id].sort(),
        );
        const benchItem = items.find(
          (item) => object(item.exercise).sourceExerciseId === bench.id,
        )!;
        assert.equal(object(benchItem.latest).workoutSessionId, high.id);
        assert.equal(object(benchItem.previous).workoutSessionId, low.id);
        const duplicate = await db.workoutSessionExercise.create({
          data: {
            workoutSessionId: high.id,
            ...snapshot(
              bench,
              'Same session second Bench',
              high.startedAt,
              [['95', 5]],
              3,
            ),
          },
        });
        const tied = rows((await feed(2)).items).find(
          (item) => object(item.exercise).sourceExerciseId === bench.id,
        )!;
        assert.equal(
          object(tied.exercise).name,
          high.exercises[0]!.exerciseName,
        );
        assert.equal(object(tied.previous).workoutSessionId, high.id);
        assert.equal(object(tied.previous).maxLoadKg, 95);
        await db.workoutSessionExercise.delete({ where: { id: duplicate.id } });
        await db.workoutSession.deleteMany({
          where: { id: { in: [first.id, second.id] }, userId: a.id },
        });
      },
    );
    await session(
      a.id,
      bodyweightExercise,
      '2026-09-21',
      [['0', 10]],
      'Bodyweight',
    );
    await session(
      a.id,
      highRepsExercise,
      '2026-09-22',
      [['50', 25]],
      'High reps',
    );
    await session(
      a.id,
      decimalExercise,
      '2026-09-23',
      [['82.25', 7]],
      'Decimal',
    );
    await context.test(
      'bodyweight/high reps give null e1RM, fractional NUMERIC is exact, bounded default/custom limits and all-time Dashboard cross-check',
      async () => {
        const all = rows((await feed(20)).items);
        assert.equal(all.length, 6);
        const byExercise = (id: string) =>
          object(
            all.find((item) => object(item.exercise).sourceExerciseId === id)!
              .latest,
          );
        assert.deepEqual(
          [
            byExercise(bodyweightExercise.id).completedSets,
            byExercise(bodyweightExercise.id).totalReps,
            byExercise(bodyweightExercise.id).totalVolumeKg,
            byExercise(bodyweightExercise.id).maxLoadKg,
            byExercise(bodyweightExercise.id).bestEstimated1RMKg,
          ],
          [1, 10, 0, 0, null],
        );
        assert.equal(byExercise(highRepsExercise.id).maxLoadKg, 50);
        assert.equal(byExercise(highRepsExercise.id).bestEstimated1RMKg, null);
        assert.equal(byExercise(decimalExercise.id).totalVolumeKg, 575.75);
        assert.equal(byExercise(decimalExercise.id).bestEstimated1RMKg, 101.44);
        assert.deepEqual(rows((await feed(2)).items), all.slice(0, 2));
        const expected = rows((await feed()).items);
        assert.equal(expected.length, 5);
        for (const weekStart of ['2026-10-05', '2099-01-05']) {
          const result = await observed(dashboard(weekStart), a.token, 10);
          assert.deepEqual(result.exerciseHighlights, expected);
          assert.equal(rows(result.exerciseHighlights).length, 5);
          if (weekStart === '2099-01-05')
            assert.equal(object(result.week).completedWorkouts, 0);
        }
        const foreign = await observed(dashboard('2099-01-05'), b.token, 10);
        assert.deepEqual(
          foreign.exerciseHighlights,
          (await feed(5, b.token)).items,
        );
        await request(dashboard() + '&highlightsLimit=1', a.token, 400);
        context.diagnostic(
          'Observed real domain SELECTs: exercise highlights=2, including empty; Dashboard=10, including future. No per-exercise reads.',
        );
      },
    );
    await context.test(
      'candidate bound, EXPLAIN ANALYZE with existing indexes and RepeatableRead excludes a concurrent set update between reads',
      async () => {
        const captured: Prisma.Sql[] = [];
        let injectWrite = false;
        const targetSet = latest.exercises[0]!.sets[0]!;
        const reads = await Test.createTestingModule({
          providers: [
            AnalyticsRepository,
            {
              provide: PrismaService,
              useValue: {
                $transaction: (
                  work: (tx: {
                    $queryRaw: (sql: Prisma.Sql) => Promise<unknown>;
                  }) => Promise<unknown>,
                  options: { isolationLevel: Prisma.TransactionIsolationLevel },
                ) =>
                  db.$transaction(
                    async (tx) =>
                      work({
                        $queryRaw: async (sql: Prisma.Sql) => {
                          captured.push(sql);
                          const result = await tx.$queryRaw(sql);
                          if (injectWrite) {
                            injectWrite = false;
                            await db.setEntry.update({
                              where: { id: targetSet.id },
                              data: { loadKg: '90' },
                            });
                          }
                          return result;
                        },
                      }),
                    options,
                  ),
              },
            },
          ],
        }).compile();
        try {
          const repository = reads.get(AnalyticsRepository);
          const before = await repository.findExerciseHighlightPerformances(
            a.id,
            20,
          );
          assert.equal(captured.length, 2);
          assert.ok(before.performances.length <= 40);
          const byPerformance = new Map<string, Set<number>>();
          for (const candidate of before.estimatedCandidates) {
            const reps =
              byPerformance.get(candidate.sessionExerciseId) ??
              new Set<number>();
            assert.equal(reps.has(candidate.reps), false);
            reps.add(candidate.reps);
            byPerformance.set(candidate.sessionExerciseId, reps);
          }
          assert.ok(
            [...byPerformance.values()].every((reps) => reps.size <= 20),
          );
          for (const query of captured) {
            const plan = await db.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
              Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
            );
            const root = rows(plan[0]!['QUERY PLAN'])[0]!;
            assert.match(JSON.stringify(root.Plan), /Aggregate/);
            context.diagnostic(
              `Highlight EXPLAIN: ${String(root['Execution Time'])} ms; existing indexes, no migration.`,
            );
          }
          injectWrite = true;
          assert.deepEqual(
            await repository.findExerciseHighlightPerformances(a.id, 20),
            before,
          );
          const after = await repository.findExerciseHighlightPerformances(
            a.id,
            20,
          );
          assert.equal(
            after.performances.find(
              (p) => p.sessionExerciseId === latest.exercises[0]!.id,
            )!.maxLoadKg,
            '90.00',
          );
          assert.equal(
            after.estimatedCandidates.find(
              (c) =>
                c.sessionExerciseId === latest.exercises[0]!.id && c.reps === 8,
            )!.loadKg,
            '90.00',
          );
        } finally {
          await db.setEntry.update({
            where: { id: targetSet.id },
            data: { loadKg: targetSet.loadKg, updatedAt: targetSet.updatedAt },
          });
          await reads.close();
        }
      },
    );
    const migrations = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    assert.equal(migrations[0]!.count, 8n);
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
