import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import {
  analyticsFixture,
  InMemoryAnalyticsRepository,
} from './support/in-memory-analytics.repository';
import { testEnvironment } from './support/test-environment';

const f = analyticsFixture();
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
    .overrideProvider(AnalyticsRepository)
    .useValue(new InMemoryAnalyticsRepository(f.records))
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
async function get(path: string, status = 200, bearer = token) {
  const response = await fetch(base + path, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get('set-cookie'), null);
  const result = object(await response.json());
  for (const field of [
    'userId',
    'passwordHash',
    'sourceTemplateId',
    'stack',
    'PrismaClient',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
const overview = '/analytics/overview';
const exercise = '/analytics/exercises/' + f.exerciseId;
void test('analytics routes require valid Bearer JWTs and do not touch cookies or health', async () => {
  for (const path of [overview, exercise])
    for (const bearer of ['', 'malformed', expired])
      await get(path, 401, bearer);
  assert.deepEqual(await get('/health', 200, ''), { status: 'ok' });
});
void test('overview and exercise HTTP exclude cancelled/in-progress/other owners and return numeric metrics', async () => {
  assert.deepEqual(await get(overview), {
    completedWorkouts: 2,
    completedSets: 4,
    totalReps: 33,
    totalVolumeKg: 2255.75,
  });
  const data = await get(exercise);
  assert.equal(object(data.summary).totalVolumeKg, 2255.75);
  assert.equal(object(data.summary).maxEstimated1RMKg, 101.44);
  assert.equal(object(data.heaviestSet).loadKg, 82.25);
  assert.equal(
    object((await get(exercise, 200, foreign)).summary).maxLoadKg,
    9000,
  );
  assert.ok(Array.isArray(data.performances));
  const sets = object(data.performances[0]).sets;
  assert.ok(Array.isArray(sets));
  assert.deepEqual(
    sets.map((set) => object(set).position),
    [1, 2, 3],
  );
});
void test('empty exercise returns zeros and nulls, invalid UUID returns 400', async () => {
  const result = await get('/analytics/exercises/' + randomUUID());
  assert.equal(result.exercise, null);
  assert.equal(result.total, 0);
  assert.deepEqual(result.performances, []);
  assert.equal(result.heaviestSet, null);
  assert.equal(result.bestEstimated1RMSet, null);
  await get('/analytics/exercises/not-a-uuid', 400);
});
void test('HTTP range is inclusive, explicitly zoned and pagination leaves global summary intact', async () => {
  const range = new URLSearchParams({
    from: '2026-09-20T12:00:00+02:00',
    to: '2026-09-20T10:00:00Z',
  });
  assert.equal((await get(overview + '?' + range)).totalVolumeKg, 1855.75);
  assert.equal(
    object((await get(exercise + '?' + range)).summary).totalVolumeKg,
    1855.75,
  );
  const data = await get(exercise + '?page=2&limit=1');
  assert.deepEqual(
    [data.page, data.limit, data.total, data.totalPages],
    [2, 1, 2, 2],
  );
  assert.equal(object(data.summary).totalVolumeKg, 2255.75);
  assert.ok(Array.isArray(data.performances));
  assert.equal(object(data.performances[0]).sessionId, f.older.session.id);
});
void test('DTOs reject unknown selectors, statuses, impossible/ambiguous dates and invalid pagination', async (context) => {
  for (const query of [
    'foo=bar',
    'status=COMPLETED',
    'status=CANCELLED',
    'status=IN_PROGRESS',
    'userId=' + f.other,
    'q=bench',
    'from=',
    'from=2026-09-01',
    'from=2026-09-01T00:00:00',
    'from=2026-02-31T00:00:00Z',
    'from=2026-09-01T24:00:00Z',
    'from=2026-09-01T00:00:00.1234Z',
    'from=x&from=y',
    'from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z',
  ])
    await context.test(query, async () => {
      await get(overview + '?' + query, 400);
      await get(exercise + '?' + query, 400);
    });
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=01',
    'page=1e2',
    'page=%201%20',
    'page=1&page=2',
    'page=2147483648&limit=100',
    'limit=0',
    'limit=101',
    'limit=2x',
    'limit=',
  ])
    await context.test(query, async () => {
      await get(exercise + '?' + query, 400);
    });
  await get(overview + '?page=1', 400);
  await get(overview + '?limit=20', 400);
});
void test('analytics is read-only and rejects body selectors instead of accepting client identity', async () => {
  for (const path of [overview, exercise])
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal(
        (
          await fetch(base + path, {
            method,
            headers: { authorization: 'Bearer ' + token },
          })
        ).status,
        404,
      );
  const body = JSON.stringify({ userId: f.other });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      base + overview,
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
