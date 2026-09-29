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
import { trainingTrendsFixture } from './support/in-memory-training-trends.repository';
import { testEnvironment } from './support/test-environment';

const f = trainingTrendsFixture();
const endpoint = '/training-trends/weekly';
const input = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-30T23:59:59+02:00',
  timezone: 'Europe/Madrid',
};
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
    .useValue(f.repository)
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
  for (const field of ['userId', 'passwordHash', 'Prisma', 'Decimal', 'stack'])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('weekly trends requires valid access JWTs and preserves health', async () => {
  for (const bearer of ['', 'malformed', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('weekly HTTP returns sparse numeric buckets and isolates cancelled, in-progress and other users', async () => {
  const response = await get();
  assert.deepEqual(response, {
    timezone: input.timezone,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T21:59:59.000Z',
    buckets: [
      {
        weekStart: '2026-09-14',
        completedWorkouts: 2,
        completedSets: 2,
        totalReps: 16,
        totalVolumeKg: 1280,
      },
      {
        weekStart: '2026-09-21',
        completedWorkouts: 1,
        completedSets: 1,
        totalReps: 7,
        totalVolumeKg: 575.75,
      },
    ],
  });
  assert.deepEqual((await get(undefined, 200, empty)).buckets, []);
  const foreignResponse = await get(undefined, 200, foreign);
  assert.ok(Array.isArray(foreignResponse.buckets));
  assert.equal(object(foreignResponse.buckets[0]).totalVolumeKg, 3000);
});
void test('weekly timezone selection is explicit and inclusive range can retain a workout without sets', async () => {
  for (const timezone of ['Europe/Madrid', 'America/New_York', 'UTC'])
    await get(new URLSearchParams({ ...input, timezone }));
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
      completedWorkouts: 1,
      completedSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
    },
  ]);
});
void test('weekly HTTP requires all query fields and rejects invalid IANA/timestamps/ranges', async (context) => {
  for (const field of ['from', 'to', 'timezone'])
    await context.test('missing ' + field, async () => {
      const query = new URLSearchParams(input);
      query.delete(field);
      await get(query, 400);
    });
  for (const override of [
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: ' Europe/Madrid ' },
    { timezone: "UTC'; SELECT 1 --" },
    { from: '' },
    { from: '2026-09-01' },
    { from: '2026-09-01T00:00:00' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-01T24:00:00Z' },
    { from: '2026-09-01T00:00:00.1234Z' },
    { to: '2026-08-01T00:00:00Z' },
    { from: '2023-01-01T00:00:00Z' },
  ])
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
});
void test('weekly HTTP rejects unknown fields, pagination and duplicate query values', async (context) => {
  for (const field of [
    'userId',
    'status',
    'page',
    'limit',
    'metric',
    'exerciseId',
    'q',
    'foo',
  ])
    await context.test(field, async () => {
      await get(new URLSearchParams({ ...input, [field]: '1' }), 400);
    });
  for (const field of ['from', 'to', 'timezone']) {
    const params = new URLSearchParams(input);
    params.append(field, 'UTC');
    await get(params, 400);
  }
});
void test('weekly endpoint has no writes, monthly/exercise routes or body identity selectors', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  for (const path of [
    '/training-trends/monthly',
    '/training-trends/exercises/' + randomUUID(),
  ])
    assert.equal((await fetch(base + path)).status, 404);
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
void test('weekly HTTP does not expose persistence details or return false empty success', async (context) => {
  context.mock.method(f.repository, 'findWeeklyTrends', async () => {
    throw new TrainingTrendsPersistenceError();
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
