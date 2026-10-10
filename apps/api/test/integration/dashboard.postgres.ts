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
import { addCalendarDays } from '../../src/common/calendar-date';
import { shiftLocalMonday } from '../../src/common/calendar-week';
import { testEnvironment } from '../support/test-environment';
import {
  dashboardInput as input,
  emptyDashboard,
  expectedDashboardWeek,
} from '../support/dashboard-services';

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
const endpoint = '/dashboard/summary';
type SetFixture = { loadKg: string; reps: number };

void test('Dashboard PostgreSQL HTTP: domain composition, exact selected week, comparison, twelve-week streaks and three fixed reads', async (context) => {
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
  let base: string, exercise: Exercise;
  async function request(
    path: string,
    token?: string,
    method = 'GET',
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
        'Prisma',
        'stack',
        'passwordHash',
        'currentStreak',
        'recommendations',
        'recentWorkouts',
      ])
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym023-${randomUUID()}@example.com`;
    assert.equal(await db.user.count({ where: { email } }), 0);
    emails.push(email);
    const result = await request(
      '/auth/register',
      undefined,
      'POST',
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
    sets: SetFixture[] = [],
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    const row = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-023 temporary dashboard fixture',
        status,
        startedAt,
        endedAt:
          seconds === null
            ? null
            : new Date(startedAt.getTime() + seconds * 1000),
        exercises: {
          create:
            sets.length === 0
              ? []
              : [
                  {
                    position: 1,
                    sourceExerciseId: exercise.id,
                    exerciseName: exercise.name,
                    exerciseSlug: exercise.slug,
                    primaryMuscle: exercise.primaryMuscle,
                    secondaryMuscles: exercise.secondaryMuscles,
                    equipment: exercise.equipment,
                    movementPattern: exercise.movementPattern,
                    plannedSets: 3,
                    plannedRepsMin: 6,
                    plannedRepsMax: 12,
                    plannedRestSeconds: 90,
                    sets: {
                      create: sets.map((set, index) => ({
                        position: index + 1,
                        loadKg: new Prisma.Decimal(set.loadKg),
                        reps: set.reps,
                        completedAt: new Date('2030-01-01T00:00:00Z'),
                      })),
                    },
                  },
                ],
        },
      },
    });
    sessionIds.push(row.id);
    return row;
  }
  const sets = (loadKg: string, reps: number, count = 1) =>
    Array.from({ length: count }, () => ({ loadKg, reps }));
  try {
    await db.$connect();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    exercise = await db.exercise.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    const a = await register(),
      b = await register();
    const summary = (
      override: Partial<typeof input> = {},
      token = a.token,
      expected = 200,
    ) =>
      request(
        endpoint + '?' + new URLSearchParams({ ...input, ...override }),
        token,
        'GET',
        undefined,
        expected,
      );
    const observe = async (
      override: Partial<typeof input> = {},
      token = a.token,
    ) => {
      statements.length = 0;
      const result = await summary(override, token);
      const observed = [...statements];
      assert.equal(observed.length, 3);
      assert.ok(observed.every((sql) => /^\s*WITH\b/i.test(sql)));
      assert.equal(
        observed.filter((sql) => sql.includes('session_activity')).length,
        1,
      );
      assert.equal(
        observed.filter((sql) => sql.includes('local_week')).length,
        1,
      );
      assert.equal(
        observed.filter((sql) => sql.includes('"activeDays"')).length,
        1,
      );
      for (const sql of observed)
        assert.doesNotMatch(
          sql,
          /INSERT|UPDATE|DELETE|JOIN exercises|workout_templates|body_measurements/i,
        );
      return result;
    };
    await context.test(
      'empty/future dashboard uses three existing domain SELECTs with zeros, null average and null baseline percentages',
      async () => {
        assert.deepEqual(await observe(), emptyDashboard());
        const future = { weekStart: '2099-01-05', timezone: 'UTC' };
        assert.deepEqual(await observe(future), emptyDashboard(future));
      },
    );
    await session(a.id, '2026-10-05T08:00:00Z', 2700, sets('80', 8, 2));
    await session(a.id, '2026-10-05T12:00:00Z', 1800);
    await session(a.id, '2026-10-07T08:00:00Z', 3600.5, sets('82.25', 7));
    await session(a.id, '2026-10-10T08:00:00Z', 1200, sets('0', 10));
    for (const date of ['2026-09-28', '2026-09-30', '2026-10-02'])
      await session(a.id, date + 'T10:00:00+02:00', 600, sets('50', 10));
    const windowStart = shiftLocalMonday(input.weekStart, -11);
    assert.equal(windowStart, '2026-07-20');
    // W1 W2 _ W4 W5 W6 _ W8 W9 W10 W11 W12: 10 active, longest/ending 5.
    for (const index of [0, 1, 3, 4, 5, 7, 8, 9])
      await session(
        a.id,
        addCalendarDays(windowStart, index * 7) + 'T10:00:00+02:00',
        60,
      );
    await session(
      a.id,
      '2026-10-08T08:00:00Z',
      900000,
      sets('1000', 100),
      'CANCELLED',
    );
    await session(
      a.id,
      '2026-10-09T08:00:00Z',
      null,
      sets('1000', 100),
      'IN_PROGRESS',
    );
    // Outside both ends of the fixed twelve-week window must not extend streaks.
    await session(
      a.id,
      shiftLocalMonday(windowStart, -1) + 'T10:00:00+02:00',
      60,
    );
    await session(a.id, '2026-10-11T22:00:00Z', 60);
    for (let index = 0; index < 12; index++)
      await session(
        b.id,
        addCalendarDays(windowStart, index * 7) + 'T10:00:00+02:00',
        50000,
        sets('1000', 100, 3),
      );
    await context.test(
      'selected week is 4/4/33/1855.75, active days 3, duration 9300.5 and mean 2325.125; zero-set session counts',
      async () => {
        const result = await observe();
        assert.deepEqual(result.week, expectedDashboardWeek);
        assert.deepEqual(object(result.comparison), {
          previousWeekStart: '2026-09-28',
          completedWorkouts: { previous: 3, delta: 1, percentageChange: 33.33 },
          completedSets: { previous: 3, delta: 1, percentageChange: 33.33 },
          totalReps: { previous: 30, delta: 3, percentageChange: 10 },
          totalVolumeKg: {
            previous: 1500,
            delta: 355.75,
            percentageChange: 23.72,
          },
        });
        const foreign = await observe({}, b.token);
        assert.equal(object(foreign.week).totalVolumeKg, 300000);
        assert.deepEqual((await summary()).week, expectedDashboardWeek);
      },
    );
    await context.test(
      'twelve inclusive weeks are July 20 through October 5 with active 10, longest 5, ending 5; adjacent activity ignored',
      async () => {
        assert.deepEqual((await summary()).consistency, {
          windowWeeks: 12,
          fromWeekStart: '2026-07-20',
          toWeekStart: input.weekStart,
          activeWeeks: 10,
          longestWeeklyStreak: 5,
          endingWeeklyStreak: 5,
        });
        assert.equal(
          object((await summary({}, b.token)).consistency).activeWeeks,
          12,
        );
      },
    );
    await context.test(
      'stable-data dashboard equals original calendar sums, comparison current and consistency, with old routes intact',
      async () => {
        const result = await summary();
        const comparison = await request(
          '/training-trends/weekly-comparison?' + new URLSearchParams(input),
          a.token,
        );
        const current = object(comparison.current),
          week = object(result.week);
        for (const key of [
          'completedWorkouts',
          'completedSets',
          'totalReps',
          'totalVolumeKg',
        ])
          assert.equal(week[key], current[key]);
        const calendar = await request(
          '/training-calendar/days?fromDate=2026-10-05&toDate=2026-10-11&timezone=Europe/Madrid',
          a.token,
        );
        assert.ok(Array.isArray(calendar.days));
        assert.equal(calendar.days.length, 7);
        const consistency = await request(
          '/training-consistency/weekly?fromWeekStart=2026-07-20&toWeekStart=2026-10-05&timezone=Europe/Madrid',
          a.token,
        );
        for (const key of [
          'activeWeeks',
          'longestWeeklyStreak',
          'endingWeeklyStreak',
        ])
          assert.equal(object(result.consistency)[key], consistency[key]);
        const duration = await request(
          '/training-duration/weekly?' +
            new URLSearchParams({
              from: '2026-10-05T00:00:00+02:00',
              to: '2026-10-11T23:59:59.999+02:00',
              timezone: input.timezone,
            }),
          a.token,
        );
        assert.equal(
          object(duration.summary).totalDurationSeconds,
          week.totalDurationSeconds,
        );
        assert.equal(
          object(duration.summary).averageDurationSeconds,
          week.averageDurationSeconds,
        );
      },
    );
    await context.test(
      'zero previous metrics stay null percentage, including 0-to-0 and 0-to-1; current empty retains signed minus 100 percent',
      async () => {
        await session(a.id, '2026-01-12T10:00:00+01:00', 300);
        const result = await observe({ weekStart: '2026-01-12' });
        assert.equal(object(result.week).completedWorkouts, 1);
        assert.equal(object(result.week).averageDurationSeconds, 300);
        assert.deepEqual(object(result.comparison).completedWorkouts, {
          previous: 0,
          delta: 1,
          percentageChange: null,
        });
        for (const key of ['completedSets', 'totalReps', 'totalVolumeKg'])
          assert.deepEqual(object(result.comparison)[key], {
            previous: 0,
            delta: 0,
            percentageChange: null,
          });
        const after = await observe({ weekStart: '2026-01-19' });
        assert.equal(object(after.week).averageDurationSeconds, null);
        assert.deepEqual(object(after.comparison).completedWorkouts, {
          previous: 1,
          delta: -1,
          percentageChange: -100,
        });
        assert.equal(object(after.consistency).endingWeeklyStreak, 0);
      },
    );
    await context.test(
      'composition delegates Madrid DST calendar boundaries to domains rather than UTC-hour arithmetic',
      async () => {
        await session(a.id, '2026-03-29T21:59:59.999Z', 3600, sets('10', 1));
        await session(a.id, '2026-03-29T22:00:00Z', 3600, sets('20', 1));
        const madrid = await observe({ weekStart: '2026-03-30' });
        assert.equal(object(madrid.week).totalVolumeKg, 20);
        assert.equal(
          object(object(madrid.comparison).totalVolumeKg).previous,
          10,
        );
        assert.equal(object(madrid.consistency).endingWeeklyStreak, 2);
        const utc = await observe({ weekStart: '2026-03-30', timezone: 'UTC' });
        assert.equal(object(utc.week).completedWorkouts, 0);
        assert.equal(object(object(utc.comparison).totalVolumeKg).previous, 30);
      },
    );
    await context.test(
      'calendar corruption cannot become a partial dashboard: generic error and healthy unaffected scopes',
      async () => {
        await session(a.id, '2026-12-07T10:00:00Z', -1, sets('80', 8));
        assert.deepEqual(
          await summary({ weekStart: '2026-12-07' }, a.token, 500),
          { statusCode: 500, message: 'Internal server error' },
        );
        assert.deepEqual((await summary()).week, expectedDashboardWeek);
      },
    );
    await context.test(
      'real HTTP validates required Monday/timezone, unknown query and auth, has no write endpoints and leaves future dates valid',
      async () => {
        await summary({}, '', 401);
        for (const key of ['weekStart', 'timezone']) {
          const params = new URLSearchParams(input);
          params.delete(key);
          await request(
            endpoint + '?' + params,
            a.token,
            'GET',
            undefined,
            400,
          );
        }
        const invalid: Record<string, string>[] = [
          { weekStart: '2026-10-06' },
          { weekStart: '2026-02-30' },
          { weekStart: '2026-10-05T00:00:00Z' },
          { timezone: 'GMT+2' },
          { userId: b.id },
        ];
        for (const override of invalid)
          await request(
            endpoint + '?' + new URLSearchParams({ ...input, ...override }),
            a.token,
            'GET',
            undefined,
            400,
          );
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
          await request(endpoint, a.token, method, undefined, 404);
        const future = { weekStart: '2099-01-05', timezone: 'UTC' };
        assert.deepEqual(await observe(future), emptyDashboard(future));
      },
    );
    assert.equal(await db.exercise.count(), catalogBefore);
    context.diagnostic(
      'Dashboard: 3 domain SELECTs per real HTTP request (calendar=1, comparison=1, consistency=1), empty and populated. No Dashboard SQL.',
    );
  } finally {
    try {
      const children = await db.workoutSessionExercise.findMany({
        where: { workoutSessionId: { in: sessionIds } },
        select: { id: true },
      });
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
          where: { id: { in: children.map((c) => c.id) } },
        }),
        0,
      );
      assert.equal(
        await db.setEntry.count({
          where: {
            workoutSessionExerciseId: { in: children.map((c) => c.id) },
          },
        }),
        0,
      );
    } finally {
      await app.close();
      await db.$disconnect();
    }
  }
});
