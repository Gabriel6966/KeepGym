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
const endpoint = '/training-trends/weekly';
const query = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-30T23:59:59+02:00',
  timezone: 'Europe/Madrid',
};

void test('Training trends PostgreSQL HTTP: exact weekly aggregates, IANA boundaries, ownership, one query and existing indexes', async (context) => {
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
    const result = object(await response.json());
    if (path.startsWith('/training-trends')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'stack',
        'Prisma',
        'Decimal',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym016-${randomUUID()}@example.com`;
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
  const weekly = (token: string, override: Partial<typeof query> = {}) =>
    request(
      'GET',
      endpoint + '?' + new URLSearchParams({ ...query, ...override }),
      token,
    );
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const a = await register();
    const b = await register();
    assert.deepEqual((await weekly(a.token)).buckets, []);
    const catalog = await db.exercise.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    assert.equal(catalog.length, 2, 'Run db:seed before test:postgres.');
    async function template(token: string) {
      const result = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-016 temporary snapshot' },
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
      for (const [index, set] of sets.entries())
        await request(
          'POST',
          `/workout-sessions/${id}/exercises/${string(entries[index % entries.length]!.id)}/sets`,
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
      return id;
    }
    await session(a, templateA, '2026-09-14T10:00:00Z', 'COMPLETED', [
      { loadKg: 80, reps: 8 },
      { loadKg: 80, reps: 8 },
    ]);
    await session(a, templateA, '2026-09-18T10:00:00Z', 'COMPLETED');
    await session(a, templateA, '2026-09-21T10:00:00Z', 'COMPLETED', [
      { loadKg: 82.25, reps: 7 },
    ]);
    await session(a, templateA, '2026-09-22T10:00:00Z', 'CANCELLED', [
      { loadKg: 200, reps: 10 },
    ]);
    await session(a, templateA, '2026-09-23T10:00:00Z', 'IN_PROGRESS', [
      { loadKg: 250, reps: 10 },
    ]);
    await session(b, templateB, '2026-09-21T10:00:00Z', 'COMPLETED', [
      { loadKg: 300, reps: 10 },
    ]);

    await context.test(
      'expected weeks are 2/2/16/1280 and 1/1/7/575.75; foreign and unfinished sessions do not contribute',
      async () => {
        assert.deepEqual((await weekly(a.token)).buckets, [
          {
            weekStart: '2026-09-14',
            completedWorkouts: 2,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 1280,
          },
          {
            weekStart: '2026-09-21',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 7,
            totalVolumeKg: 575.75,
          },
        ]);
        assert.deepEqual((await weekly(b.token)).buckets, [
          {
            weekStart: '2026-09-21',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 10,
            totalVolumeKg: 3000,
          },
        ]);
        const zero = await weekly(a.token, {
          from: '2026-09-18T12:00:00+02:00',
          to: '2026-09-18T10:00:00Z',
        });
        assert.deepEqual(zero.buckets, [
          {
            weekStart: '2026-09-14',
            completedWorkouts: 1,
            completedSets: 0,
            totalReps: 0,
            totalVolumeKg: 0,
          },
        ]);
        // endedAt and SetEntry.completedAt are now, but startedAt is historical.
        assert.deepEqual(
          (await weekly(a.token, { from: '2026-09-24T00:00:00Z' })).buckets,
          [],
        );
      },
    );
    await context.test(
      'Monday boundary uses Madrid, not UTC or New York, with millisecond-inclusive limits',
      async () => {
        const from = '2026-09-20T21:59:59.999Z';
        const to = '2026-09-20T22:00:00Z';
        await session(a, templateA, from, 'COMPLETED');
        await session(a, templateA, to, 'COMPLETED');
        const madrid = array((await weekly(a.token, { from, to })).buckets);
        assert.deepEqual(
          madrid.map((bucket) => bucket.weekStart),
          ['2026-09-14', '2026-09-21'],
        );
        assert.deepEqual(
          madrid.map((bucket) => bucket.completedWorkouts),
          [1, 1],
        );
        for (const timezone of ['UTC', 'America/New_York']) {
          const buckets = array(
            (await weekly(a.token, { from, to, timezone })).buckets,
          );
          assert.deepEqual(buckets, [
            {
              weekStart: '2026-09-14',
              completedWorkouts: 2,
              completedSets: 0,
              totalReps: 0,
              totalVolumeKg: 0,
            },
          ]);
        }
        const nyFrom = '2026-09-21T03:59:59.999Z';
        const nyTo = '2026-09-21T04:00:00Z';
        await session(a, templateA, nyFrom, 'COMPLETED');
        await session(a, templateA, nyTo, 'COMPLETED');
        assert.deepEqual(
          array(
            (
              await weekly(a.token, {
                from: nyFrom,
                to: nyTo,
                timezone: 'America/New_York',
              })
            ).buckets,
          ).map((bucket) => bucket.weekStart),
          ['2026-09-14', '2026-09-21'],
        );
        assert.deepEqual(
          array(
            (await weekly(a.token, { from: nyFrom, to: nyTo, timezone: 'UTC' }))
              .buckets,
          ).map((bucket) => bucket.weekStart),
          ['2026-09-21'],
        );
      },
    );
    await context.test(
      'IANA DST is delegated to PostgreSQL; winter/summer offsets and local week dates remain correct',
      async () => {
        for (const [instant, weekStart] of [
          ['2026-01-04T22:30:00Z', '2025-12-29'],
          ['2026-07-05T22:30:00Z', '2026-07-06'],
        ]) {
          await session(a, templateA, instant!, 'COMPLETED');
          assert.equal(
            array(
              (await weekly(a.token, { from: instant, to: instant })).buckets,
            )[0]?.weekStart,
            weekStart,
          );
        }
        // A different database session timezone must not change the explicit bucket timezone.
        const range = {
          from: new Date(query.from),
          to: new Date(query.to),
          timezone: query.timezone,
        };
        const normal = await app
          .get(TrainingTrendsRepository)
          .findWeeklyTrends(a.id, range);
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
                .findWeeklyTrends(a.id, range),
              normal,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'zero-set and zero-exercise workouts survive LEFT JOINs; bodyweight volume is exactly zero and empty weeks stay absent',
      async () => {
        const zeroId = await session(
          a,
          templateA,
          '2026-09-07T10:00:00Z',
          'COMPLETED',
        );
        // Exceptional fixture with no snapshot entries verifies both outer joins.
        await db.workoutSessionExercise.deleteMany({
          where: { workoutSessionId: zeroId, workoutSession: { userId: a.id } },
        });
        const bodyweight = await session(
          a,
          templateA,
          '2026-09-07T11:00:00Z',
          'COMPLETED',
          [{ loadKg: 0, reps: 20 }],
        );
        assert.ok(bodyweight);
        const result = await weekly(a.token, { to: '2026-09-08T00:00:00Z' });
        assert.deepEqual(result.buckets, [
          {
            weekStart: '2026-09-07',
            completedWorkouts: 2,
            completedSets: 1,
            totalReps: 20,
            totalVolumeKg: 0,
          },
        ]);
        assert.deepEqual(
          (
            await weekly(a.token, {
              from: '2026-08-01T00:00:00Z',
              to: '2026-08-31T00:00:00Z',
            })
          ).buckets,
          [],
        );
      },
    );
    await context.test(
      'weekly read executes one SELECT regardless of range, uses existing indexes and does not mutate data',
      async () => {
        const before = await db.workoutSession.findMany({
          where: { userId: a.id },
          orderBy: { id: 'asc' },
          include: {
            exercises: {
              orderBy: { position: 'asc' },
              include: { sets: { orderBy: { position: 'asc' } } },
            },
          },
        });
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        traced.$on('query', (event) => statements.push(event.query));
        let captured: Prisma.Sql | undefined;
        const queryModule = await Test.createTestingModule({
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
          const reads = queryModule.get(TrainingTrendsRepository);
          for (const from of [
            new Date('2026-09-14T00:00:00Z'),
            new Date('2024-09-30T00:00:00Z'),
          ]) {
            statements.length = 0;
            await reads.findWeeklyTrends(a.id, {
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
                /(?:FROM|JOIN)\s+(?:users|profiles|exercises|workout_templates)\b/i,
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
          assert.doesNotMatch(planText, /"Node Type":"ModifyTable"/);
          const used = [...planText.matchAll(/"Index Name":"([^"]+)"/g)].map(
            (match) => match[1],
          );
          context.diagnostic(
            `Weekly SELECT count: 1. EXPLAIN execution ${String(root['Execution Time'])} ms; indexes observed: ${[...new Set(used)].join(', ') || 'small-table scans'}.`,
          );
          const indexes = await db.$queryRaw<
            { indexname: string; indexdef: string }[]
          >`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx', 'workout_session_exercises_position_key', 'set_entries_exercise_position_key')`;
          assert.equal(indexes.length, 4);
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
        assert.deepEqual(
          await db.workoutSession.findMany({
            where: { userId: a.id },
            orderBy: { id: 'asc' },
            include: {
              exercises: {
                orderBy: { position: 'asc' },
                include: { sets: { orderBy: { position: 'asc' } } },
              },
            },
          }),
          before,
        );
      },
    );
    await context.test(
      'real API enforces required timezone/range, maximum duration, owner identity and no pagination',
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
        const invalidQueries: Record<string, string>[] = [
          { timezone: 'Europe/Foo' },
          { timezone: 'GMT+2' },
          { timezone: '+02:00' },
          { from: '2026-09-01T00:00:00' },
          { from: '2026-10-01T00:00:00Z' },
          { from: '2023-01-01T00:00:00Z' },
          { userId: b.id },
          { page: '1' },
          { status: 'CANCELLED' },
        ];
        for (const override of invalidQueries)
          await request(
            'GET',
            endpoint + '?' + new URLSearchParams({ ...query, ...override }),
            a.token,
            undefined,
            400,
          );
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
