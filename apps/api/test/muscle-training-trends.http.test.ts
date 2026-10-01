import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import {
  muscleTrainingTrendsFixture,
  muscleTrendsInput as input,
  expectedMuscleBuckets,
} from './support/in-memory-muscle-training-trends.repository';
import { trainingTrendsFixture } from './support/in-memory-training-trends.repository';
import { exerciseTrainingTrendsFixture } from './support/in-memory-exercise-training-trends.repository';
import { testEnvironment } from './support/test-environment';

const f = muscleTrainingTrendsFixture();
const global = trainingTrendsFixture();
const exercise = exerciseTrainingTrendsFixture();
const endpoint = '/training-trends/muscle-groups/weekly';
let app: INestApplication;
let base: string;
let token: string;
let foreign: string;
let empty: string;
let expired: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(TrainingTrendsRepository)
    .useValue({
      findMuscleGroupWeeklyTrends:
        f.repository.findMuscleGroupWeeklyTrends.bind(f.repository),
      findWeeklyTrends: global.repository.findWeeklyTrends.bind(
        global.repository,
      ),
      findExerciseWeeklyTrends:
        exercise.repository.findExerciseWeeklyTrends.bind(exercise.repository),
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  token = jwt.sign({ sub: f.owner });
  foreign = jwt.sign({ sub: f.other });
  empty = jwt.sign({ sub: randomUUID() });
  expired = jwt.sign({ sub: f.owner }, { expiresIn: -1 });
});
after(async () => {
  await app?.close();
});
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
async function get(
  params = new URLSearchParams(input),
  expected = 200,
  bearer = token,
) {
  const response = await fetch(base + endpoint + '?' + params, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, expected, params.toString());
  assert.equal(response.headers.get('set-cookie'), null);
  const result = object(await response.json());
  for (const field of [
    'userId',
    'passwordHash',
    'Prisma',
    'Decimal',
    'stack',
    'maxLoadKg',
    'maxEstimated1RMKg',
    'secondaryMuscles',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('muscle weekly requires valid Bearer auth and preserves health', async () => {
  for (const bearer of ['', 'invalid', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('muscle weekly HTTP returns primary-only numeric metrics with proper ownership/status/zero-set isolation', async () => {
  assert.deepEqual((await get()).buckets, expectedMuscleBuckets);
  assert.deepEqual((await get(undefined, 200, empty)).buckets, []);
  const other = await get(undefined, 200, foreign);
  assert.ok(Array.isArray(other.buckets));
  assert.deepEqual(object(other.buckets[0]).muscleGroups, [
    {
      muscleGroup: 'CHEST',
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 10,
      totalVolumeKg: 3000,
    },
  ]);
});
void test('static muscle route does not collide with global or exercise weekly routes', async () => {
  const jwt = app.get(JwtService);
  const globalResponse = await fetch(
    base + '/training-trends/weekly?' + new URLSearchParams(input),
    { headers: { authorization: 'Bearer ' + jwt.sign({ sub: global.owner }) } },
  );
  assert.equal(globalResponse.status, 200);
  const g = object(await globalResponse.json());
  assert.ok(Array.isArray(g.buckets));
  assert.equal(object(g.buckets[0]).completedWorkouts, 2);
  assert.equal(object(g.buckets[0]).muscleGroups, undefined);
  const exerciseResponse = await fetch(
    base +
      `/training-trends/exercises/${exercise.exerciseId}/weekly?` +
      new URLSearchParams(input),
    {
      headers: { authorization: 'Bearer ' + jwt.sign({ sub: exercise.owner }) },
    },
  );
  assert.equal(exerciseResponse.status, 200);
  const e = object(await exerciseResponse.json());
  assert.equal(object(e.exercise).sourceExerciseId, exercise.exerciseId);
  assert.deepEqual((await get()).buckets, expectedMuscleBuckets);
});
void test('muscle HTTP reuses required explicit timestamps/timezones and maximum range', async (context) => {
  for (const timezone of ['Europe/Madrid', 'UTC', 'America/New_York'])
    await get(new URLSearchParams({ ...input, timezone }));
  for (const field of ['from', 'to', 'timezone'])
    await context.test('missing/repeated ' + field, async () => {
      const params = new URLSearchParams(input);
      params.delete(field);
      await get(params, 400);
      params.append(field, input[field as keyof typeof input]);
      params.append(field, 'UTC');
      await get(params, 400);
    });
  for (const override of [
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { from: '2026-09-01T00:00:00' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-01T00:00:00.1234Z' },
    { to: '2026-08-01T00:00:00Z' },
    { from: '2023-01-01T00:00:00Z' },
  ])
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
  const result = await get(
    new URLSearchParams({
      ...input,
      from: '2026-09-18T12:00:00+02:00',
      to: '2026-09-18T10:00:00Z',
    }),
  );
  assert.deepEqual(result.buckets, [
    {
      weekStart: '2026-09-14',
      muscleGroups: [expectedMuscleBuckets[0]!.muscleGroups[2]],
    },
  ]);
});
void test('muscle HTTP rejects all unknown selectors, pagination, body fields and write verbs', async (context) => {
  for (const field of [
    'userId',
    'status',
    'muscleGroup',
    'page',
    'limit',
    'q',
    'metric',
    'exerciseId',
    'foo',
  ])
    await context.test(field, async () => {
      await get(new URLSearchParams({ ...input, [field]: 'CHEST' }), 400);
    });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  const body = JSON.stringify({ userId: f.other });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      base + endpoint + '?' + new URLSearchParams(input),
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
  assert.equal(status, 400);
});
void test('muscle HTTP sanitizes persistence errors and does not disguise them as empty success', async (context) => {
  context.mock.method(
    app.get(TrainingTrendsRepository),
    'findMuscleGroupWeeklyTrends',
    async () => {
      throw new TrainingTrendsPersistenceError();
    },
  );
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
