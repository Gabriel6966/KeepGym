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
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrainingCalendarService } from '../src/training-calendar/training-calendar.service';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { TrainingConsistencyService } from '../src/training-consistency/training-consistency.service';
import { testEnvironment } from './support/test-environment';
import {
  dashboardServices,
  dashboardInput as input,
  emptyDashboard,
  expectedDashboardWeek,
} from './support/dashboard-services';

const f = dashboardServices(),
  endpoint = '/dashboard/summary';
let app: INestApplication,
  base: string,
  token: string,
  foreign: string,
  expired: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(TrainingCalendarService)
    .useValue(f.calendar)
    .overrideProvider(TrainingTrendsService)
    .useValue(f.trends)
    .overrideProvider(TrainingConsistencyService)
    .useValue(f.consistency)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  token = jwt.sign({ sub: f.owner });
  foreign = jwt.sign({ sub: randomUUID() });
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
  const data = object(await response.json());
  for (const key of [
    'userId',
    'passwordHash',
    'Prisma',
    'stack',
    'recentWorkouts',
    'bodyFat',
    'recommendations',
    'score',
    'currentStreak',
  ])
    assert.equal(JSON.stringify(data).includes('"' + key + '"'), false);
  return data;
}
void test('dashboard HTTP requires valid JWT and leaves health available', async () => {
  for (const bearer of ['', expired, 'invalid'])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('dashboard HTTP composes exact week, comparison and 12-week consistency without leaking another principal', async () => {
  const result = await get();
  assert.deepEqual(result.week, expectedDashboardWeek);
  assert.deepEqual(object(result.comparison).totalVolumeKg, {
    previous: 1500,
    delta: 355.75,
    percentageChange: 23.72,
  });
  assert.equal(object(result.consistency).fromWeekStart, '2026-07-20');
  assert.equal(object(result.consistency).endingWeeklyStreak, 5);
  assert.deepEqual(await get(undefined, 200, foreign), emptyDashboard());
});
void test('dashboard HTTP rejects missing/duplicate query fields and malformed/unknown selectors', async (context) => {
  for (const field of ['weekStart', 'timezone']) {
    const params = new URLSearchParams(input);
    params.delete(field);
    await get(params, 400);
    const duplicate = new URLSearchParams(input);
    duplicate.append(field, 'UTC');
    await get(duplicate, 400);
  }
  for (const override of [
    { weekStart: '' },
    { weekStart: '2026-02-30' },
    { weekStart: '2026-10-06' },
    { weekStart: '2026-10-05T00:00:00Z' },
    { weekStart: '2026-1-05' },
    { weekStart: ' 2026-10-05 ' },
    { weekStart: '0001-01-01' },
    { weekStart: '9999-12-27' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: '' },
    ...['userId', 'status', 'from', 'to', 'page', 'limit', 'foo'].map(
      (key) => ({ [key]: '1' }),
    ),
  ])
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
});
void test('dashboard HTTP permits future Mondays and preserves zero baseline nulls', async () => {
  const future = { weekStart: '2099-01-05', timezone: 'UTC' };
  assert.deepEqual(
    await get(new URLSearchParams(future)),
    emptyDashboard(future),
  );
});
void test('dashboard HTTP has no write endpoints and refuses GET body selectors', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  const body = JSON.stringify({ userId: randomUUID() });
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
void test('dashboard HTTP never replaces a subservice failure or invalid window with zero data', async (context) => {
  context.mock.method(f.calendar, 'getDays', async () => {
    throw new Error('private SQL');
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
