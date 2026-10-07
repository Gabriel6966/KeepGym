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
import { TrainingCalendarRepository } from '../../src/training-calendar/training-calendar.repository';
import { normalizeTrainingCalendar } from '../../src/training-calendar/training-calendar.validation';
import { testEnvironment } from '../support/test-environment';
import {
  calendarInput as input,
  expectedCalendar,
  zeroDay,
} from '../support/in-memory-training-calendar.repository';

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
const endpoint = '/training-calendar/days';
type SetFixture = { loadKg: string; reps: number };

void test('Training calendar PostgreSQL HTTP: dense local days, nonmultiplying session aggregates, DST and snapshot integrity', async (context) => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .compile();
  const app = module.createNestApplication({ logger: false }),
    db = app.get(PrismaService);
  const emails: string[] = [],
    sessionIds: string[] = [];
  let base: string, exercises: Exercise[];
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
        'isActive',
        'averageDurationSeconds',
      ])
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym022-${randomUUID()}@example.com`;
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
    groups: SetFixture[][] = [],
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    const result = await db.workoutSession.create({
      data: {
        userId,
        name: 'GYM-022 temporary calendar fixture',
        startedAt,
        status,
        endedAt:
          seconds === null
            ? null
            : new Date(startedAt.getTime() + seconds * 1000),
        exercises: {
          create: groups.map((sets, index) => {
            const exercise = exercises[index % exercises.length]!;
            return {
              position: index + 1,
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
                create: sets.map((set, position) => ({
                  position: position + 1,
                  loadKg: new Prisma.Decimal(set.loadKg),
                  reps: set.reps,
                  completedAt: new Date('2030-01-01T00:00:00Z'),
                })),
              },
            };
          }),
        },
      },
    });
    sessionIds.push(result.id);
    return result;
  }
  const sets = (loadKg: string, reps: number, count = 1) =>
    Array.from({ length: count }, () => ({ loadKg, reps }));
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    exercises = await db.exercise.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    assert.equal(exercises.length, 2);
    const a = await register(),
      b = await register();
    const calendar = (
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
      'empty calendar includes all seven dates and future dates require no current-clock rule',
      async () => {
        assert.deepEqual(await calendar(), {
          ...input,
          days: expectedCalendar.days.map((d) => zeroDay(d.date)),
        });
        assert.deepEqual(
          (await calendar({ fromDate: '2099-01-01', toDate: '2099-01-01' }))
            .days,
          [zeroDay('2099-01-01')],
        );
      },
    );
    await session(a.id, '2026-09-28T08:00:00Z', 2700, [sets('80', 8, 2)]);
    await session(a.id, '2026-09-28T12:00:00Z', 1800);
    await session(a.id, '2026-09-30T08:00:00Z', 3600.5, [sets('82.25', 7)]);
    await session(
      a.id,
      '2026-10-01T08:00:00Z',
      999999,
      [sets('900', 99)],
      'CANCELLED',
    );
    await session(
      a.id,
      '2026-10-02T08:00:00Z',
      null,
      [sets('999', 99)],
      'IN_PROGRESS',
    );
    await session(a.id, '2026-10-03T08:00:00Z', 1200, [sets('0', 10)]);
    for (const start of ['2026-09-28T08:00:00Z', '2026-09-30T08:00:00Z'])
      await session(b.id, start, 900000, [sets('1000', 100)]);
    await context.test(
      'Monday 2/2/16/1280/4500, Wednesday 1/1/7/575.75/3600.5, Saturday bodyweight and four zero days are exact',
      async () => {
        assert.deepEqual(await calendar(), expectedCalendar);
        assert.equal(array((await calendar()).days).length, 7);
        assert.equal(
          array((await calendar({}, b.token)).days)[0]!.totalVolumeKg,
          100000,
        );
        const rows = await app
          .get(TrainingCalendarRepository)
          .findDailyActivity(a.id, normalizeTrainingCalendar(a.id, input));
        assert.deepEqual(
          rows.map((r) => r.date),
          ['2026-09-28', '2026-09-30', '2026-10-03'],
        );
        assert.deepEqual(
          rows.map((r) => r.totalDurationSeconds),
          ['4500.000000', '3600.500000', '1200.000000'],
        );
      },
    );
    await context.test(
      'five sets over two exercises count one workout and one duration; equal-duration sessions must not be collapsed',
      async () => {
        await session(a.id, '2026-06-01T10:00:00Z', 3600.001, [
          sets('80', 8, 3),
          sets('82.25', 7, 2),
        ]);
        const range = { fromDate: '2026-06-01', toDate: '2026-06-01' };
        assert.deepEqual(array((await calendar(range)).days)[0], {
          date: range.fromDate,
          completedWorkouts: 1,
          completedSets: 5,
          totalReps: 38,
          totalVolumeKg: 3071.5,
          totalDurationSeconds: 3600.001,
        });
        await session(a.id, '2026-06-01T12:00:00Z', 3600.001, [[]]);
        const same = array((await calendar(range)).days)[0]!;
        assert.equal(same.completedWorkouts, 2);
        assert.equal(same.completedSets, 5);
        assert.equal(same.totalDurationSeconds, 7200.002);
        const persisted = await db.setEntry.findFirstOrThrow({
          where: {
            workoutSessionExercise: {
              workoutSession: {
                userId: a.id,
                startedAt: new Date('2026-06-01T10:00:00Z'),
              },
            },
            loadKg: new Prisma.Decimal('82.25'),
          },
        });
        assert.equal(persisted.loadKg.toString(), '82.25');
      },
    );
    await context.test(
      'Sunday-to-Monday session and sets completed on a different date remain wholly on start date',
      async () => {
        await session(a.id, '2026-06-14T21:30:00Z', 3600, [sets('80', 8)]);
        const range = { fromDate: '2026-06-14', toDate: '2026-06-15' };
        assert.deepEqual((await calendar(range)).days, [
          {
            date: '2026-06-14',
            completedWorkouts: 1,
            completedSets: 1,
            totalReps: 8,
            totalVolumeKg: 640,
            totalDurationSeconds: 3600,
          },
          zeroDay('2026-06-15'),
        ]);
        await session(a.id, '2026-06-14T22:00:00Z', 0);
        const madrid = array((await calendar(range)).days);
        assert.equal(madrid[1]!.completedWorkouts, 1);
        assert.equal(madrid[1]!.totalDurationSeconds, 0);
        const utc = array((await calendar({ ...range, timezone: 'UTC' })).days);
        assert.equal(utc[0]!.completedWorkouts, 2);
        assert.equal(utc[1]!.completedWorkouts, 0);
      },
    );
    await context.test(
      'local midnight boundaries include first instant and exclude next-day midnight without trimming elapsed duration',
      async () => {
        for (const start of [
          '2026-02-01T22:59:59.999Z',
          '2026-02-01T23:00:00Z',
          '2026-02-02T22:59:59.999Z',
          '2026-02-02T23:00:00Z',
        ])
          await session(a.id, start, 3600, [sets('10', 1)]);
        const one = array(
          (await calendar({ fromDate: '2026-02-02', toDate: '2026-02-02' }))
            .days,
        )[0]!;
        assert.deepEqual(one, {
          date: '2026-02-02',
          completedWorkouts: 2,
          completedSets: 2,
          totalReps: 2,
          totalVolumeKg: 20,
          totalDurationSeconds: 7200,
        });
      },
    );
    for (const dst of [
      {
        fromDate: '2026-03-28',
        toDate: '2026-03-30',
        day: '2026-03-29',
        first: '2026-03-28T23:00:00Z',
        next: '2026-03-29T22:00:00Z',
        crossing: '2026-03-29T00:30:00Z',
        hours: 23,
      },
      {
        fromDate: '2026-10-24',
        toDate: '2026-10-26',
        day: '2026-10-25',
        first: '2026-10-24T22:00:00Z',
        next: '2026-10-25T23:00:00Z',
        crossing: '2026-10-25T00:30:00Z',
        hours: 25,
      },
    ])
      await context.test(
        `DST ${dst.hours}-hour local day: dense date count, independent midnights and real instant duration`,
        async () => {
          const before = new Date(
            new Date(dst.next).getTime() - 1,
          ).toISOString();
          for (const start of [dst.first, before, dst.next, dst.crossing])
            await session(a.id, start, 3600, [sets('10', 1)]);
          const range = { fromDate: dst.fromDate, toDate: dst.toDate };
          const days = array((await calendar(range)).days);
          assert.equal(days.length, 3);
          assert.equal(new Set(days.map((d) => d.date)).size, 3);
          assert.equal(days[0]!.completedWorkouts, 0);
          assert.equal(days[1]!.completedWorkouts, 3);
          assert.equal(days[1]!.totalDurationSeconds, 10800);
          assert.equal(days[2]!.completedWorkouts, 1);
          assert.equal(days[2]!.totalDurationSeconds, 3600);
          const isolated = array(
            (await calendar({ fromDate: dst.day, toDate: dst.day })).days,
          );
          assert.equal(isolated[0]!.completedWorkouts, 3);
          assert.equal(
            (new Date(dst.next).getTime() - new Date(dst.first).getTime()) /
              3600000,
            dst.hours,
          );
          const utc = array(
            (await calendar({ ...range, timezone: 'UTC' })).days,
          );
          assert.equal(utc[0]!.completedWorkouts, 1);
          assert.equal(utc[1]!.completedWorkouts, 3);
        },
      );
    await context.test(
      'negative-duration corruption fails whole read even with sets/positive total; completed null endedAt remains forbidden by DB',
      async () => {
        await session(a.id, '2026-07-06T10:00:00Z', 600, [sets('80', 8, 3)]);
        await session(a.id, '2026-07-06T11:00:00Z', -1, [sets('80', 8, 5)]);
        const range = { fromDate: '2026-07-06', toDate: '2026-07-06' };
        assert.deepEqual(await calendar(range, a.token, 500), {
          statusCode: 500,
          message: 'Internal server error',
        });
        const rows = await app
          .get(TrainingCalendarRepository)
          .findDailyActivity(
            a.id,
            normalizeTrainingCalendar(a.id, { ...input, ...range }),
          );
        assert.equal(rows[0]!.invalidDurationCount, '1');
        assert.equal(rows[0]!.totalDurationSeconds, '599.000000');
        await assert.rejects(session(a.id, '2026-07-06T12:00:00Z', null));
        assert.deepEqual(await calendar(), expectedCalendar);
        assert.deepEqual((await calendar(range, b.token)).days, [
          zeroDay(range.fromDate),
        ]);
      },
    );
    await context.test(
      'session preaggregation and local dates are independent of connection timezone and DateStyle',
      async () => {
        const query = normalizeTrainingCalendar(a.id, input);
        const expected = await app
          .get(TrainingCalendarRepository)
          .findDailyActivity(a.id, query);
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
          await tx.$executeRaw`SET LOCAL DateStyle TO 'SQL, DMY'`;
          const scoped = await Test.createTestingModule({
            providers: [
              TrainingCalendarRepository,
              {
                provide: PrismaService,
                useValue: { $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql) },
              },
            ],
          }).compile();
          try {
            assert.deepEqual(
              await scoped
                .get(TrainingCalendarRepository)
                .findDailyActivity(a.id, query),
              expected,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'one observed read for empty/full 1/366-day ranges; EXPLAIN uses existing relationship indexes',
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
            TrainingCalendarRepository,
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
            for (const range of [
              { fromDate: '2024-01-01', toDate: '2024-12-31' },
              { fromDate: input.fromDate, toDate: input.fromDate },
              input,
            ]) {
              statements.length = 0;
              await reads
                .get(TrainingCalendarRepository)
                .findDailyActivity(
                  userId,
                  normalizeTrainingCalendar(userId, { ...input, ...range }),
                );
              assert.equal(statements.length, 1);
              assert.match(statements[0]!, /^\s*WITH\b/i);
              assert.doesNotMatch(
                statements[0]!,
                /(?:INSERT|UPDATE|DELETE)\s|workout_templates|profiles|JOIN exercises/i,
              );
            }
          assert.ok(captured);
          const plan = await traced.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
          );
          const root = array(plan[0]!['QUERY PLAN'])[0]!;
          assert.match(JSON.stringify(root.Plan), /Aggregate/);
          context.diagnostic(
            `Calendar reads: 1. EXPLAIN ${String(root['Execution Time'])} ms; session preaggregation, no new indexes.`,
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
      'real HTTP strict date query, 366-day limit, ownership and no write routes; existing APIs coexist',
      async () => {
        await calendar({}, '', 401);
        for (const field of ['fromDate', 'toDate', 'timezone']) {
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
          { fromDate: '2026-02-30' },
          { toDate: '2026-10-04T00:00:00Z' },
          { toDate: '2026-09-27' },
          { timezone: 'Europe/Foo' },
          { userId: b.id },
          { fromDate: '2024-01-01', toDate: '2025-01-01' },
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
          array(
            (await calendar({ fromDate: '2024-01-01', toDate: '2024-12-31' }))
              .days,
          ).length,
          366,
        );
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(method, endpoint, a.token, undefined, 404);
        const timed = new URLSearchParams({
          from: '2026-09-28T00:00:00+02:00',
          to: '2026-10-04T23:59:59.999+02:00',
          timezone: input.timezone,
        });
        const duration = await request(
          'GET',
          '/training-duration/weekly?' + timed,
          a.token,
        );
        assert.equal(object(duration.summary).totalDurationSeconds, 9300.5);
        const trends = await request(
          'GET',
          '/training-trends/weekly?' + timed,
          a.token,
        );
        assert.equal(array(trends.buckets)[0]!.completedSets, 4);
        const consistency = await request(
          'GET',
          '/training-consistency/weekly?fromWeekStart=2026-09-28&toWeekStart=2026-09-28&timezone=Europe/Madrid',
          a.token,
        );
        assert.equal(consistency.completedWorkouts, 4);
        assert.equal(consistency.activeDays, 3);
      },
    );
    assert.equal(await db.exercise.count(), catalogBefore);
  } finally {
    try {
      const entries = await db.workoutSessionExercise.findMany({
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
          where: { id: { in: entries.map((e) => e.id) } },
        }),
        0,
      );
      assert.equal(
        await db.setEntry.count({
          where: { workoutSessionExerciseId: { in: entries.map((e) => e.id) } },
        }),
        0,
      );
    } finally {
      await app.close();
    }
  }
});
