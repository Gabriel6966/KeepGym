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
import { HistoryRepository } from '../../src/history/history.repository';
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
const endpoint = '/history/recent-workouts';
void test('Recent workouts PostgreSQL HTTP: bounded snapshot feed, exact aggregates, ownership and four-read Dashboard composition', async (context) => {
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
      /"(?:passwordHash|stack|Prisma)"/,
    );
    return result;
  }
  async function register() {
    const email = `gym024-${randomUUID()}@example.com`;
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
    name: string,
    start: string,
    duration: number | null,
    sets: { loadKg: string; reps: number }[] = [],
    status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' = 'COMPLETED',
  ) {
    const startedAt = new Date(start);
    const result = await db.workoutSession.create({
      data: {
        userId,
        name,
        startedAt,
        status,
        endedAt:
          duration === null
            ? null
            : new Date(startedAt.getTime() + duration * 1000),
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
                    plannedRepsMin: 5,
                    plannedRepsMax: 10,
                    plannedRestSeconds: 90,
                    sets: {
                      create: sets.map((set, index) => ({
                        ...set,
                        position: index + 1,
                        completedAt: new Date('2030-01-01T00:00:00Z'),
                      })),
                    },
                  },
                ],
        },
      },
    });
    sessionIds.push(result.id);
    return result;
  }
  try {
    await db.$connect();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('/health'), { status: 'ok' });
    const catalogBefore = await db.exercise.count();
    const catalog = await db.exercise.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    assert.equal(catalog.length, 2);
    exercise = catalog[0]!;
    const a = await register(),
      b = await register();
    const recent = (query = '', token = a.token, expected = 200) =>
      request(endpoint + query, token, expected);
    const dashboard = (
      weekStart = '2026-10-05',
      token = a.token,
      expected = 200,
    ) =>
      request(
        '/dashboard/summary?' +
          new URLSearchParams({ weekStart, timezone: 'Europe/Madrid' }),
        token,
        expected,
      );
    const observeRecent = async (query = '') => {
      statements.length = 0;
      const result = await recent(query);
      assert.equal(statements.length, 1);
      assert.match(statements[0]!, /^\s*WITH recent/);
      return result;
    };
    await context.test(
      'empty authenticated feeds and Dashboard remain empty with fixed reads',
      async () => {
        assert.deepEqual(await observeRecent(), { items: [] });
        statements.length = 0;
        const result = await dashboard();
        assert.deepEqual(result.recentWorkouts, []);
        assert.equal(statements.length, 4);
      },
    );
    // Build R1 through the operative HTTP API, then set controlled historical
    // timestamps on this temporary fixture only (no production editing endpoint).
    const template = await request('/workout-templates', a.token, 201, 'POST', {
      name: 'Recent Push',
    });
    const templatePath = '/workout-templates/' + string(template.id);
    for (const entry of catalog)
      await request(templatePath + '/exercises', a.token, 201, 'POST', {
        exerciseId: entry.id,
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 8,
      });
    const started = await request('/workout-sessions', a.token, 201, 'POST', {
      workoutTemplateId: template.id,
    });
    const r1Id = string(started.id);
    sessionIds.push(r1Id);
    for (const entry of rows(started.exercises))
      await request(
        `/workout-sessions/${r1Id}/exercises/${string(entry.id)}/sets`,
        a.token,
        201,
        'POST',
        { loadKg: 80, reps: 8 },
      );
    await request(`/workout-sessions/${r1Id}/complete`, a.token, 200, 'POST');
    const r1 = await db.workoutSession.update({
      where: { id: r1Id, userId: a.id },
      data: {
        startedAt: new Date('2026-10-05T10:00:00Z'),
        endedAt: new Date('2026-10-05T11:00:00.500Z'),
      },
    });
    const r2 = await session(
      a.id,
      'Recent Recovery',
      '2026-10-04T10:00:00Z',
      1800,
    );
    const r3 = await session(
      a.id,
      'Recent Legs',
      '2026-10-03T10:00:00Z',
      2700,
      [
        { loadKg: '100', reps: 5 },
        { loadKg: '100', reps: 5 },
        { loadKg: '0', reps: 10 },
      ],
    );
    const tieA = await session(a.id, 'Tie A', '2026-10-02T10:00:00Z', 1);
    const tieB = await session(a.id, 'Tie B', '2026-10-02T10:00:00Z', 1);
    const zero = await session(
      a.id,
      'Zero duration',
      '2026-10-01T10:00:00Z',
      0,
    );
    await session(
      a.id,
      'Excluded cancelled',
      '2026-10-07T10:00:00Z',
      9000,
      [{ loadKg: '1000', reps: 100 }],
      'CANCELLED',
    );
    await session(
      a.id,
      'Excluded active',
      '2026-10-08T10:00:00Z',
      null,
      [{ loadKg: '1000', reps: 100 }],
      'IN_PROGRESS',
    );
    const foreign = await session(
      b.id,
      'Foreign newest',
      '2026-10-09T10:00:00Z',
      90000,
      [{ loadKg: '1000', reps: 100 }],
    );
    const expectedIds = [
      r1.id,
      r2.id,
      r3.id,
      ...[tieA.id, tieB.id].sort().reverse(),
      zero.id,
    ];
    await context.test(
      'R1/R2/R3 exact historical public metrics, zero sets, bodyweight and duration counted once',
      async () => {
        const result = rows((await observeRecent('?limit=20')).items);
        assert.deepEqual(
          result.map((s) => s.id),
          expectedIds,
        );
        for (const [index, fixture, metrics] of [
          [0, r1, [3600.5, 2, 16, 1280]],
          [1, r2, [1800, 0, 0, 0]],
          [2, r3, [2700, 3, 20, 1000]],
        ] as const) {
          const item = result[index]!;
          assert.deepEqual(item, {
            id: fixture.id,
            name: fixture.name,
            startedAt: fixture.startedAt.toISOString(),
            endedAt: fixture.endedAt!.toISOString(),
            durationSeconds: metrics[0],
            completedSets: metrics[1],
            totalReps: metrics[2],
            totalVolumeKg: metrics[3],
          });
        }
        assert.equal(result.at(-1)!.durationSeconds, 0);
      },
    );
    await context.test(
      'bounded limits, same-startedAt id DESC, ownership and canonical History list ordering',
      async () => {
        for (const [query, limit] of [
          ['', 5],
          ['?limit=1', 1],
          ['?limit=2', 2],
          ['?limit=20', 20],
        ] as const)
          assert.deepEqual(
            rows((await observeRecent(query)).items).map((s) => s.id),
            expectedIds.slice(0, limit),
          );
        assert.deepEqual(
          rows((await recent('', b.token)).items).map((s) => s.id),
          [foreign.id],
        );
        const historical = await request(
          '/history/workouts?status=COMPLETED&limit=20',
          a.token,
        );
        assert.deepEqual(
          rows(historical.items).map((s) => s.id),
          expectedIds,
        );
      },
    );
    await context.test(
      'Dashboard all-time recent five equals History even for future weeks; four fixed domain reads',
      async () => {
        const expected = (await recent('?limit=5')).items;
        for (const week of ['2026-10-05', '2099-01-05']) {
          statements.length = 0;
          const result = await dashboard(week);
          assert.equal(statements.length, 4);
          assert.deepEqual(result.recentWorkouts, expected);
          assert.equal(rows(result.recentWorkouts).length, 5);
          assert.equal(
            rows(result.recentWorkouts).some((s) => s.id === zero.id),
            false,
          );
          if (week === '2099-01-05')
            assert.equal(object(result.week).completedWorkouts, 0);
        }
        assert.deepEqual(
          rows((await dashboard('2026-10-05', b.token)).recentWorkouts).map(
            (s) => s.id,
          ),
          [foreign.id],
        );
      },
    );
    await context.test(
      'template rename/archive/delete and mutable catalog metadata cannot alter recent snapshots',
      async () => {
        const before = await recent('?limit=20');
        await request(templatePath, a.token, 200, 'PATCH', {
          name: 'Mutable renamed template',
        });
        await request(templatePath, a.token, 204, 'DELETE');
        assert.deepEqual(await recent('?limit=20'), before);
        try {
          await db.exercise.update({
            where: { id: exercise.id },
            data: { name: 'Temporary GYM-024 catalog edit', isActive: false },
          });
          assert.deepEqual(await recent('?limit=20'), before);
        } finally {
          await db.exercise.update({
            where: { id: exercise.id },
            data: {
              name: exercise.name,
              isActive: exercise.isActive,
              updatedAt: exercise.updatedAt,
            },
          });
        }
        // This is exclusively our temporary template, never a real user's template.
        await db.workoutTemplate.delete({
          where: { id: string(template.id), userId: a.id },
        });
        assert.deepEqual(await recent('?limit=20'), before);
        assert.equal(
          (await db.workoutSession.findUniqueOrThrow({ where: { id: r1.id } }))
            .sourceTemplateId,
          null,
        );
      },
    );
    await context.test(
      'corrupt recent duration fails History and any Dashboard week, without filtering or leaking SQL',
      async () => {
        const bad = await session(
          a.id,
          'Corrupt temporary duration',
          '2026-10-10T10:00:00Z',
          -1,
        );
        try {
          assert.deepEqual(await recent('', a.token, 500), {
            statusCode: 500,
            message: 'Internal server error',
          });
          assert.deepEqual(await dashboard('2099-01-05', a.token, 500), {
            statusCode: 500,
            message: 'Internal server error',
          });
          assert.equal(rows((await recent('', b.token)).items).length, 1);
          await assert.rejects(
            db.workoutSession.update({
              where: { id: bad.id },
              data: { endedAt: null },
            }),
          );
        } finally {
          await db.workoutSession.delete({
            where: { id: bad.id, userId: a.id },
          });
        }
        assert.equal(rows((await recent()).items).length, 5);
      },
    );
    await context.test(
      'one bounded SELECT and EXPLAIN reuse existing indexes; no mutable joins or new migrations',
      async () => {
        let captured: Prisma.Sql | undefined;
        const reads = await Test.createTestingModule({
          providers: [
            HistoryRepository,
            {
              provide: PrismaService,
              useValue: {
                $queryRaw: (sql: Prisma.Sql) => {
                  captured = sql;
                  return db.$queryRaw(sql);
                },
              },
            },
          ],
        }).compile();
        try {
          for (const limit of [1, 5, 20]) {
            statements.length = 0;
            await reads
              .get(HistoryRepository)
              .findRecentCompletedWorkouts(a.id, limit);
            assert.equal(statements.length, 1);
            assert.doesNotMatch(
              statements[0]!,
              /INSERT|UPDATE|DELETE|JOIN exercises|workout_templates|profiles/i,
            );
          }
          assert.ok(captured);
          const plan = await db.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured}`,
          );
          const root = rows(plan[0]!['QUERY PLAN'])[0]!;
          assert.match(JSON.stringify(root.Plan), /Aggregate/);
          assert.match(JSON.stringify(root.Plan), /Limit/);
          context.diagnostic(
            `Recent History: 1 SELECT; Dashboard: 4. EXPLAIN ${String(root['Execution Time'])} ms; bounded sessions before child aggregation.`,
          );
          const indexes = await db.$queryRaw<
            { indexname: string }[]
          >`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('workout_sessions_user_started_idx', 'workout_sessions_user_status_idx', 'workout_session_exercises_position_key', 'set_entries_exercise_position_key')`;
          assert.equal(indexes.length, 4);
          const migrations = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
          assert.equal(migrations[0]!.count, 8n);
        } finally {
          await reads.close();
        }
      },
    );
    await context.test(
      'real authenticated strict query validation and existing History routes remain read-only',
      async () => {
        await recent('', '', 401);
        for (const query of [
          '?limit=0',
          '?limit=21',
          '?limit=abc',
          '?limit=1.5',
          '?page=1',
          '?status=COMPLETED',
          '?userId=' + b.id,
        ])
          await recent(query, a.token, 400);
        await request(
          '/dashboard/summary?weekStart=2026-10-05&timezone=UTC&recentLimit=1',
          a.token,
          400,
        );
        await request('/history/workouts/' + r1.id, a.token);
        await request('/history/exercises/' + exercise.id, a.token);
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(endpoint, a.token, 404, method);
      },
    );
    assert.equal(await db.exercise.count(), catalogBefore);
    const restored = await db.exercise.findUniqueOrThrow({
      where: { id: exercise.id },
    });
    assert.deepEqual(restored, exercise);
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
