import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { AnalyticsRepository } from '../../src/analytics/analytics.repository';
import { environmentConfig } from '../../src/config/environment.config';
import { PrismaClient } from '../../src/generated/prisma/client';
import { configureHttp } from '../../src/http/configure-http';
import { PrismaService } from '../../src/prisma/prisma.service';
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

void test('Analytics PostgreSQL HTTP: exact aggregates, ownership, snapshots, candidates and fixed query count', async (context) => {
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
    if (expected === 204) {
      assert.equal(await response.text(), '');
      return {};
    }
    const result = object(await response.json());
    if (path.startsWith('/analytics')) {
      assert.equal(response.headers.get('set-cookie'), null);
      for (const field of [
        'userId',
        'passwordHash',
        'sourceTemplateId',
        'stack',
      ])
        assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
    }
    return result;
  }
  async function register() {
    const email = `gym012-${randomUUID()}@example.com`;
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
  try {
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
    const original = await db.exercise.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    assert.ok(original, 'Run db:seed before test:postgres.');
    const exerciseId = original.id;
    const a = await register();
    const b = await register();
    const overview = '/analytics/overview';
    const endpoint = '/analytics/exercises/' + exerciseId;
    async function template(token: string) {
      const result = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-012 snapshot' },
        201,
      );
      const id = string(result.id);
      await request(
        'POST',
        `/workout-templates/${id}/exercises`,
        token,
        { exerciseId, targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 },
        201,
      );
      return id;
    }
    const templateA = await template(a.token);
    const templateB = await template(b.token);
    async function session(
      templateId: string,
      token: string,
      startedAt: string,
      status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS',
      sets: { loadKg: number; reps: number }[],
    ) {
      const result = await request(
        'POST',
        '/workout-sessions',
        token,
        { workoutTemplateId: templateId },
        201,
      );
      const id = string(result.id);
      sessionIds.push(id);
      const entryId = string(array(result.exercises)[0]?.id);
      await db.workoutSession.update({
        where: { id },
        data: { startedAt: new Date(startedAt) },
      });
      const setIds: string[] = [];
      for (const set of sets) {
        const created = await request(
          'POST',
          `/workout-sessions/${id}/exercises/${entryId}/sets`,
          token,
          { ...set, rpe: 8.5, rir: 2 },
          201,
        );
        setIds.push(string(created.id));
      }
      if (status !== 'IN_PROGRESS')
        await request(
          'POST',
          `/workout-sessions/${id}/${status === 'COMPLETED' ? 'complete' : 'cancel'}`,
          token,
        );
      return { id, entryId, setIds };
    }
    await context.test(
      'empty analytics and running API authentication/validation',
      async () => {
        await request('GET', overview, undefined, undefined, 401);
        await request('GET', endpoint, undefined, undefined, 401);
        assert.deepEqual(await request('GET', overview, a.token), {
          completedWorkouts: 0,
          completedSets: 0,
          totalReps: 0,
          totalVolumeKg: 0,
        });
        const empty = await request('GET', endpoint, a.token);
        assert.equal(empty.exercise, null);
        assert.equal(empty.total, 0);
        assert.deepEqual(empty.performances, []);
        for (const suffix of [
          '?status=COMPLETED',
          '?foo=bar',
          '?from=2026-09-01T00:00:00',
          '?from=2026-02-31T00:00:00Z',
          '?from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z',
        ])
          for (const path of [overview, endpoint])
            await request('GET', path + suffix, a.token, undefined, 400);
        await request(
          'GET',
          '/analytics/exercises/invalid',
          a.token,
          undefined,
          400,
        );
        await request('GET', endpoint + '?page=0', a.token, undefined, 400);
        await request('GET', endpoint + '?limit=101', a.token, undefined, 400);
      },
    );
    const s1 = await session(
      templateA,
      a.token,
      '2026-09-01T10:00:00Z',
      'COMPLETED',
      [
        { loadKg: 80, reps: 8 },
        { loadKg: 80, reps: 8 },
        { loadKg: 82.25, reps: 7 },
      ],
    );
    const s2 = await session(
      templateA,
      a.token,
      '2026-09-02T10:00:00Z',
      'COMPLETED',
      [{ loadKg: 80.5, reps: 10 }],
    );
    await session(templateA, a.token, '2026-09-03T10:00:00Z', 'CANCELLED', [
      { loadKg: 9000, reps: 20 },
    ]);
    await session(templateA, a.token, '2026-09-04T10:00:00Z', 'IN_PROGRESS', [
      { loadKg: 10000, reps: 20 },
    ]);
    await session(templateB, b.token, '2026-09-05T10:00:00Z', 'COMPLETED', [
      { loadKg: 5000, reps: 20 },
    ]);
    const range = new URLSearchParams({
      from: '2026-09-01T12:00:00+02:00',
      to: '2026-09-01T10:00:00Z',
    });
    await context.test(
      'PostgreSQL decimal round-trip and exact expected volume 1855.75 / Epley 101.44',
      async () => {
        assert.equal(
          (
            await db.setEntry.findUniqueOrThrow({ where: { id: s1.setIds[2] } })
          ).loadKg.toString(),
          '82.25',
        );
        assert.deepEqual(
          await request('GET', overview + '?' + range, a.token),
          {
            completedWorkouts: 1,
            completedSets: 3,
            totalReps: 23,
            totalVolumeKg: 1855.75,
          },
        );
        const result = await request('GET', endpoint + '?' + range, a.token);
        assert.deepEqual(result.summary, {
          sessions: 1,
          sets: 3,
          reps: 23,
          totalVolumeKg: 1855.75,
          maxLoadKg: 82.25,
          maxEstimated1RMKg: 101.44,
        });
        assert.equal(object(result.bestEstimated1RMSet).setId, s1.setIds[2]);
        assert.equal(object(result.heaviestSet).setId, s1.setIds[2]);
        const performance = array(result.performances)[0]!;
        assert.deepEqual(
          [performance.setCount, performance.repCount, performance.volumeKg],
          [3, 23, 1855.75],
        );
        assert.deepEqual(
          array(performance.sets).map((set) => [set.position, set.loadKg]),
          [
            [1, 80],
            [2, 80],
            [3, 82.25],
          ],
        );
        assert.equal(array(performance.sets)[2]?.rpe, 8.5);
      },
    );
    await context.test(
      'global summary ignores pagination and excludes cancelled/active/foreign sets',
      async () => {
        assert.deepEqual(await request('GET', overview, a.token), {
          completedWorkouts: 2,
          completedSets: 4,
          totalReps: 33,
          totalVolumeKg: 2660.75,
        });
        const result = await request(
          'GET',
          endpoint + '?page=2&limit=1',
          a.token,
        );
        assert.deepEqual(result.summary, {
          sessions: 2,
          sets: 4,
          reps: 33,
          totalVolumeKg: 2660.75,
          maxLoadKg: 82.25,
          maxEstimated1RMKg: 107.33,
        });
        assert.deepEqual(
          [result.page, result.limit, result.total, result.totalPages],
          [2, 1, 2, 2],
        );
        assert.equal(array(result.performances)[0]?.sessionId, s1.id);
        assert.equal(object(result.bestEstimated1RMSet).sessionId, s2.id);
        assert.equal(object(result.heaviestSet).sessionId, s1.id);
        const latest = await request('GET', endpoint + '?limit=1', a.token);
        assert.equal(array(latest.performances)[0]?.sessionId, s2.id);
        assert.deepEqual(latest.summary, result.summary);
        const beyond = await request('GET', endpoint + '?page=99', a.token);
        assert.deepEqual(beyond.performances, []);
        assert.deepEqual(beyond.summary, result.summary);
        assert.equal(
          object((await request('GET', endpoint, b.token)).summary).maxLoadKg,
          5000,
        );
        await request(
          'GET',
          endpoint + '?userId=' + b.id,
          a.token,
          undefined,
          400,
        );
      },
    );
    await context.test(
      'snapshots survive current catalog/template edits and archive; metadata is independent of page',
      async () => {
        const before = await request('GET', endpoint, a.token);
        try {
          await db.exercise.update({
            where: { id: exerciseId },
            data: {
              name: 'GYM-012 temporary metadata',
              slug: 'gym012-' + randomUUID(),
              primaryMuscle: 'CORE',
              secondaryMuscles: [],
              equipment: 'OTHER',
              movementPattern: 'OTHER',
              isActive: false,
            },
          });
          await request('PATCH', '/workout-templates/' + templateA, a.token, {
            name: 'Changed template',
          });
          assert.deepEqual(await request('GET', endpoint, a.token), before);
          await request(
            'DELETE',
            '/workout-templates/' + templateA,
            a.token,
            undefined,
            204,
          );
          assert.deepEqual(await request('GET', endpoint, a.token), before);
        } finally {
          await db.exercise.update({
            where: { id: exerciseId },
            data: {
              name: original.name,
              slug: original.slug,
              primaryMuscle: original.primaryMuscle,
              secondaryMuscles: original.secondaryMuscles,
              equipment: original.equipment,
              movementPattern: original.movementPattern,
              isActive: original.isActive,
              updatedAt: original.updatedAt,
            },
          });
        }
        // Simulate a distinct historical name only on this test-owned occurrence.
        await db.workoutSessionExercise.update({
          where: { id: s2.entryId },
          data: { exerciseName: 'Later historical name' },
        });
        const page2 = await request(
          'GET',
          endpoint + '?page=2&limit=1',
          a.token,
        );
        assert.equal(object(page2.exercise).name, 'Later historical name');
        assert.equal(
          object(array(page2.performances)[0]?.exercise).name,
          original.name,
        );
        assert.equal(
          object(
            (await request('GET', endpoint + '?' + range, a.token)).exercise,
          ).name,
          original.name,
        );
        assert.deepEqual(
          await db.exercise.findUnique({ where: { id: exerciseId } }),
          original,
        );
      },
    );
    await context.test(
      'actual SQL query count is fixed, read-only and never joins mutable/auth sources',
      async () => {
        const connectionString = process.env.DATABASE_URL;
        assert.ok(connectionString);
        const traced = new PrismaClient({
          adapter: new PrismaPg({ connectionString }),
          log: [{ emit: 'event', level: 'query' }],
        });
        const statements: string[] = [];
        traced.$on('query', (event) => statements.push(event.query));
        const queryModule = await Test.createTestingModule({
          providers: [
            AnalyticsRepository,
            { provide: PrismaService, useValue: traced },
          ],
        }).compile();
        const reads = queryModule.get(AnalyticsRepository);
        try {
          async function queryCount(operation: () => Promise<unknown>) {
            statements.length = 0;
            await operation();
            const selects = statements.filter((sql) =>
              /^\s*SELECT\b/i.test(sql),
            );
            for (const sql of statements) {
              assert.doesNotMatch(
                sql,
                /(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:exercises|users|workout_templates|sessions)"?\s/i,
              );
              assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s/i);
            }
            return selects.length;
          }
          const overviewCount = await queryCount(() =>
            reads.overview(a.id, {}),
          );
          const small = await queryCount(() =>
            reads.exercise(a.id, exerciseId, { page: 1, limit: 1 }),
          );
          const large = await queryCount(() =>
            reads.exercise(a.id, exerciseId, { page: 1, limit: 100 }),
          );
          assert.equal(overviewCount, 1);
          assert.equal(small, large);
          assert.ok(small <= 7 && small > 0);
          context.diagnostic(
            `Analytics SELECT counts: overview=${overviewCount}, exercise=${small}; independent of page size.`,
          );
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
      },
    );
    const templateMore = await template(a.token);
    await context.test(
      'zero-set occurrences count; bodyweight and high reps have no eligible e1RM',
      async () => {
        const empty = await session(
          templateMore,
          a.token,
          '2026-09-10T10:00:00Z',
          'COMPLETED',
          [],
        );
        const day = '?from=2026-09-10T10:00:00Z&to=2026-09-10T10:00:00Z';
        const result = await request('GET', endpoint + day, a.token);
        assert.deepEqual(result.summary, {
          sessions: 1,
          sets: 0,
          reps: 0,
          totalVolumeKg: 0,
          maxLoadKg: null,
          maxEstimated1RMKg: null,
        });
        assert.equal(array(result.performances)[0]?.sessionId, empty.id);
        assert.deepEqual(await request('GET', overview + day, a.token), {
          completedWorkouts: 1,
          completedSets: 0,
          totalReps: 0,
          totalVolumeKg: 0,
        });
        await session(
          templateMore,
          a.token,
          '2026-09-11T10:00:00Z',
          'COMPLETED',
          [
            { loadKg: 0, reps: 10 },
            { loadKg: 10, reps: 21 },
          ],
        );
        const excluded = await request(
          'GET',
          endpoint + '?from=2026-09-11T10:00:00Z',
          a.token,
        );
        assert.equal(object(excluded.summary).maxEstimated1RMKg, null);
        assert.equal(object(excluded.summary).totalVolumeKg, 210);
        assert.equal(excluded.bestEstimated1RMSet, null);
      },
    );
    await context.test(
      'SQL candidates use exact cross-rep Epley, load and deterministic timestamp/UUID ties',
      async () => {
        const tie = await session(
          templateMore,
          a.token,
          '2026-09-12T10:00:00Z',
          'COMPLETED',
          [
            { loadKg: 80, reps: 15 },
            { loadKg: 90, reps: 10 },
            { loadKg: 90, reps: 10 },
          ],
        );
        const timestamp = new Date('2026-09-12T11:00:00Z');
        for (const id of tie.setIds)
          await db.setEntry.update({
            where: { id },
            data: { completedAt: timestamp },
          });
        const result = await request(
          'GET',
          endpoint + '?from=2026-09-12T10:00:00Z',
          a.token,
        );
        const expected = tie.setIds.slice(1).sort().reverse()[0];
        assert.equal(object(result.heaviestSet).setId, expected);
        assert.equal(object(result.bestEstimated1RMSet).setId, expected);
        assert.equal(object(result.bestEstimated1RMSet).estimated1RMKg, 120);
        await db.setEntry.update({
          where: { id: tie.setIds[1] },
          data: { completedAt: new Date(timestamp.getTime() + 1) },
        });
        const later = await request(
          'GET',
          endpoint + '?from=2026-09-12T10:00:00Z',
          a.token,
        );
        assert.equal(object(later.heaviestSet).setId, tie.setIds[1]);
        assert.equal(object(later.bestEstimated1RMSet).setId, tie.setIds[1]);
      },
    );
    await context.test(
      'workout timestamp ties use session UUID; null source identity is not reconstructed by slug',
      async () => {
        await db.workoutSession.update({
          where: { id: s2.id },
          data: { startedAt: new Date('2026-09-01T10:00:00Z') },
        });
        const result = await request('GET', endpoint + '?' + range, a.token);
        assert.deepEqual(
          array(result.performances).map((entry) => entry.sessionId),
          [s1.id, s2.id].sort().reverse(),
        );
        await db.workoutSessionExercise.update({
          where: { id: s1.entryId },
          data: { sourceExerciseId: null },
        });
        const withoutSource = await request(
          'GET',
          endpoint + '?' + range,
          a.token,
        );
        assert.deepEqual(
          array(withoutSource.performances).map((entry) => entry.sessionId),
          [s2.id],
        );
        assert.equal(
          (await request('GET', overview + '?' + range, a.token)).totalVolumeKg,
          2660.75,
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
        await db.user.count({ where: { email: { in: emails } } }),
        0,
      );
      assert.equal(
        await db.workoutSession.count({ where: { id: { in: sessionIds } } }),
        0,
      );
      assert.equal(
        await db.workoutTemplate.count({
          where: { userId: { in: users.map((user) => user.id) } },
        }),
        0,
      );
    } finally {
      await app.close();
    }
  }
});
