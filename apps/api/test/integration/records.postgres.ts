import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { RecordsRepository } from '../../src/records/records.repository';
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

void test('Records PostgreSQL HTTP: first all-time achievements, snapshots, isolation and bounded queries', async (context) => {
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
    if (path.startsWith('/records')) {
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
    const email = `gym013-${randomUUID()}@example.com`;
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
    const original = await db.exercise.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    assert.ok(original, 'Run db:seed before test:postgres.');
    const exerciseId = original.id;
    const endpoint = '/records/exercises/' + exerciseId;
    const a = await register();
    const b = await register();
    async function template(token: string) {
      const result = await request(
        'POST',
        '/workout-templates',
        token,
        { name: 'GYM-013 snapshot' },
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
      day: number,
      status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS',
      pairs: [number, number][],
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
      const startedAt = new Date(Date.UTC(2026, 8, day, 10));
      await db.workoutSession.update({ where: { id }, data: { startedAt } });
      const setIds: string[] = [];
      const completedDates: Date[] = [];
      for (const [loadKg, reps] of pairs) {
        const set = await request(
          'POST',
          `/workout-sessions/${id}/exercises/${entryId}/sets`,
          token,
          { loadKg, reps, rpe: 8.5, rir: 2 },
          201,
        );
        const setId = string(set.id);
        const completedAt = new Date(
          startedAt.getTime() + (setIds.length + 1) * 60000,
        );
        await db.setEntry.update({
          where: { id: setId },
          data: { completedAt },
        });
        setIds.push(setId);
        completedDates.push(completedAt);
      }
      if (status !== 'IN_PROGRESS')
        await request(
          'POST',
          `/workout-sessions/${id}/${status === 'COMPLETED' ? 'complete' : 'cancel'}`,
          token,
        );
      return { id, entryId, setIds, completedDates };
    }
    await context.test(
      'authentication, UUID and no-query validation; empty UUID returns null records',
      async () => {
        await request('GET', endpoint, undefined, undefined, 401);
        await request(
          'GET',
          '/records/exercises/invalid',
          a.token,
          undefined,
          400,
        );
        assert.deepEqual(await request('GET', endpoint, a.token), {
          exercise: null,
          maxLoadRecord: null,
          estimated1RMRecord: null,
        });
        assert.deepEqual(
          await request('GET', '/records/exercises/' + randomUUID(), a.token),
          { exercise: null, maxLoadRecord: null, estimated1RMRecord: null },
        );
        for (const query of [
          'from=2026-09-01T00:00:00Z',
          'to=2026-09-30T00:00:00Z',
          'page=1',
          'status=COMPLETED',
          'userId=' + b.id,
          'foo=bar',
        ])
          await request('GET', endpoint + '?' + query, a.token, undefined, 400);
        for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
          await request(method, endpoint, a.token, undefined, 404);
      },
    );
    const s1 = await session(templateA, a.token, 1, 'COMPLETED', [
      [80, 8],
      [100, 3],
    ]);
    const s2 = await session(templateA, a.token, 2, 'COMPLETED', [[95, 6]]);
    const s3 = await session(templateA, a.token, 10, 'COMPLETED', [[100, 5]]);
    await session(templateA, a.token, 11, 'CANCELLED', [[150, 3]]);
    await session(templateA, a.token, 12, 'IN_PROGRESS', [[160, 1]]);
    await session(templateB, b.token, 13, 'COMPLETED', [[200, 1]]);
    await context.test(
      '100 x 3 establishes MAX_LOAD before 100 x 5; cancelled, active and foreign highs are excluded',
      async () => {
        const data = await request('GET', endpoint, a.token);
        const max = object(data.maxLoadRecord);
        assert.equal(max.type, 'MAX_LOAD');
        assert.equal(max.valueKg, 100);
        assert.equal(object(max.session).id, s1.id);
        assert.equal(object(max.set).id, s1.setIds[1]);
        assert.equal(object(max.set).reps, 3);
        assert.equal(max.achievedAt, s1.completedDates[1]?.toISOString());
        assert.equal(max.achievedAt, object(max.set).completedAt);
        const e1rm = object(data.estimated1RMRecord);
        assert.equal(e1rm.valueKg, 116.67);
        assert.equal(object(e1rm.session).id, s3.id);
        assert.equal(
          object((await request('GET', endpoint, b.token)).maxLoadRecord)
            .valueKg,
          200,
        );
        // Analytics retains its different later/higher-rep holder semantics.
        const analytics = await request(
          'GET',
          '/analytics/exercises/' + exerciseId,
          a.token,
        );
        assert.equal(object(analytics.heaviestSet).setId, s3.setIds[0]);
      },
    );
    await context.test(
      'live exercise edits and template rename/archive cannot alter record snapshots',
      async () => {
        const before = await request('GET', endpoint, a.token);
        try {
          await db.exercise.update({
            where: { id: exerciseId },
            data: {
              name: 'GYM-013 temporary',
              slug: 'gym013-' + randomUUID(),
              primaryMuscle: 'CORE',
              secondaryMuscles: [],
              equipment: 'OTHER',
              movementPattern: 'OTHER',
              isActive: false,
            },
          });
          await request('PATCH', '/workout-templates/' + templateA, a.token, {
            name: 'Changed planning',
          });
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
        assert.deepEqual(
          await db.exercise.findUnique({ where: { id: exerciseId } }),
          original,
        );
        // The representative snapshot can differ from the record holder's date.
        await db.workoutSessionExercise.update({
          where: { id: s3.entryId },
          data: { exerciseName: 'Later historical snapshot' },
        });
        const result = await request('GET', endpoint, a.token);
        assert.equal(object(result.exercise).name, 'Later historical snapshot');
        assert.equal(object(object(result.maxLoadRecord).session).id, s1.id);
      },
    );
    await context.test(
      'exact Epley ties keep the earliest achievement across and within rep counts',
      async () => {
        // Test-owned fixtures: 80x15 and 90x10 both yield exactly 120.
        await db.setEntry.update({
          where: { id: s1.setIds[0] },
          data: { loadKg: 80, reps: 15 },
        });
        await db.setEntry.update({
          where: { id: s2.setIds[0] },
          data: { loadKg: 90, reps: 10 },
        });
        await db.setEntry.update({
          where: { id: s3.setIds[0] },
          data: { loadKg: 80, reps: 15 },
        });
        let result = await request('GET', endpoint, a.token);
        assert.equal(object(result.estimated1RMRecord).valueKg, 120);
        assert.equal(
          object(object(result.estimated1RMRecord).set).id,
          s1.setIds[0],
        );
        assert.equal(
          object(result.estimated1RMRecord).achievedAt,
          s1.completedDates[0]?.toISOString(),
        );
        const time = new Date('2026-09-15T10:00:00Z');
        for (const id of [s1.setIds[0]!, s2.setIds[0]!, s3.setIds[0]!])
          await db.setEntry.update({
            where: { id },
            data: { completedAt: time },
          });
        result = await request('GET', endpoint, a.token);
        assert.equal(
          object(object(result.estimated1RMRecord).set).id,
          [s1.setIds[0]!, s2.setIds[0]!, s3.setIds[0]!].sort()[0],
        );
        // Same timestamp MAX_LOAD ties also use ascending UUID, never reps.
        for (const id of [s1.setIds[1]!, s3.setIds[0]!])
          await db.setEntry.update({
            where: { id },
            data: { loadKg: 100, completedAt: time },
          });
        result = await request('GET', endpoint, a.token);
        assert.equal(
          object(object(result.maxLoadRecord).set).id,
          [s1.setIds[1]!, s3.setIds[0]!].sort()[0],
        );
      },
    );
    await context.test(
      'read query count is fixed at three, returns at most 20 candidates, never joins mutable sources',
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
            RecordsRepository,
            { provide: PrismaService, useValue: traced },
          ],
        }).compile();
        try {
          const reads = queryModule.get(RecordsRepository);
          for (const id of [exerciseId, randomUUID()]) {
            statements.length = 0;
            const data = await reads.findExerciseRecordData(a.id, id);
            assert.ok(data.estimatedCandidates.length <= 20);
            assert.equal(
              statements.filter((sql) => /^\s*SELECT\b/i.test(sql)).length,
              3,
            );
            for (const sql of statements) {
              assert.doesNotMatch(
                sql,
                /(?:FROM|JOIN)\s+(?:"public"\.)?"?(?:exercises|users|workout_templates|sessions)"?\s/i,
              );
              assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s/i);
            }
          }
          context.diagnostic(
            'Records SQL SELECT count: 3 for populated and empty history; at most 20 Epley candidates.',
          );
        } finally {
          await queryModule.close();
          await traced.$disconnect();
        }
      },
    );
    await context.test(
      'zero-load sets yield no record, >20 reps only MAX_LOAD, Decimal Epley returns 101.44',
      async () => {
        const ids = [...s1.setIds, ...s2.setIds, ...s3.setIds];
        for (const id of ids)
          await db.setEntry.update({ where: { id }, data: { loadKg: 0 } });
        let result = await request('GET', endpoint, a.token);
        assert.ok(result.exercise);
        assert.equal(result.maxLoadRecord, null);
        assert.equal(result.estimated1RMRecord, null);
        await db.setEntry.update({
          where: { id: s1.setIds[0] },
          data: { loadKg: '82.25', reps: 21 },
        });
        result = await request('GET', endpoint, a.token);
        assert.equal(object(result.maxLoadRecord).valueKg, 82.25);
        assert.equal(result.estimated1RMRecord, null);
        await db.setEntry.update({
          where: { id: s1.setIds[0] },
          data: { reps: 7 },
        });
        result = await request('GET', endpoint, a.token);
        assert.equal(object(result.estimated1RMRecord).valueKg, 101.44);
        assert.equal(
          object(object(result.estimated1RMRecord).set).loadKg,
          82.25,
        );
        assert.equal(
          (
            await db.setEntry.findUniqueOrThrow({ where: { id: s1.setIds[0] } })
          ).loadKg.toString(),
          '82.25',
        );
      },
    );
    await context.test(
      'sourceExerciseId null is not reconstructed via slug; other snapshots remain readable',
      async () => {
        await db.workoutSessionExercise.update({
          where: { id: s1.entryId },
          data: { sourceExerciseId: null },
        });
        const result = await request('GET', endpoint, a.token);
        assert.equal(result.maxLoadRecord, null);
        assert.equal(result.estimated1RMRecord, null);
        const detail = await request(
          'GET',
          '/history/workouts/' + s1.id,
          a.token,
        );
        assert.equal(
          object(array(detail.exercises)[0]?.exercise).sourceExerciseId,
          null,
        );
        assert.equal(
          object(array(detail.exercises)[0]?.exercise).name,
          original.name,
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
