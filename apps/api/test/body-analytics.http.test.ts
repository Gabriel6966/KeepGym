import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { BodyAnalyticsRepository } from '../src/body-analytics/body-analytics.repository';
import { bodyMetrics } from '../src/body-analytics/body-analytics.types';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import {
  InMemoryBodyAnalyticsRepository,
  seedBodyAnalytics,
} from './support/in-memory-body-analytics.repository';
import { testEnvironment } from './support/test-environment';

const repository = new InMemoryBodyAnalyticsRepository();
const owner = randomUUID();
const other = randomUUID();
seedBodyAnalytics(repository, owner);
const foreignRows = seedBodyAnalytics(repository, other);
foreignRows[3]!.weightKg = foreignRows[0]!.weightKg;
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
    .overrideProvider(BodyAnalyticsRepository)
    .useValue(repository)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  token = jwt.sign({ sub: owner });
  foreign = jwt.sign({ sub: other });
  empty = jwt.sign({ sub: randomUUID() });
  expired = jwt.sign({ sub: owner }, { expiresIn: -1 });
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
    'stack',
    'Prisma',
    'Decimal',
    'notes',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
const overview = '/body-analytics/overview';
const timeline = '/body-analytics/timeline';
void test('body analytics requires valid Bearer tokens and leaves health untouched', async () => {
  for (const path of [overview, timeline + '?metric=weightKg'])
    for (const bearer of ['', 'malformed', expired])
      await get(path, 401, bearer);
  assert.deepEqual(await get('/health', 200, ''), { status: 'ok' });
});
void test('body analytics empty HTTP results preserve explicit nulls and canonical defaults', async () => {
  const result = await get(overview, 200, empty);
  for (const metric of bodyMetrics)
    assert.deepEqual(result[metric], {
      latest: null,
      previous: null,
      change: null,
    });
  assert.deepEqual(await get(timeline + '?metric=weightKg', 200, empty), {
    metric: 'weightKg',
    unit: 'kg',
    items: [],
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
});
void test('body overview serializes independent partial sequences and clean negative differences', async () => {
  const result = await get(overview);
  assert.deepEqual(result.weightKg, {
    latest: { value: 82.4, measuredAt: '2026-09-20T00:00:00.000Z' },
    previous: { value: 83.25, measuredAt: '2026-09-01T00:00:00.000Z' },
    change: -0.85,
  });
  assert.equal(object(result.waistCm).change, -3.25);
  assert.equal(object(result.chestCm).change, -0.7);
  assert.equal(object(result.bodyFatPercent).previous, null);
  assert.equal(object(result.hipsCm).change, null);
  assert.equal(
    object(object((await get(overview, 200, foreign)).weightKg).latest).value,
    85.5,
  );
});
void test('HTTP timeline is oldest first, null-filtered and paginated with canonical units', async () => {
  const result = await get(timeline + '?metric=weightKg');
  assert.ok(Array.isArray(result.items));
  assert.deepEqual(
    result.items.map((item) => object(item).value),
    [85.5, 83.25, 82.4],
  );
  const page = await get(timeline + '?metric=weightKg&page=2&limit=1');
  assert.deepEqual(
    [page.page, page.limit, page.total, page.totalPages],
    [2, 1, 3, 3],
  );
  assert.ok(Array.isArray(page.items));
  assert.equal(object(page.items[0]).value, 83.25);
  for (const [metric, unit] of [
    ['bodyFatPercent', 'percent'],
    ['waistCm', 'cm'],
    ['chestCm', 'cm'],
    ['hipsCm', 'cm'],
  ])
    assert.equal((await get(timeline + '?metric=' + metric)).unit, unit);
  await get(timeline + '?metric=weightKg&limit=200');
});
void test('HTTP range is inclusive with explicit timezone; previous never comes from outside range', async () => {
  const query = new URLSearchParams({
    from: '2026-09-20T02:00:00+02:00',
    to: '2026-09-25T00:00:00Z',
  });
  const result = await get(overview + '?' + query);
  assert.equal(object(result.weightKg).previous, null);
  assert.equal(object(result.weightKg).change, null);
  const data = await get(timeline + '?metric=weightKg&' + query);
  assert.equal(data.total, 1);
  assert.ok(Array.isArray(data.items));
  assert.equal(object(data.items[0]).value, 82.4);
});
void test('body HTTP rejects unsupported fields, ambiguous timestamps and invalid calendar/ranges', async (context) => {
  for (const query of [
    'foo=bar',
    'userId=' + other,
    'status=COMPLETED',
    'q=x',
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
      await get(timeline + '?metric=weightKg&' + query, 400);
    });
  for (const query of ['page=1', 'limit=20', 'metric=weightKg'])
    await get(overview + '?' + query, 400);
});
void test('body timeline requires an exact safe metric selector and strict bounded pagination', async (context) => {
  for (const query of [
    '',
    'metric=',
    'metric=weight',
    'metric=constructor',
    'metric=__proto__',
    'metric=weightKg%3BSELECT',
    'metric=weightKg&metric=waistCm',
  ])
    await get(timeline + '?' + query, 400);
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=01',
    'page=1e2',
    'page=%201%20',
    'page=1&page=2',
    'page=2147483648&limit=200',
    'limit=0',
    'limit=201',
    'limit=1.5',
    'limit=2x',
    'limit=',
  ])
    await context.test(query, async () => {
      await get(timeline + '?metric=weightKg&' + query, 400);
    });
});
void test('body analytics exposes no writes and rejects identity supplied in GET bodies', async () => {
  for (const path of [overview, timeline])
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await fetch(base + path, {
        method,
        headers: { authorization: 'Bearer ' + token },
      });
      assert.equal(result.status, 404);
      await result.arrayBuffer();
    }
  const body = JSON.stringify({ userId: other });
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
