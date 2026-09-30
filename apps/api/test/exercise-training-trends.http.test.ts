import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  exerciseTrainingTrendsFixture,
  exerciseTrendInput as input,
  expectedExerciseBuckets,
} from './support/in-memory-exercise-training-trends.repository';
import { testEnvironment } from './support/test-environment';

const f = exerciseTrainingTrendsFixture();
let app: INestApplication;
let base: string;
let token: string;
let foreign: string;
let expired: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(TrainingTrendsRepository)
    .useValue(f.repository)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  token = jwt.sign({ sub: f.owner });
  foreign = jwt.sign({ sub: f.other });
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
const endpoint = (id: string = f.exerciseId) =>
  `/training-trends/exercises/${id}/weekly`;
async function get(
  params = new URLSearchParams(input),
  expected = 200,
  bearer = token,
  id: string = f.exerciseId,
) {
  const response = await fetch(base + endpoint(id) + '?' + params, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, expected, params.toString());
  assert.equal(response.headers.get('set-cookie'), null);
  const result = object(await response.json());
  for (const field of ['userId', 'passwordHash', 'Prisma', 'Decimal', 'stack'])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('exercise weekly HTTP requires JWT, validates UUID and preserves health', async () => {
  for (const bearer of ['', 'malformed', expired])
    await get(undefined, 401, bearer);
  await get(undefined, 400, token, 'invalid');
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('exercise weekly HTTP returns numeric snapshots/buckets and isolates status, zero sets, exercise and user', async () => {
  const result = await get();
  assert.deepEqual(result.buckets, expectedExerciseBuckets);
  assert.equal(object(result.exercise).name, 'Latest historical bench');
  const other = await get(undefined, 200, foreign);
  assert.ok(Array.isArray(other.buckets));
  assert.equal(object(other.buckets[0]).maxLoadKg, 300);
  const empty = await get(undefined, 200, token, randomUUID());
  assert.equal(empty.exercise, null);
  assert.deepEqual(empty.buckets, []);
  const zero = await get(
    new URLSearchParams({
      ...input,
      from: '2026-09-18T10:00:00Z',
      to: '2026-09-18T10:00:00Z',
    }),
  );
  assert.equal(zero.exercise, null);
  assert.deepEqual(zero.buckets, []);
});
void test('exercise weekly HTTP accepts explicit timezone/range and rejects missing/invalid/repeated query values', async (context) => {
  for (const timezone of ['Europe/Madrid', 'America/New_York', 'UTC'])
    await get(new URLSearchParams({ ...input, timezone }));
  for (const field of ['from', 'to', 'timezone']) {
    await context.test('missing ' + field, async () => {
      const params = new URLSearchParams(input);
      params.delete(field);
      await get(params, 400);
      params.append(field, input[field as keyof typeof input]);
      params.append(field, 'UTC');
      await get(params, 400);
    });
  }
  for (const override of [
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { from: '2026-09-01' },
    { from: '2026-09-01T00:00:00' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-01T00:00:00.1234Z' },
    { to: '2026-08-01T00:00:00Z' },
    { from: '2023-01-01T00:00:00Z' },
  ])
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
});
void test('exercise weekly rejects all undefined query fields and offers no HTTP writes', async (context) => {
  for (const field of [
    'userId',
    'status',
    'metric',
    'page',
    'limit',
    'q',
    'exerciseId',
    'foo',
  ])
    await context.test(field, async () => {
      await get(new URLSearchParams({ ...input, [field]: '1' }), 400);
    });
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const response = await fetch(base + endpoint(), {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
});
void test('exercise weekly persistence failures do not expose internal details or pretend to be empty history', async (context) => {
  context.mock.method(f.repository, 'findExerciseWeeklyTrends', async () => {
    throw new TrainingTrendsPersistenceError();
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
