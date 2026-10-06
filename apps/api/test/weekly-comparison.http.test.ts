import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import { TrainingTrendsRepository } from '../src/training-trends/training-trends.repository';
import { TrainingTrendsPersistenceError } from '../src/training-trends/errors/training-trends-persistence.error';
import { testEnvironment } from './support/test-environment';
import {
  weeklyComparisonFixture,
  comparisonInput as input,
  expectedComparison,
} from './support/in-memory-weekly-comparison.repository';

const f = weeklyComparisonFixture();
const endpoint = '/training-trends/weekly-comparison';
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
      findWeeklyComparison: f.repository.findWeeklyComparison.bind(
        f.repository,
      ),
      findWeeklyTrends: f.repository.findWeeklyTrends.bind(f.repository),
      findMuscleGroupWeeklyTrends: async () => [],
      findExerciseWeeklyTrends: async () => ({
        exercise: null,
        buckets: [],
        estimatedCandidates: [],
      }),
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
    'direction',
    'improved',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('comparison HTTP requires valid bearer auth and preserves health', async () => {
  for (const bearer of ['', 'malformed', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('comparison HTTP reports exact signed changes, isolated completed history and zero periods', async () => {
  assert.deepEqual(await get(), expectedComparison);
  const none = await get(undefined, 200, empty);
  assert.deepEqual(Object.values(object(none.previous)).slice(1), [0, 0, 0, 0]);
  assert.deepEqual(Object.values(object(none.current)).slice(1), [0, 0, 0, 0]);
  for (const change of Object.values(object(none.changes)))
    assert.deepEqual(change, { delta: 0, percentageChange: null });
  const other = await get(undefined, 200, foreign);
  assert.equal(object(other.current).totalVolumeKg, 3000);
  assert.deepEqual(object(other.changes).totalVolumeKg, {
    delta: 3000,
    percentageChange: null,
  });
  const last = await get(
    new URLSearchParams({ ...input, weekStart: '2026-10-05' }),
  );
  assert.deepEqual(object(last.changes).totalVolumeKg, {
    delta: -1151.5,
    percentageChange: -100,
  });
});
void test('comparison HTTP strictly validates both fields and rejects every extra selector', async (context) => {
  for (const field of ['weekStart', 'timezone']) {
    const params = new URLSearchParams(input);
    params.delete(field);
    await get(params, 400);
    const duplicate = new URLSearchParams(input);
    duplicate.append(field, input.timezone);
    await get(duplicate, 400);
  }
  const invalid: Record<string, string>[] = [
    { weekStart: '' },
    { weekStart: '2026-02-31' },
    { weekStart: '2026-09-29' },
    { weekStart: '2026-09-28T00:00:00Z' },
    { weekStart: '2026-9-28' },
    { weekStart: ' 2026-09-28 ' },
    { weekStart: '2025-02-29' },
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: "UTC'; SELECT 1 --" },
    ...['from', 'to', 'page', 'limit', 'status', 'userId', 'metric', 'foo'].map(
      (key) => ({ [key]: '1' }),
    ),
  ];
  for (const override of invalid)
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
  for (const timezone of ['UTC', 'Europe/Madrid', 'America/New_York'])
    await get(new URLSearchParams({ weekStart: '2099-01-05', timezone }));
});
void test('comparison route coexists with global, exercise and muscle weekly routes', async () => {
  const query = new URLSearchParams({
    from: '2026-09-01T00:00:00Z',
    to: '2026-10-01T00:00:00Z',
    timezone: input.timezone,
  });
  for (const path of [
    '/weekly',
    '/muscle-groups/weekly',
    `/exercises/${randomUUID()}/weekly`,
  ]) {
    const response = await fetch(
      base + '/training-trends' + path + '?' + query,
      { headers: { authorization: 'Bearer ' + token } },
    );
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(object(await response.json()).buckets));
  }
});
void test('comparison exposes no writes and rejects body identity selectors', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  const body = JSON.stringify({ userId: f.other });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      base + endpoint + '?' + new URLSearchParams(input),
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(status, 400);
});
void test('comparison HTTP sanitizes persistence failures without reporting false empty success', async (context) => {
  context.mock.method(
    app.get(TrainingTrendsRepository),
    'findWeeklyComparison',
    async () => {
      throw new TrainingTrendsPersistenceError();
    },
  );
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
