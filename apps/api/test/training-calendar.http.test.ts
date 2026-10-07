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
import { TrainingCalendarRepository } from '../src/training-calendar/training-calendar.repository';
import { testEnvironment } from './support/test-environment';
import {
  trainingCalendarFixture,
  calendarInput as input,
  expectedCalendar,
  zeroDay,
} from './support/in-memory-training-calendar.repository';

const f = trainingCalendarFixture(),
  endpoint = '/training-calendar/days';
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
    .overrideProvider(TrainingCalendarRepository)
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
function days(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
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
    'averageDurationSeconds',
    'isActive',
  ])
    assert.equal(JSON.stringify(result).includes('"' + field + '"'), false);
  return result;
}
void test('calendar HTTP requires valid Bearer tokens and preserves health', async () => {
  for (const bearer of ['', 'invalid', expired])
    await get(undefined, 401, bearer);
  assert.deepEqual(await (await fetch(base + '/health')).json(), {
    status: 'ok',
  });
});
void test('calendar HTTP is dense, completed-only, owner scoped and exact for bodyweight, volume and duration', async () => {
  assert.deepEqual(await get(), expectedCalendar);
  assert.equal(
    days((await get(undefined, 200, foreign)).days)[0]!.totalVolumeKg,
    100000,
  );
  assert.deepEqual(await get(undefined, 200, empty), {
    ...input,
    days: expectedCalendar.days.map((d) => zeroDay(d.date)),
  });
});
void test('calendar HTTP requires local dates and timezone, rejects duplicate/unknown fields, and permits 366 but not 367 days', async (context) => {
  for (const field of ['fromDate', 'toDate', 'timezone']) {
    const params = new URLSearchParams(input);
    params.delete(field);
    await get(params, 400);
    const duplicate = new URLSearchParams(input);
    duplicate.append(field, 'UTC');
    await get(duplicate, 400);
  }
  const invalid: Record<string, string>[] = [
    { fromDate: '' },
    { fromDate: '2026-02-30' },
    { fromDate: '2026-02-29' },
    { fromDate: '2026-09-28T00:00:00Z' },
    { toDate: '2026-10-04T00:00:00+02:00' },
    { fromDate: '2026-9-28' },
    { fromDate: ' 2026-09-28 ' },
    { toDate: '2026-09-27' },
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
    { timezone: 'Europe/Foo' },
    { timezone: 'GMT+2' },
    { timezone: '+02:00' },
    { timezone: '' },
    ...['userId', 'status', 'from', 'to', 'page', 'limit', 'metric', 'foo'].map(
      (key) => ({ [key]: '1' }),
    ),
  ];
  for (const override of invalid)
    await context.test(JSON.stringify(override), async () => {
      await get(new URLSearchParams({ ...input, ...override }), 400);
    });
  assert.equal(
    days(
      (
        await get(
          new URLSearchParams({
            ...input,
            fromDate: '2024-01-01',
            toDate: '2024-12-31',
          }),
        )
      ).days,
    ).length,
    366,
  );
  for (const timezone of ['Europe/Madrid', 'UTC', 'America/New_York']) {
    const result = await get(
      new URLSearchParams({
        fromDate: '2099-01-01',
        toDate: '2099-01-01',
        timezone,
      }),
    );
    assert.deepEqual(result.days, [zeroDay('2099-01-01')]);
  }
});
void test('calendar HTTP has no write endpoints and rejects GET body selectors', async () => {
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
void test('calendar HTTP corruption and private SQL failures are generic errors rather than zero-filled success', async (context) => {
  for (const seconds of [null, -1]) {
    const user = randomUUID();
    f.add(user, '2026-09-28T08:00:00Z', seconds);
    const bearer = app.get(JwtService).sign({ sub: user });
    assert.deepEqual(await get(undefined, 500, bearer), {
      statusCode: 500,
      message: 'Internal server error',
    });
  }
  context.mock.method(f.repository, 'findDailyActivity', async () => {
    throw new Error('private SQL');
  });
  assert.deepEqual(await get(undefined, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
