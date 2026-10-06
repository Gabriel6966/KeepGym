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
import { TrainingDurationRepository } from '../../src/training-duration/training-duration.repository';
import { normalizeWeeklyTrainingDuration } from '../../src/training-duration/training-duration.validation';
import { testEnvironment } from '../support/test-environment';
import {
  durationInput as input,
  expectedDuration,
} from '../support/in-memory-training-duration.repository';

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
const endpoint = '/training-duration/weekly';

void test('Training duration PostgreSQL HTTP: exact elapsed seconds, weighted averages, corruption defense and local weekly buckets', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false });
  const db = app.get(PrismaService),
    emails: string[] = [],
    sessionIds: string[] = [];
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
    if (path.startsWith(endpoint)) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const key of [
        'userId',
        'passwordHash',
        'Prisma',
        'stack',
        'invalidDurationCount',
      ])
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym021-${randomUUID()}@example.com`;
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
  async function session(
    userId: string,
    start: string,
    seconds: number | null,
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    const result = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-021 temporary duration fixture',
        startedAt,
        status,
        endedAt:
          seconds === null
            ? null
            : new Date(startedAt.getTime() + seconds * 1000),
      },
    });
    sessionIds.push(result.id);
    return result;
  }
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    const a = await register(),
      b = await register();
    const weekly = (
      override: Partial<typeof input> = {},
      token = a.token,
      expected = 200,
    ) =>
      request(
        'GET',
        endpoint + '?' + new URLSearchParams({ ...input, ...override }),
        token,
        undefined,
        expected,
      );
    await context.test(
      'empty history returns null average and no manufactured weeks',
      async () => {
        assert.deepEqual(await weekly(), {
          ...expectedDuration,
          summary: {
            completedWorkouts: 0,
            totalDurationSeconds: 0,
            averageDurationSeconds: null,
          },
          buckets: [],
        });
      },
    );
    for (const [start, seconds] of [
      ['2026-09-07T08:00:00Z', 2700],
      ['2026-09-09T08:00:00Z', 4500],
      ['2026-09-14T08:00:00Z', 3600],
      ['2026-09-28T08:00:00Z', 5430.5],
    ] as const)
      await session(a.id, start, seconds);
    await session(a.id, '2026-09-21T08:00:00Z', 999999, 'CANCELLED');
    await session(a.id, '2026-09-22T08:00:00Z', null, 'IN_PROGRESS');
    await session(b.id, '2026-09-07T08:00:00Z', 900000);
    await context.test(
      'weeks 7200 / 3600 / 5430.5 yield exactly 16230.5 total and 4057.625 average; owner and completed scope hold without sets',
      async () => {
        assert.deepEqual(await weekly(), expectedDuration);
        assert.equal(
          object((await weekly({}, b.token)).summary).totalDurationSeconds,
          900000,
        );
        assert.equal(
          await db.workoutSessionExercise.count({
            where: { workoutSessionId: { in: sessionIds } },
          }),
          0,
        );
        const rows = await app
          .get(TrainingDurationRepository)
          .findWeeklyDurations(
            a.id,
            normalizeWeeklyTrainingDuration(a.id, input),
          );
        assert.deepEqual(
          rows.map((r) => r.totalDurationSeconds),
          ['7200.000000', '3600.000000', '5430.500000'],
        );
        assert.ok(rows.every((r) => r.invalidDurationCount === '0'));
      },
    );
    await context.test(
      'weighted summary is 250, not average-of-weekly-averages 200',
      async () => {
        await session(a.id, '2026-05-04T10:00:00Z', 100);
        for (const day of ['11', '12', '13'])
          await session(a.id, `2026-05-${day}T10:00:00Z`, 300);
        const result = await weekly({
          from: '2026-05-01T00:00:00Z',
          to: '2026-05-20T00:00:00Z',
        });
        assert.deepEqual(result.summary, {
          completedWorkouts: 4,
          totalDurationSeconds: 1000,
          averageDurationSeconds: 250,
        });
        assert.deepEqual(
          array(result.buckets).map((row) => row.averageDurationSeconds),
          [100, 300],
        );
      },
    );
    await context.test(
      'zero duration, fractional milliseconds and durations over 24h are valid; startedAt alone filters full intervals inclusively',
      async () => {
        const zero = await session(a.id, '2026-06-01T10:00:00Z', 0);
        assert.deepEqual(
          (
            await weekly({
              from: zero.startedAt.toISOString(),
              to: zero.startedAt.toISOString(),
            })
          ).summary,
          {
            completedWorkouts: 1,
            totalDurationSeconds: 0,
            averageDurationSeconds: 0,
          },
        );
        const long = await session(a.id, '2026-06-08T10:00:00Z', 172800.001);
        const exact = {
          from: long.startedAt.toISOString(),
          to: long.startedAt.toISOString(),
        };
        assert.equal(
          object((await weekly(exact)).summary).totalDurationSeconds,
          172800.001,
        );
        const outside = await weekly({
          from: '2026-06-08T10:00:00.001Z',
          to: '2026-06-10T10:00:00.001Z',
        });
        assert.equal(object(outside.summary).completedWorkouts, 0);
        const fractions = [
          '2026-06-15T10:00:00.123Z',
          '2026-06-15T11:00:00.456Z',
        ];
        for (const start of fractions) await session(a.id, start, 0.001);
        const tiny = await weekly({ from: fractions[0], to: fractions[1] });
        assert.equal(object(tiny.summary).totalDurationSeconds, 0.002);
        assert.equal(object(tiny.summary).averageDurationSeconds, 0.001);
      },
    );
    await context.test(
      'Sunday 23:30 to Monday 00:30 stays in the start week; exact Monday belongs to next bucket and timezone is explicit',
      async () => {
        await session(a.id, '2026-04-12T21:30:00Z', 3600);
        await session(a.id, '2026-04-12T22:00:00Z', 3600);
        const range = {
          from: '2026-04-12T21:30:00Z',
          to: '2026-04-12T22:00:00Z',
        };
        const madrid = await weekly(range);
        assert.deepEqual(array(madrid.buckets), [
          {
            weekStart: '2026-04-06',
            completedWorkouts: 1,
            totalDurationSeconds: 3600,
            averageDurationSeconds: 3600,
          },
          {
            weekStart: '2026-04-13',
            completedWorkouts: 1,
            totalDurationSeconds: 3600,
            averageDurationSeconds: 3600,
          },
        ]);
        for (const timezone of ['UTC', 'America/New_York']) {
          const shifted = await weekly({ ...range, timezone });
          assert.deepEqual(shifted.summary, madrid.summary);
          assert.deepEqual(array(shifted.buckets), [
            {
              weekStart: '2026-04-06',
              completedWorkouts: 2,
              totalDurationSeconds: 7200,
              averageDurationSeconds: 3600,
            },
          ]);
        }
      },
    );
    for (const dst of [
      {
        start: '2026-03-29T01:30:00+01:00',
        end: '2026-03-29T03:30:00+02:00',
        week: '2026-03-23',
      },
      {
        start: '2026-10-25T02:30:00+02:00',
        end: '2026-10-25T02:30:00+01:00',
        week: '2026-10-19',
      },
    ])
      await context.test(
        `DST ${dst.week}: one real hour, regardless of skipped or repeated local clock hours`,
        async () => {
          const seconds =
            (new Date(dst.end).getTime() - new Date(dst.start).getTime()) /
            1000;
          assert.equal(seconds, 3600);
          await session(a.id, dst.start, seconds);
          const result = await weekly({ from: dst.start, to: dst.start });
          assert.deepEqual(array(result.buckets), [
            {
              weekStart: dst.week,
              completedWorkouts: 1,
              totalDurationSeconds: 3600,
              averageDurationSeconds: 3600,
            },
          ]);
        },
      );
    await context.test(
      'negative durations fail safely even when a positive sum would mask them; DB still forbids completed null endedAt',
      async () => {
        await session(a.id, '2026-07-06T10:00:00Z', 600);
        await session(a.id, '2026-07-06T11:00:00Z', -1);
        const range = {
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-31T00:00:00Z',
        };
        assert.deepEqual(await weekly(range, a.token, 500), {
          statusCode: 500,
          message: 'Internal server error',
        });
        const rows = await app
          .get(TrainingDurationRepository)
          .findWeeklyDurations(
            a.id,
            normalizeWeeklyTrainingDuration(a.id, { ...input, ...range }),
          );
        assert.equal(rows[0]!.invalidDurationCount, '1');
        assert.equal(rows[0]!.totalDurationSeconds, '599.000000');
        await assert.rejects(session(a.id, '2026-07-07T10:00:00Z', null));
        // Corruption outside owner/range must not poison a valid scope.
        assert.deepEqual(await weekly(), expectedDuration);
        assert.equal(
          object((await weekly(range, b.token)).summary).completedWorkouts,
          0,
        );
      },
    );
    await context.test(
      'connection timezone and DateStyle do not change instant subtraction or local bucket dates',
      async () => {
        const query = normalizeWeeklyTrainingDuration(a.id, {
          ...input,
          from: '2026-03-29T00:00:00Z',
          to: '2026-03-29T02:00:00Z',
        });
        const expected = await app
          .get(TrainingDurationRepository)
          .findWeeklyDurations(a.id, query);
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
          await tx.$executeRaw`SET LOCAL DateStyle TO 'SQL, DMY'`;
          const scoped = await Test.createTestingModule({
            providers: [
              TrainingDurationRepository,
              {
                provide: PrismaService,
                useValue: { $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql) },
              },
            ],
          }).compile();
          try {
            assert.deepEqual(
              await scoped
                .get(TrainingDurationRepository)
                .findWeeklyDurations(a.id, query),
              expected,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'one observed SELECT for populated/empty ranges; EXPLAIN needs no new index or child-table reads',
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
            TrainingDurationRepository,
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
          for (const userId of [randomUUID(), a.id]) {
            statements.length = 0;
            await reads
              .get(TrainingDurationRepository)
              .findWeeklyDurations(
                userId,
                normalizeWeeklyTrainingDuration(userId, input),
              );
            assert.equal(statements.length, 1);
            assert.match(statements[0]!, /^\s*SELECT\b/i);
            assert.doesNotMatch(
              statements[0]!,
              /JOIN|(?:INSERT|UPDATE|DELETE)\s|set_entries|workout_session_exercises|workout_templates|profiles/i,
            );
          }
          assert.ok(captured);
          const plan = await traced.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
          );
          const root = array(plan[0]!['QUERY PLAN'])[0]!;
          assert.match(JSON.stringify(root.Plan), /Aggregate/);
          context.diagnostic(
            `Duration reads: 1. EXPLAIN ${String(root['Execution Time'])} ms; session-only aggregation, existing indexes sufficient.`,
          );
          const indexes = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx')`;
          assert.equal(indexes.length, 2);
        } finally {
          await reads.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'real HTTP required fields, range, ownership and read-only routes; complete still sets historical endedAt',
      async () => {
        await weekly({}, '', 401);
        for (const field of ['from', 'to', 'timezone']) {
          const params = new URLSearchParams(input);
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
          { from: '2026-09-07T00:00:00' },
          { timezone: 'Europe/Foo' },
          { from: input.to, to: input.from },
          { userId: b.id },
          { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
        ];
        for (const override of invalid)
          await request(
            'GET',
            endpoint + '?' + new URLSearchParams({ ...input, ...override }),
            a.token,
            undefined,
            400,
          );
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(method, endpoint, a.token, undefined, 404);
        const active = await session(
          a.id,
          '2026-01-05T10:00:00Z',
          null,
          'IN_PROGRESS',
        );
        const completed = await request(
          'POST',
          `/workout-sessions/${active.id}/complete`,
          a.token,
        );
        assert.equal(completed.status, 'COMPLETED');
        assert.equal(typeof completed.endedAt, 'string');
        const persisted = await db.workoutSession.findUniqueOrThrow({
          where: { id: active.id },
        });
        assert.ok(persisted.endedAt);
        const actual = await weekly({
          from: active.startedAt.toISOString(),
          to: active.startedAt.toISOString(),
        });
        assert.equal(
          object(actual.summary).totalDurationSeconds,
          (persisted.endedAt.getTime() - persisted.startedAt.getTime()) / 1000,
        );
        const trends = await request(
          'GET',
          '/training-trends/weekly?' + new URLSearchParams(input),
          a.token,
        );
        assert.equal(array(trends.buckets).length, 3);
        const consistency = await request(
          'GET',
          '/training-consistency/weekly?fromWeekStart=2026-09-07&toWeekStart=2026-09-28&timezone=Europe/Madrid',
          a.token,
        );
        assert.equal(consistency.completedWorkouts, 4);
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
    } finally {
      await app.close();
    }
  }
});
