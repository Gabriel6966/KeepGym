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
import { shiftLocalMonday } from '../src/common/calendar-week';
import { TrainingConsistencyRepository } from '../src/training-consistency/training-consistency.repository';
import { TrainingConsistencyPersistenceError } from '../src/training-consistency/errors/training-consistency-persistence.error';
import { testEnvironment } from './support/test-environment';
import {
  trainingConsistencyFixture,
  consistencyInput as input,
  expectedConsistency,
} from './support/in-memory-training-consistency.repository';

const f = trainingConsistencyFixture();
const endpoint = '/training-consistency/weekly';
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
    .overrideProvider(TrainingConsistencyRepository)
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
  for (const field of [
    'userId',
    'passwordHash',
    'Prisma',
    'stack',
    'currentWeeklyStreak',
    'dailyStreak',
    'consistencyScore',
    'recommendation',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('consistency HTTP requires valid Bearer tokens and preserves health', async () => {
  for (const bearer of ['', 'malformed', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('consistency HTTP reports completed scoped activity, including same-day and zero-set workouts', async () => {
  assert.deepEqual(await get(), expectedConsistency);
  const other = await get(undefined, 200, foreign);
  assert.equal(other.completedWorkouts, 6);
  assert.equal(other.activeWeeks, 6);
  assert.equal(other.longestWeeklyStreak, 6);
  assert.deepEqual(await get(undefined, 200, empty), {
    ...expectedConsistency,
    completedWorkouts: 0,
    activeDays: 0,
    activeWeeks: 0,
    longestWeeklyStreak: 0,
    endingWeeklyStreak: 0,
  });
  const endingInactive = await get(
    new URLSearchParams({ ...input, toWeekStart: '2026-09-07' }),
  );
  assert.equal(endingInactive.longestWeeklyStreak, 2);
  assert.equal(endingInactive.endingWeeklyStreak, 0);
});
void test('consistency HTTP validates required Monday dates, IANA zones, range and exactly 104 weeks', async (context) => {
  for (const field of ['fromWeekStart', 'toWeekStart', 'timezone']) {
    const missing = new URLSearchParams(input);
    missing.delete(field);
    await get(missing, 400);
    const duplicate = new URLSearchParams(input);
    duplicate.append(field, 'UTC');
    await get(duplicate, 400);
  }
  const invalid: Record<string, string>[] = [
    { fromWeekStart: '' },
    { fromWeekStart: '2026-02-30' },
    { fromWeekStart: '2026-08-25' },
    { toWeekStart: '2026-09-29' },
    { fromWeekStart: '2026-08-24T00:00:00Z' },
    { toWeekStart: '2026-09-28T00:00:00+02:00' },
    { fromWeekStart: '2026-8-24' },
    { toWeekStart: '2026-08-17' },
    { fromWeekStart: ' 2026-08-24 ' },
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: ' UTC ' },
    { toWeekStart: shiftLocalMonday(input.fromWeekStart, 104) },
    ...[
      'userId',
      'status',
      'from',
      'to',
      'weekStart',
      'page',
      'limit',
      'metric',
      'foo',
    ].map((key) => ({ [key]: '1' })),
  ];
  for (const override of invalid)
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
  const maximum = await get(
    new URLSearchParams({
      ...input,
      toWeekStart: shiftLocalMonday(input.fromWeekStart, 103),
    }),
  );
  assert.equal(maximum.totalWeeks, 104);
  for (const timezone of ['Europe/Madrid', 'UTC', 'America/New_York']) {
    const future = await get(
      new URLSearchParams({
        fromWeekStart: '2099-01-05',
        toWeekStart: '2099-01-05',
        timezone,
      }),
    );
    assert.equal(future.totalWeeks, 1);
    assert.equal(future.activeWeeks, 0);
  }
});
void test('consistency is read-only and rejects body selectors instead of accepting client identity', async () => {
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
void test('consistency HTTP persistence errors stay generic, not false empty activity', async (context) => {
  context.mock.method(f.repository, 'findWeeklyActivity', async () => {
    throw new TrainingConsistencyPersistenceError();
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
