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
} from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecordsRepository } from '../../src/records/records.repository';
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
const endpoint = '/records/current';
const readStatements = (statements: readonly string[]) =>
  statements.filter((sql) => /^\s*\(*\s*(?:WITH|SELECT)\b/i.test(sql));

void test('Current Records PostgreSQL HTTP: derived holders, exact first achievements, scoped snapshots, two reads and seven-read Dashboard', async (context) => {
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
    method = 'GET',
    body?: unknown,
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
    if (expected === 204) {
      await response.arrayBuffer();
      return {};
    }
    const result = object(await response.json());
    assert.doesNotMatch(
      JSON.stringify(result),
      /"(?:passwordHash|stack|Prisma|userId)"/,
    );
    return result;
  }
  async function register() {
    const email = `gym025-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request('/auth/register', undefined, 201, 'POST', {
      email,
      password: randomBytes(32).toString('base64url'),
    });
    return {
      id: string(object(result.user).id),
      token: string(result.accessToken),
    };
  }
  async function session(
    userId: string,
    exercise: Exercise,
    day: number,
    loadKg: string,
    reps: number,
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
    canonical = true,
  ) {
    const startedAt = new Date(Date.UTC(2026, 8, day, 10));
    const result = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-025 historical workout ' + day,
        status,
        startedAt,
        endedAt:
          status === 'IN_PROGRESS'
            ? null
            : new Date(startedAt.getTime() + 3600000),
        exercises: {
          create: [
            {
              position: 1,
              sourceExerciseId: canonical ? exercise.id : null,
              exerciseName: exercise.name + ' snapshot ' + day,
              exerciseSlug: exercise.slug,
              primaryMuscle: exercise.primaryMuscle,
              secondaryMuscles: exercise.secondaryMuscles,
              equipment: exercise.equipment,
              movementPattern: exercise.movementPattern,
              plannedSets: 1,
              plannedRepsMin: 5,
              plannedRepsMax: 10,
              plannedRestSeconds: 90,
              sets: {
                create: [
                  {
                    position: 1,
                    loadKg,
                    reps,
                    completedAt: new Date(startedAt.getTime() + 60000),
                  },
                ],
              },
            },
          ],
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
    sessionIds.push(result.id);
    return result;
  }
  const holder = (
    items: Record<string, unknown>[],
    exerciseId: string,
    type: string,
  ) => {
    const item = items.find(
      (row) =>
        object(row.exercise).sourceExerciseId === exerciseId &&
        row.type === type,
    );
    assert.ok(item);
    return item;
  };
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
    const squat = await db.exercise.findUniqueOrThrow({
      where: { slug: 'back-squat' },
    });
    const others = await db.exercise.findMany({
      where: { id: { notIn: [bench.id, squat.id] } },
      orderBy: { id: 'asc' },
      take: 4,
    });
    assert.equal(others.length, 4);
    const [highReps, bodyweight, tieExercise, decimalExercise] = others as [
      Exercise,
      Exercise,
      Exercise,
      Exercise,
    ];
    const a = await register(),
      b = await register();
    const feed = async (limit = 20, token = a.token) =>
      rows((await request(endpoint + '?limit=' + limit, token)).items);
    const dashboard = (weekStart = '2026-09-07', token = a.token) =>
      request(
        '/dashboard/summary?' +
          new URLSearchParams({ weekStart, timezone: 'Europe/Madrid' }),
        token,
      );
    await context.test(
      'empty authenticated records and Dashboard; strict limits, unknown parameters and no writes',
      async () => {
        await request(endpoint, undefined, 401);
        assert.deepEqual(await request(endpoint, a.token), { items: [] });
        assert.deepEqual((await dashboard()).personalRecords, []);
        for (const query of [
          'limit=0',
          'limit=21',
          'limit=abc',
          'limit=1.5',
          'limit=1&limit=2',
          'userId=' + b.id,
          'status=COMPLETED',
          'type=MAX_LOAD',
          'page=1',
        ])
          await request(endpoint + '?' + query, a.token, 400);
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
          await request(endpoint, a.token, 404, method);
        await request(
          '/dashboard/summary?weekStart=2026-09-07&timezone=UTC&recordsLimit=1',
          a.token,
          400,
        );
      },
    );
    await session(a.id, bench, 1, '80', 8);
    // This holder comes from the actual snapshot-producing HTTP workflow.
    const template = await request('/workout-templates', a.token, 201, 'POST', {
      name: 'GYM-025 Bench planning',
    });
    const templateId = string(template.id);
    await request(
      `/workout-templates/${templateId}/exercises`,
      a.token,
      201,
      'POST',
      {
        exerciseId: bench.id,
        targetSets: 1,
        targetRepsMin: 5,
        targetRepsMax: 5,
      },
    );
    const started = await request('/workout-sessions', a.token, 201, 'POST', {
      workoutTemplateId: templateId,
    });
    const maxSessionId = string(started.id),
      entryId = string(rows(started.exercises)[0]!.id);
    sessionIds.push(maxSessionId);
    const maxSet = await request(
      `/workout-sessions/${maxSessionId}/exercises/${entryId}/sets`,
      a.token,
      201,
      'POST',
      { loadKg: 100, reps: 5 },
    );
    const maxSetId = string(maxSet.id),
      maxTime = new Date('2026-09-02T10:01:00Z');
    await db.workoutSession.update({
      where: { id: maxSessionId, userId: a.id },
      data: { startedAt: new Date('2026-09-02T10:00:00Z') },
    });
    await db.setEntry.update({
      where: { id: maxSetId },
      data: { completedAt: maxTime },
    });
    await request(
      `/workout-sessions/${maxSessionId}/complete`,
      a.token,
      200,
      'POST',
    );
    const e1rmSession = await session(a.id, bench, 3, '90', 10);
    const squatSession = await session(a.id, squat, 4, '120', 5);
    await session(a.id, bench, 20, '1000', 10, 'CANCELLED');
    await session(a.id, bench, 21, '2000', 1, 'IN_PROGRESS');
    await session(b.id, bench, 22, '3000', 1);
    await session(a.id, bench, 23, '4000', 1, 'COMPLETED', false);
    await context.test(
      'Bench MAX_LOAD 100 and Epley 120 have different holders; Squat 120/140 share a set',
      async () => {
        const data = await feed();
        const max = holder(data, bench.id, 'MAX_LOAD'),
          estimated = holder(data, bench.id, 'ESTIMATED_1RM');
        assert.equal(max.valueKg, 100);
        assert.equal(max.setEntryId, maxSetId);
        assert.equal(max.achievedAt, maxTime.toISOString());
        assert.equal(object(max.exercise).name, bench.name);
        assert.equal(estimated.valueKg, 120);
        assert.equal(
          estimated.setEntryId,
          e1rmSession.exercises[0]!.sets[0]!.id,
        );
        assert.equal(
          object(estimated.exercise).name,
          bench.name + ' snapshot 3',
        );
        assert.equal(holder(data, squat.id, 'MAX_LOAD').valueKg, 120);
        assert.equal(holder(data, squat.id, 'ESTIMATED_1RM').valueKg, 140);
        assert.equal(
          holder(data, squat.id, 'MAX_LOAD').setEntryId,
          squatSession.exercises[0]!.sets[0]!.id,
        );
        assert.equal(
          holder(data, squat.id, 'ESTIMATED_1RM').setEntryId,
          squatSession.exercises[0]!.sets[0]!.id,
        );
        const old = await request('/records/exercises/' + bench.id, a.token);
        assert.equal(object(old.maxLoadRecord).valueKg, 100);
        assert.equal(object(old.estimated1RMRecord).valueKg, 120);
        assert.equal(object(object(old.maxLoadRecord).set).id, max.setEntryId);
        assert.equal(
          holder(await feed(20, b.token), bench.id, 'MAX_LOAD').valueKg,
          3000,
        );
        assert.ok(data.every((item) => Number(item.loadKg) <= 120));
      },
    );
    const laterMax = await session(a.id, bench, 6, '100', 10);
    await session(a.id, bench, 7, '100', 10);
    await context.test(
      'later 100x10 never replaces first MAX_LOAD; its stronger Epley is 133.33 and later exact repetitions retain its first holder',
      async () => {
        const data = await feed();
        assert.equal(holder(data, bench.id, 'MAX_LOAD').setEntryId, maxSetId);
        assert.equal(holder(data, bench.id, 'MAX_LOAD').reps, 5);
        assert.equal(holder(data, bench.id, 'ESTIMATED_1RM').valueKg, 133.33);
        assert.equal(
          holder(data, bench.id, 'ESTIMATED_1RM').setEntryId,
          laterMax.exercises[0]!.sets[0]!.id,
        );
      },
    );
    await session(a.id, highReps, 8, '200', 25);
    await session(a.id, bodyweight, 9, '0', 10);
    const tieFirst = await session(a.id, tieExercise, 10, '80', 15);
    const tieLater = await session(a.id, tieExercise, 11, '90', 10);
    const decimal = await session(a.id, decimalExercise, 12, '82.25', 7);
    await context.test(
      'bodyweight omitted, high reps only MAX_LOAD, exact cross-rep Epley tie and Decimal 82.25 round trip',
      async () => {
        const data = await feed();
        assert.equal(data.length, 9);
        assert.equal(
          data.filter(
            (item) => object(item.exercise).sourceExerciseId === bodyweight.id,
          ).length,
          0,
        );
        assert.deepEqual(
          data
            .filter(
              (item) => object(item.exercise).sourceExerciseId === highReps.id,
            )
            .map((item) => [item.type, item.valueKg]),
          [['MAX_LOAD', 200]],
        );
        assert.equal(
          holder(data, tieExercise.id, 'ESTIMATED_1RM').valueKg,
          120,
        );
        assert.equal(
          holder(data, tieExercise.id, 'ESTIMATED_1RM').setEntryId,
          tieFirst.exercises[0]!.sets[0]!.id,
        );
        assert.equal(
          holder(data, decimalExercise.id, 'ESTIMATED_1RM').valueKg,
          101.44,
        );
        assert.equal(decimal.exercises[0]!.sets[0]!.loadKg.toString(), '82.25');
        const time = new Date('2026-09-15T10:00:00Z');
        const ids = [
          tieFirst.exercises[0]!.sets[0]!.id,
          tieLater.exercises[0]!.sets[0]!.id,
        ];
        for (const id of ids)
          await db.setEntry.update({
            where: { id },
            data: { completedAt: time },
          });
        assert.equal(
          holder(await feed(), tieExercise.id, 'ESTIMATED_1RM').setEntryId,
          ids.sort()[0],
        );
      },
    );
    await context.test(
      'derive holders before global ordering/limit; same time canonical type then exercise/set IDs, never recent submaximal sets',
      async () => {
        await session(a.id, squat, 26, '1', 1);
        const data = await feed();
        const types = ['MAX_LOAD', 'ESTIMATED_1RM'];
        const sorted = [...data].sort(
          (a, b) =>
            Date.parse(string(b.achievedAt)) -
              Date.parse(string(a.achievedAt)) ||
            types.indexOf(string(a.type)) - types.indexOf(string(b.type)) ||
            string(object(a.exercise).sourceExerciseId).localeCompare(
              string(object(b.exercise).sourceExerciseId),
            ) ||
            string(a.setEntryId).localeCompare(string(b.setEntryId)),
        );
        assert.deepEqual(data, sorted);
        assert.deepEqual(await feed(2), data.slice(0, 2));
        assert.deepEqual(
          rows((await request(endpoint, a.token)).items),
          data.slice(0, 5),
        );
        assert.ok(data.every((item) => item.loadKg !== 1));
        for (const row of data)
          assert.deepEqual(Object.keys(row).sort(), [
            'achievedAt',
            'exercise',
            'loadKg',
            'reps',
            'setEntryId',
            'type',
            'valueKg',
            'workoutSessionId',
          ]);
      },
    );
    await context.test(
      'catalog name/inactive state and planning rename/archive/delete cannot reconstruct record metadata',
      async () => {
        const before = await feed();
        try {
          await db.exercise.update({
            where: { id: bench.id },
            data: { name: 'GYM-025 temporary mutable name', isActive: false },
          });
          await request(
            `/workout-templates/${templateId}`,
            a.token,
            200,
            'PATCH',
            { name: 'Renamed mutable planning' },
          );
          await request(
            `/workout-templates/${templateId}`,
            a.token,
            204,
            'DELETE',
          );
          assert.deepEqual(await feed(), before);
          await db.workoutTemplate.delete({
            where: { id: templateId, userId: a.id },
          });
          assert.deepEqual(await feed(), before);
        } finally {
          await db.exercise.update({
            where: { id: bench.id },
            data: {
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
      'Records/Dashboard identical bounded all-time items, future independence, two/seven fixed SELECTs',
      async () => {
        const expected = await feed(5);
        for (const limit of [1, 5, 20]) {
          statements.length = 0;
          await feed(limit);
          assert.equal(readStatements(statements).length, 2);
        }
        for (const week of ['2026-09-07', '2099-01-05']) {
          statements.length = 0;
          const result = await dashboard(week);
          assert.equal(readStatements(statements).length, 7);
          assert.deepEqual(result.personalRecords, expected);
          assert.equal(rows(result.personalRecords).length, 5);
          if (week === '2099-01-05')
            assert.equal(object(result.week).completedWorkouts, 0);
          for (const sql of readStatements(statements))
            assert.doesNotMatch(
              sql,
              /(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:exercises|workout_templates|users)"?\s|(?:INSERT|UPDATE|DELETE)\s/i,
            );
        }
        const foreign = rows(
          (await dashboard('2099-01-05', b.token)).personalRecords,
        );
        assert.ok(foreign.every((row) => Number(row.loadKg) === 3000));
        context.diagnostic(
          'Observed current Records: 2 SELECTs; Dashboard: 7 domain SELECTs (transaction control excluded).',
        );
      },
    );
    await context.test(
      'existing indexes support both candidate plans; RepeatableRead excludes a concurrent record between SELECTs',
      async () => {
        const captured: Prisma.Sql[] = [];
        let injectWrite = false,
          concurrentId: string | undefined;
        const reads = await Test.createTestingModule({
          providers: [
            RecordsRepository,
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
                            concurrentId = (
                              await session(a.id, bench, 27, '500', 1)
                            ).id;
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
          const repository = reads.get(RecordsRepository);
          const before = await repository.findCurrentRecordCandidates(a.id);
          assert.equal(captured.length, 2);
          const perExercise = new Map<string, number>();
          for (const candidate of before.estimatedCandidates)
            perExercise.set(
              candidate.sourceExerciseId,
              (perExercise.get(candidate.sourceExerciseId) ?? 0) + 1,
            );
          assert.ok([...perExercise.values()].every((count) => count <= 20));
          for (const query of captured) {
            const plan = await db.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
              Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
            );
            const root = rows(plan[0]!['QUERY PLAN'])[0]!;
            assert.match(JSON.stringify(root.Plan), /Unique/);
            context.diagnostic(
              `Current record candidate EXPLAIN: ${String(root['Execution Time'])} ms; existing indexes/no migration.`,
            );
          }
          injectWrite = true;
          const during = await repository.findCurrentRecordCandidates(a.id);
          assert.deepEqual(during, before);
          const after = await repository.findCurrentRecordCandidates(a.id);
          assert.equal(
            after.maxLoadCandidates.find(
              (row) => row.sourceExerciseId === bench.id,
            )!.loadKg,
            '500.00',
          );
          assert.ok(concurrentId);
          await db.workoutSession.delete({
            where: { id: concurrentId, userId: a.id },
          });
          concurrentId = undefined;
        } finally {
          if (concurrentId)
            await db.workoutSession.delete({
              where: { id: concurrentId, userId: a.id },
            });
          await reads.close();
        }
        const migrations = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
        assert.equal(migrations[0]!.count, 8n);
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
