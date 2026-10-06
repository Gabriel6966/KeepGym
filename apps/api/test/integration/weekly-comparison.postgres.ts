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
import { normalizeWeeklyComparison } from '../../src/training-trends/training-trends.validation';
import { testEnvironment } from '../support/test-environment';
import {
  comparisonInput as input,
  expectedComparison,
} from '../support/in-memory-weekly-comparison.repository';

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
const endpoint = '/training-trends/weekly-comparison';

void test('Weekly comparison PostgreSQL HTTP: exact two-period metrics, half-open local weeks, DST and one query', async (context) => {
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
    const email = `gym019-${randomUUID()}@example.com`;
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
    const comparison = (
      override: Partial<typeof input> = {},
      token = a.token,
    ) =>
      request(
        'GET',
        endpoint + '?' + new URLSearchParams({ ...input, ...override }),
        token,
      );
    const empty = await comparison();
    for (const period of [empty.previous, empty.current])
      assert.deepEqual(Object.values(object(period)).slice(1), [0, 0, 0, 0]);
    for (const change of Object.values(object(empty.changes)))
      assert.deepEqual(change, { delta: 0, percentageChange: null });

    const catalog = await db.exercise.findMany({
      where: {
        slug: { in: ['barbell-bench-press', 'barbell-row'] },
        isActive: true,
      },
      orderBy: { slug: 'asc' },
    });
    assert.equal(catalog.length, 2, 'Run db:seed before test:postgres.');
    async function template(token: string) {
      const id = string(
        (
          await request(
            'POST',
            '/workout-templates',
            token,
            { name: 'GYM-019 temporary plan' },
            201,
          )
        ).id,
      );
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
        data: { startedAt: new Date(instant) },
      });
      const exercises = array(result.exercises);
      for (const [index, set] of sets.entries())
        await request(
          'POST',
          `/workout-sessions/${id}/exercises/${string(exercises[index % exercises.length]!.id)}/sets`,
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
    await session(a, templateA, '2026-09-21T10:00:00Z', 'COMPLETED', [
      { loadKg: 80, reps: 8 },
      { loadKg: 80, reps: 8 },
    ]);
    await session(a, templateA, '2026-09-23T10:00:00Z', 'COMPLETED');
    await session(a, templateA, '2026-09-28T10:00:00Z', 'COMPLETED', [
      { loadKg: 82.25, reps: 7 },
      { loadKg: 82.25, reps: 7 },
    ]);
    await session(a, templateA, '2026-09-29T10:00:00Z', 'CANCELLED', [
      { loadKg: 200, reps: 10 },
    ]);
    await session(a, templateA, '2026-09-30T10:00:00Z', 'IN_PROGRESS', [
      { loadKg: 250, reps: 10 },
    ]);
    await session(b, templateB, '2026-09-28T10:00:00Z', 'COMPLETED', [
      { loadKg: 300, reps: 10 },
    ]);

    await context.test(
      'previous 2/2/16/1280, current 1/2/14/1151.50 and signed changes exclude foreign/cancelled/active sets',
      async () => {
        assert.deepEqual(await comparison(), expectedComparison);
        const foreign = await comparison({}, b.token);
        assert.equal(object(foreign.current).totalVolumeKg, 3000);
        assert.deepEqual(object(foreign.changes).totalVolumeKg, {
          delta: 3000,
          percentageChange: null,
        });
        // Public JSON values are numbers; exact NUMERIC totals are still strings at the repository boundary.
        const rows = await app
          .get(TrainingTrendsRepository)
          .findWeeklyComparison(a.id, normalizeWeeklyComparison(a.id, input));
        assert.equal(rows[1]?.totalVolumeKg, '1151.50');
      },
    );
    await context.test(
      'zero baselines, zero-current minus 100 percent, zero-set and zero-exercise workouts, bodyweight and future weeks',
      async () => {
        const first = await comparison({ weekStart: '2026-09-21' });
        assert.deepEqual(object(first.changes).completedWorkouts, {
          delta: 2,
          percentageChange: null,
        });
        const next = await comparison({ weekStart: '2026-10-05' });
        assert.deepEqual(object(next.changes).totalVolumeKg, {
          delta: -1151.5,
          percentageChange: -100,
        });
        const zero = await db.workoutSession.create({
          data: {
            userId: a.id,
            name: 'GYM-019 empty historical workout',
            status: 'COMPLETED',
            startedAt: new Date('2026-05-04T10:00:00Z'),
            endedAt: new Date('2026-05-04T11:00:00Z'),
          },
        });
        sessionIds.push(zero.id);
        await session(a, templateA, '2026-05-05T10:00:00Z', 'COMPLETED', [
          { loadKg: 0, reps: 20 },
        ]);
        const bodyweight = await comparison({ weekStart: '2026-05-04' });
        assert.deepEqual(bodyweight.current, {
          weekStart: '2026-05-04',
          completedWorkouts: 2,
          completedSets: 1,
          totalReps: 20,
          totalVolumeKg: 0,
        });
        assert.deepEqual(object(bodyweight.changes).totalVolumeKg, {
          delta: 0,
          percentageChange: null,
        });
        const future = await comparison({ weekStart: '2099-01-05' });
        assert.equal(object(future.current).completedWorkouts, 0);
        assert.equal(object(future.previous).weekStart, '2098-12-29');
      },
    );
    await context.test(
      'same instant is current in Madrid but previous in UTC/New York; boundaries never overlap',
      async () => {
        await session(a, templateA, '2026-07-12T22:00:00Z', 'COMPLETED', [
          { loadKg: 80.5, reps: 1 },
        ]);
        const madrid = await comparison({ weekStart: '2026-07-13' });
        assert.equal(object(madrid.previous).completedWorkouts, 0);
        assert.equal(object(madrid.current).totalVolumeKg, 80.5);
        for (const timezone of ['UTC', 'America/New_York']) {
          const result = await comparison({
            weekStart: '2026-07-13',
            timezone,
          });
          assert.equal(object(result.previous).totalVolumeKg, 80.5);
          assert.equal(object(result.current).completedWorkouts, 0);
        }
      },
    );
    for (const dst of [
      {
        weekStart: '2026-03-23',
        previous: '2026-03-15T23:00:00Z',
        start: '2026-03-22T23:00:00Z',
        end: '2026-03-29T22:00:00Z',
        hours: 167,
      },
      {
        weekStart: '2026-10-19',
        previous: '2026-10-11T22:00:00Z',
        start: '2026-10-18T22:00:00Z',
        end: '2026-10-25T23:00:00Z',
        hours: 169,
      },
    ])
      await context.test(
        `Madrid DST ${dst.hours}-hour week uses three local midnights and exact half-open boundaries`,
        async () => {
          const before = (instant: string) =>
            new Date(new Date(instant).getTime() - 1).toISOString();
          const instants = [
            dst.previous,
            before(dst.start),
            dst.start,
            before(dst.end),
            dst.end,
            before(dst.previous),
          ];
          for (const [index, instant] of instants.entries())
            await session(a, templateA, instant, 'COMPLETED', [
              { loadKg: 2 ** index, reps: 1 },
            ]);
          const result = await comparison({ weekStart: dst.weekStart });
          assert.deepEqual(
            Object.values(object(result.previous)).slice(1),
            [2, 2, 2, 3],
          );
          assert.deepEqual(
            Object.values(object(result.current)).slice(1),
            [2, 2, 2, 12],
          );
          assert.equal(
            (new Date(dst.end).getTime() - new Date(dst.start).getTime()) /
              3600000,
            dst.hours,
          );
          // A current-boundary workout belongs once, and a next-Monday workout is excluded.
          const nextDate = new Date(dst.weekStart + 'T00:00:00Z');
          nextDate.setUTCDate(nextDate.getUTCDate() + 7);
          const next = await comparison({
            weekStart: nextDate.toISOString().slice(0, 10),
          });
          assert.deepEqual(next.previous, result.current);
          assert.equal(object(next.current).totalVolumeKg, 16);
        },
      );
    await context.test(
      'comparison does not depend on PostgreSQL connection timezone',
      async () => {
        const query = normalizeWeeklyComparison(a.id, input);
        const normal = await app
          .get(TrainingTrendsRepository)
          .findWeeklyComparison(a.id, query);
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
                .findWeeklyComparison(a.id, query),
              normal,
            );
          } finally {
            await scoped.close();
          }
        });
      },
    );
    await context.test(
      'all four routes coexist and previous global/exercise/muscle semantics stay unchanged',
      async () => {
        const range = new URLSearchParams({
          from: '2026-09-21T00:00:00+02:00',
          to: '2026-10-04T23:59:59.999+02:00',
          timezone: input.timezone,
        });
        const global = await request(
          'GET',
          '/training-trends/weekly?' + range,
          a.token,
        );
        assert.deepEqual(global.buckets, [
          expectedComparison.previous,
          expectedComparison.current,
        ]);
        const exercise = await request(
          'GET',
          `/training-trends/exercises/${catalog[0]!.id}/weekly?` + range,
          a.token,
        );
        assert.equal(array(exercise.buckets).length, 2);
        const muscles = await request(
          'GET',
          '/training-trends/muscle-groups/weekly?' + range,
          a.token,
        );
        assert.equal(array(muscles.buckets).length, 2);
        assert.deepEqual(await comparison(), expectedComparison);
      },
    );
    await context.test(
      'one real read for populated/empty weeks, safe parameters, sensible EXPLAIN and existing indexes',
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
          for (const userId of [randomUUID(), a.id]) {
            statements.length = 0;
            await reads
              .get(TrainingTrendsRepository)
              .findWeeklyComparison(
                userId,
                normalizeWeeklyComparison(userId, input),
              );
            assert.equal(
              statements.filter((sql) => /^\s*(SELECT|WITH)\b/i.test(sql))
                .length,
              1,
            );
            assert.equal(statements.length, 1);
            assert.doesNotMatch(
              statements[0]!,
              /(?:INSERT|UPDATE|DELETE)\s|(?:FROM|JOIN)\s+(?:exercises|workout_templates|users|profiles)\b/i,
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
            `Weekly comparison: 1 read statement; EXPLAIN ${String(root['Execution Time'])} ms; indexes: ${[...new Set(indexes)].join(', ') || 'small-table scans'}.`,
          );
          const existing = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx', 'workout_session_exercises_position_key', 'set_entries_exercise_position_key')`;
          assert.equal(existing.length, 4);
        } finally {
          await reads.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'real HTTP auth and strict date-only Monday query validation remain read-only',
      async () => {
        await request(
          'GET',
          endpoint + '?' + new URLSearchParams(input),
          undefined,
          undefined,
          401,
        );
        for (const field of ['weekStart', 'timezone']) {
          const query = new URLSearchParams(input);
          query.delete(field);
          await request('GET', endpoint + '?' + query, a.token, undefined, 400);
        }
        const invalid: Record<string, string>[] = [
          { weekStart: '2026-09-29' },
          { weekStart: '2026-02-31' },
          { weekStart: '2026-09-28T00:00:00Z' },
          { timezone: 'Europe/Foo' },
          { from: '2026-09-01T00:00:00Z' },
          { userId: b.id },
        ];
        for (const override of invalid)
          await request(
            'GET',
            endpoint + '?' + new URLSearchParams({ ...input, ...override }),
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
