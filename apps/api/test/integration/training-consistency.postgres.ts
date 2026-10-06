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
import { shiftLocalMonday } from '../../src/common/calendar-week';
import { TrainingConsistencyRepository } from '../../src/training-consistency/training-consistency.repository';
import { normalizeWeeklyConsistency } from '../../src/training-consistency/training-consistency.validation';
import { testEnvironment } from '../support/test-environment';
import {
  consistencyInput as input,
  expectedConsistency,
} from '../support/in-memory-training-consistency.repository';

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
const endpoint = '/training-consistency/weekly';

void test('Training consistency PostgreSQL HTTP: local activity, bounded streaks, half-open DST and single session-only query', async (context) => {
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
    if (path.startsWith('/training-consistency')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const key of [
        'userId',
        'passwordHash',
        'Prisma',
        'stack',
        'currentWeeklyStreak',
        'dailyStreak',
        'score',
      ])
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym020-${randomUUID()}@example.com`;
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
    startedAt: string,
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    // Isolated historical fixtures need no template, exercise or set. startedAt
    // deliberately differs from endedAt/createdAt so queries cannot use those.
    const result = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-020 temporary historical activity',
        startedAt: new Date(startedAt),
        status,
        endedAt:
          status === 'IN_PROGRESS' ? null : new Date('2030-01-01T12:00:00Z'),
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
    const a = await register();
    const b = await register();
    const weekly = (override: Partial<typeof input> = {}, token = a.token) =>
      request(
        'GET',
        endpoint + '?' + new URLSearchParams({ ...input, ...override }),
        token,
      );
    await context.test(
      'empty history returns zeros but retains all six weeks; future ranges are deterministic',
      async () => {
        assert.deepEqual(await weekly(), {
          ...expectedConsistency,
          completedWorkouts: 0,
          activeDays: 0,
          activeWeeks: 0,
          longestWeeklyStreak: 0,
          endingWeeklyStreak: 0,
        });
        assert.equal(
          (
            await weekly({
              fromWeekStart: '2099-01-05',
              toWeekStart: '2099-01-05',
            })
          ).totalWeeks,
          1,
        );
      },
    );
    for (const instant of [
      '2026-08-24T08:00:00Z',
      '2026-08-24T16:00:00Z',
      '2026-08-26T10:00:00Z',
      '2026-09-01T10:00:00Z',
      '2026-09-14T10:00:00Z',
      '2026-09-23T10:00:00Z',
      '2026-10-02T10:00:00Z',
    ])
      await session(a.id, instant);
    await session(a.id, '2026-09-08T10:00:00Z', 'CANCELLED');
    await session(a.id, '2026-09-09T10:00:00Z', 'IN_PROGRESS');
    for (let week = 0; week < 6; week++)
      for (const hour of ['08', '12', '16'])
        await session(
          b.id,
          shiftLocalMonday(input.fromWeekStart, week) + `T${hour}:00:00Z`,
        );

    await context.test(
      'expected 7 workouts / 6 days / 5 active weeks / longest 3 / ending 3 ignores foreign and non-completed sessions',
      async () => {
        assert.deepEqual(await weekly(), expectedConsistency);
        const other = await weekly({}, b.token);
        assert.equal(other.completedWorkouts, 18);
        assert.equal(other.activeDays, 6);
        assert.equal(other.activeWeeks, 6);
        assert.equal(other.longestWeeklyStreak, 6);
        assert.equal(
          await db.workoutSessionExercise.count({
            where: { workoutSessionId: { in: sessionIds } },
          }),
          0,
        );
        const rows = await app
          .get(TrainingConsistencyRepository)
          .findWeeklyActivity(a.id, normalizeWeeklyConsistency(a.id, input));
        assert.deepEqual(rows, [
          { weekStart: '2026-08-24', completedWorkouts: '3', activeDays: '2' },
          ...['2026-08-31', '2026-09-14', '2026-09-21', '2026-09-28'].map(
            (weekStart) => ({
              weekStart,
              completedWorkouts: '1',
              activeDays: '1',
            }),
          ),
        ]);
      },
    );
    await context.test(
      'W3 ends inactive with ending zero and longest two; clipping W5-W6 does not include preceding activity',
      async () => {
        const gap = await weekly({ toWeekStart: '2026-09-07' });
        assert.equal(gap.totalWeeks, 3);
        assert.equal(gap.longestWeeklyStreak, 2);
        assert.equal(gap.endingWeeklyStreak, 0);
        const clipped = await weekly({ fromWeekStart: '2026-09-21' });
        assert.equal(clipped.completedWorkouts, 2);
        assert.equal(clipped.activeDays, 2);
        assert.equal(clipped.longestWeeklyStreak, 2);
        assert.equal(clipped.endingWeeklyStreak, 2);
        const zeroSets = await weekly({
          fromWeekStart: '2026-08-31',
          toWeekStart: '2026-08-31',
        });
        assert.equal(zeroSets.completedWorkouts, 1);
        assert.equal(zeroSets.activeDays, 1);
        assert.equal(zeroSets.endingWeeklyStreak, 1);
      },
    );
    await context.test(
      'two UTC dates can be one Madrid day and one UTC date can be two Madrid days',
      async () => {
        // Both are Tuesday in Madrid, but Monday/Tuesday in UTC.
        for (const instant of ['2026-06-01T22:30:00Z', '2026-06-02T00:30:00Z'])
          await session(a.id, instant);
        const range = {
          fromWeekStart: '2026-06-01',
          toWeekStart: '2026-06-01',
        };
        const madrid = await weekly(range);
        const utc = await weekly({ ...range, timezone: 'UTC' });
        assert.equal(madrid.completedWorkouts, 2);
        assert.equal(madrid.activeDays, 1);
        assert.equal(utc.activeDays, 2);
        // Both UTC Tuesday, Madrid Tuesday/Wednesday.
        for (const instant of ['2026-06-09T21:30:00Z', '2026-06-09T22:30:00Z'])
          await session(a.id, instant);
        const next = { fromWeekStart: '2026-06-08', toWeekStart: '2026-06-08' };
        assert.equal((await weekly(next)).activeDays, 2);
        assert.equal(
          (await weekly({ ...next, timezone: 'UTC' })).activeDays,
          1,
        );
        // Three days in one week remain one active week.
        for (const instant of [
          '2026-06-15T10:00:00Z',
          '2026-06-17T10:00:00Z',
          '2026-06-19T10:00:00Z',
        ])
          await session(a.id, instant);
        const three = await weekly({
          fromWeekStart: '2026-06-15',
          toWeekStart: '2026-06-15',
        });
        assert.equal(three.completedWorkouts, 3);
        assert.equal(three.activeDays, 3);
        assert.equal(three.activeWeeks, 1);
      },
    );
    for (const dst of [
      {
        fromWeekStart: '2026-03-16',
        toWeekStart: '2026-03-23',
        first: '2026-03-15T23:00:00Z',
        second: '2026-03-22T23:00:00Z',
        end: '2026-03-29T22:00:00Z',
        hours: 167,
      },
      {
        fromWeekStart: '2026-10-12',
        toWeekStart: '2026-10-19',
        first: '2026-10-11T22:00:00Z',
        second: '2026-10-18T22:00:00Z',
        end: '2026-10-25T23:00:00Z',
        hours: 169,
      },
    ])
      await context.test(
        `Madrid DST ${dst.hours}h preserves consecutive calendar weeks, local days and exclusive next Monday`,
        async () => {
          const before = (instant: string) =>
            new Date(new Date(instant).getTime() - 1).toISOString();
          for (const instant of [
            before(dst.first),
            dst.first,
            dst.second,
            before(dst.end),
            dst.end,
          ])
            await session(a.id, instant);
          const range = {
            fromWeekStart: dst.fromWeekStart,
            toWeekStart: dst.toWeekStart,
          };
          const result = await weekly(range);
          assert.deepEqual(result, {
            timezone: input.timezone,
            ...range,
            totalWeeks: 2,
            completedWorkouts: 3,
            activeDays: 3,
            activeWeeks: 2,
            longestWeeklyStreak: 2,
            endingWeeklyStreak: 2,
          });
          const rows = await app
            .get(TrainingConsistencyRepository)
            .findWeeklyActivity(
              a.id,
              normalizeWeeklyConsistency(a.id, { ...input, ...range }),
            );
          assert.deepEqual(
            rows.map((row) => row.weekStart),
            [dst.fromWeekStart, dst.toWeekStart],
          );
          const next = shiftLocalMonday(dst.toWeekStart, 1);
          assert.equal(
            (await weekly({ fromWeekStart: next, toWeekStart: next }))
              .completedWorkouts,
            1,
          );
          assert.equal(
            (new Date(dst.end).getTime() - new Date(dst.second).getTime()) /
              3600000,
            dst.hours,
          );
          // The exact first Madrid Monday is still Sunday in UTC/New York.
          for (const timezone of ['UTC', 'America/New_York']) {
            const different = await weekly({ ...range, timezone });
            assert.equal(different.activeWeeks, 2);
            assert.equal(different.endingWeeklyStreak, 2);
          }
        },
      );
    await context.test(
      'query results are independent of connection timezone and DateStyle',
      async () => {
        const query = normalizeWeeklyConsistency(a.id, input);
        const expected = await app
          .get(TrainingConsistencyRepository)
          .findWeeklyActivity(a.id, query);
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
          await tx.$executeRaw`SET LOCAL DateStyle TO 'SQL, DMY'`;
          const scoped = await Test.createTestingModule({
            providers: [
              TrainingConsistencyRepository,
              {
                provide: PrismaService,
                useValue: { $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql) },
              },
            ],
          }).compile();
          try {
            assert.deepEqual(
              await scoped
                .get(TrainingConsistencyRepository)
                .findWeeklyActivity(a.id, query),
              expected,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'one observed read uses only WorkoutSession with existing user/time and user/status indexes available',
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
            TrainingConsistencyRepository,
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
            for (const toWeekStart of [
              input.toWeekStart,
              shiftLocalMonday(input.fromWeekStart, 103),
            ]) {
              statements.length = 0;
              await reads
                .get(TrainingConsistencyRepository)
                .findWeeklyActivity(
                  userId,
                  normalizeWeeklyConsistency(userId, { ...input, toWeekStart }),
                );
              assert.equal(statements.length, 1);
              assert.match(statements[0]!, /^\s*WITH\b/i);
              assert.doesNotMatch(
                statements[0]!,
                /(?:INSERT|UPDATE|DELETE)\s|set_entries|workout_session_exercises|workout_templates|profiles|users/i,
              );
            }
          assert.ok(captured);
          const plan = await traced.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
          );
          const root = array(plan[0]!['QUERY PLAN'])[0]!;
          const text = JSON.stringify(root.Plan);
          assert.match(text, /Aggregate/);
          const indexes = [...text.matchAll(/"Index Name":"([^"]+)"/g)].map(
            (match) => match[1],
          );
          context.diagnostic(
            `Consistency reads: 1. EXPLAIN ${String(root['Execution Time'])} ms; indexes: ${[...new Set(indexes)].join(', ') || 'small-table scan'}.`,
          );
          const existing = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx')`;
          assert.equal(existing.length, 2);
        } finally {
          await reads.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'real HTTP validates auth, required queries, max 104 inclusive weeks and read-only contract',
      async () => {
        await request(
          'GET',
          endpoint + '?' + new URLSearchParams(input),
          undefined,
          undefined,
          401,
        );
        for (const field of ['fromWeekStart', 'toWeekStart', 'timezone']) {
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
          { fromWeekStart: '2026-08-25' },
          { toWeekStart: '2026-09-29' },
          { fromWeekStart: '2026-02-30' },
          { toWeekStart: '2026-09-28T00:00:00Z' },
          { fromWeekStart: '2026-10-05' },
          { timezone: 'Europe/Foo' },
          { userId: b.id },
          { status: 'COMPLETED' },
          { toWeekStart: shiftLocalMonday(input.fromWeekStart, 104) },
        ];
        for (const override of invalid)
          await request(
            'GET',
            endpoint + '?' + new URLSearchParams({ ...input, ...override }),
            a.token,
            undefined,
            400,
          );
        assert.equal(
          (
            await weekly({
              toWeekStart: shiftLocalMonday(input.fromWeekStart, 103),
            })
          ).totalWeeks,
          104,
        );
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(method, endpoint, a.token, undefined, 404);
        // Calendar extraction must not change existing weekly comparison/trends contracts.
        const comparison = await request(
          'GET',
          '/training-trends/weekly-comparison?weekStart=2026-09-28&timezone=Europe/Madrid',
          a.token,
        );
        assert.equal(object(comparison.current).completedWorkouts, 1);
        assert.equal(object(comparison.previous).completedWorkouts, 1);
        const trends = await request(
          'GET',
          '/training-trends/weekly?' +
            new URLSearchParams({
              from: '2026-08-24T00:00:00+02:00',
              to: '2026-10-04T23:59:59+02:00',
              timezone: input.timezone,
            }),
          a.token,
        );
        assert.equal(array(trends.buckets).length, 5);
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
