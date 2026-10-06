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
import { TrainingDurationRepository } from '../src/training-duration/training-duration.repository';
import { testEnvironment } from './support/test-environment';
import {
  trainingDurationFixture,
  durationInput as input,
  expectedDuration,
} from './support/in-memory-training-duration.repository';

const f = trainingDurationFixture(),
  endpoint = '/training-duration/weekly';
let app: INestApplication,
  base: string,
  token: string,
  foreign: string,
  empty: string,
  expired: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(TrainingDurationRepository)
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
    'invalidDurationCount',
    'activeTime',
    'restTime',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('duration HTTP requires valid Bearer auth and preserves health', async () => {
  for (const bearer of ['', 'malformed', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('duration HTTP returns exact seconds and null empty average, excluding unfinished and foreign sessions', async () => {
  assert.deepEqual(await get(), expectedDuration);
  assert.equal(
    object((await get(undefined, 200, foreign)).summary).totalDurationSeconds,
    900000,
  );
  assert.deepEqual(await get(undefined, 200, empty), {
    ...expectedDuration,
    summary: {
      completedWorkouts: 0,
      totalDurationSeconds: 0,
      averageDurationSeconds: null,
    },
    buckets: [],
  });
});
void test('duration HTTP validates required range/timezone and rejects unknown or duplicate queries', async (context) => {
  for (const field of ['from', 'to', 'timezone']) {
    const missing = new URLSearchParams(input);
    missing.delete(field);
    await get(missing, 400);
    const duplicate = new URLSearchParams(input);
    duplicate.append(field, 'UTC');
    await get(duplicate, 400);
  }
  for (const override of [
    { from: '' },
    { from: '2026-09-07' },
    { from: '2026-09-07T00:00:00' },
    { from: '2026-02-30T00:00:00Z' },
    { to: '2026-10-04T24:00:00Z' },
    { to: '2026-10-04T00:00:00.1234Z' },
    { from: input.to, to: input.from },
    { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    { timezone: '' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: ' UTC ' },
    ...['userId', 'status', 'page', 'limit', 'metric', 'weekStart', 'foo'].map(
      (key) => ({ [key]: '1' }),
    ),
  ])
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
  for (const timezone of ['UTC', 'Europe/Madrid', 'America/New_York'])
    await get(new URLSearchParams({ ...input, timezone }));
  await get(
    new URLSearchParams({
      ...input,
      from: '2025-01-01T00:00:00Z',
      to: '2027-01-01T00:00:00Z',
    }),
  );
});
void test('duration HTTP has no writes and rejects body selectors', async () => {
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
void test('duration HTTP corruption and persistence failures return generic errors, not partial analytics', async (context) => {
  for (const seconds of [null, -1]) {
    const owner = randomUUID();
    f.add(owner, '2026-09-07T10:00:00Z', seconds);
    const bearer = app.get(JwtService).sign({ sub: owner });
    assert.deepEqual(await get(undefined, 500, bearer), {
      statusCode: 500,
      message: 'Internal server error',
    });
  }
  context.mock.method(f.repository, 'findWeeklyDurations', async () => {
    throw new Error('private SQL');
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
