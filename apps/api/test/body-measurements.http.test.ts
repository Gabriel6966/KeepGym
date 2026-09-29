import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import { BodyMeasurementsRepository } from '../src/body-measurements/body-measurements.repository';
import { InMemoryBodyMeasurementsRepository } from './support/in-memory-body-measurements.repository';
import { testEnvironment } from './support/test-environment';

let app: INestApplication;
let base: string;
let jwt: JwtService;
const endpoint = '/body-measurements';
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(BodyMeasurementsRepository)
    .useValue(new InMemoryBodyMeasurementsRepository())
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  jwt = app.get(JwtService);
});
after(async () => {
  await app?.close();
});
function token() {
  return jwt.sign({ sub: randomUUID() });
}
async function request(
  method: string,
  path: string,
  auth?: string,
  body?: unknown,
  status = 200,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  assert.equal(response.headers.get('set-cookie'), null);
  if (status === 204) {
    assert.equal(await response.text(), '');
    return {};
  }
  const result = object(await response.json());
  assert.equal('userId' in result, false);
  assert.equal('stack' in result, false);
  return result;
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function path(row: Record<string, unknown>) {
  assert.equal(typeof row.id, 'string');
  return endpoint + '/' + String(row.id);
}

void test('measurement routes require Bearer authentication without changing health/cookies', async () => {
  for (const auth of [
    undefined,
    'invalid',
    jwt.sign({ sub: randomUUID() }, { expiresIn: -1 }),
  ]) {
    for (const [method, url] of [
      ['POST', endpoint],
      ['GET', endpoint],
      ['GET', endpoint + '/' + randomUUID()],
      ['PATCH', endpoint + '/' + randomUUID()],
      ['DELETE', endpoint + '/' + randomUUID()],
    ])
      await request(
        method!,
        url!,
        auth,
        method === 'POST' || method === 'PATCH' ? { weightKg: 82 } : undefined,
        401,
      );
  }
  assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
});

void test('measurement HTTP create/detail/PATCH/delete preserve safe numbers, null clearing and the last-metric invariant', async () => {
  const auth = token();
  const created = await request(
    'POST',
    endpoint,
    auth,
    {
      weightKg: 82.25,
      bodyFatPercent: 15.75,
      waistCm: 84.33,
      notes: '  morning  ',
    },
    201,
  );
  assert.equal(created.weightKg, 82.25);
  assert.equal(created.notes, 'morning');
  assert.equal(created.chestCm, null);
  assert.deepEqual(Object.keys(created).sort(), [
    'bodyFatPercent',
    'chestCm',
    'createdAt',
    'hipsCm',
    'id',
    'measuredAt',
    'notes',
    'updatedAt',
    'waistCm',
    'weightKg',
  ]);
  assert.deepEqual(await request('GET', path(created), auth), created);
  const updated = await request('PATCH', path(created), auth, {
    weightKg: 82.5,
    waistCm: null,
    bodyFatPercent: null,
    notes: null,
  });
  assert.equal(updated.weightKg, 82.5);
  assert.equal(updated.waistCm, null);
  assert.equal(updated.notes, null);
  assert.equal(updated.measuredAt, created.measuredAt);
  await request('PATCH', path(created), auth, { weightKg: null }, 400);
  await request('PATCH', path(created), auth, {}, 400);
  assert.equal((await request('GET', path(created), auth)).weightKg, 82.5);
  await request('DELETE', path(created), auth, undefined, 204);
  await request('GET', path(created), auth, undefined, 404);
});

void test('measurement HTTP lists all-time owner observations, inclusive date ranges and pages newest first', async () => {
  const auth = token();
  const one = await request(
    'POST',
    endpoint,
    auth,
    { measuredAt: '2026-08-01T00:00:00Z', weightKg: 85.5 },
    201,
  );
  const two = await request(
    'POST',
    endpoint,
    auth,
    { measuredAt: '2026-09-01T00:00:00Z', weightKg: 83.25 },
    201,
  );
  await request('POST', endpoint, token(), { weightKg: 90 }, 201);
  const list = await request('GET', endpoint, auth);
  assert.equal(list.total, 2);
  assert.deepEqual(list.items, [two, one]);
  const page = await request('GET', endpoint + '?page=2&limit=1', auth);
  assert.deepEqual(page.items, [one]);
  assert.equal(page.totalPages, 2);
  const range = await request(
    'GET',
    endpoint + '?from=2026-09-01T00:00:00Z&to=2026-09-01T02:00:00%2B02:00',
    auth,
  );
  assert.deepEqual(range.items, [two]);
});

void test('measurement HTTP ownership conceals foreign observations and rejects IDs/selectors from clients', async () => {
  const a = token();
  const b = token();
  const created = await request('POST', endpoint, a, { weightKg: 82 }, 201);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    await request(
      method,
      path(created),
      b,
      method === 'PATCH' ? { weightKg: 83 } : undefined,
      404,
    );
    await request(
      method,
      endpoint + '/invalid',
      a,
      method === 'PATCH' ? { weightKg: 83 } : undefined,
      400,
    );
    await request(
      method,
      path(created) + '?userId=' + randomUUID(),
      a,
      method === 'PATCH' ? { weightKg: 83 } : undefined,
      400,
    );
  }
  assert.equal((await request('GET', endpoint, b)).total, 0);
});

void test('measurement DTOs reject absent metrics, numeric coercion, excess decimals, ranges, future/ambiguous dates and extra fields', async (context) => {
  const auth = token();
  const row = await request('POST', endpoint, auth, { weightKg: 82 }, 201);
  for (const body of [{}, { notes: 'only notes' }, { weightKg: null }])
    await request('POST', endpoint, auth, body, 400);
  const invalid = [
    { weightKg: '82.4' },
    { weightKg: 82.123 },
    { weightKg: 0 },
    { weightKg: -1 },
    { weightKg: 1000.01 },
    { bodyFatPercent: 0 },
    { bodyFatPercent: 100.01 },
    { waistCm: 500.01 },
    { chestCm: -1 },
    { hipsCm: 0 },
    { waistCm: '84.33' },
    { chestCm: 84.333 },
    { hipsCm: false },
    { notes: 12 },
    { notes: 'x'.repeat(1001) },
    { measuredAt: null },
    { measuredAt: '9999-01-01T00:00:00Z' },
    { measuredAt: '2026-02-31T00:00:00Z' },
    { measuredAt: '2026-09-01T00:00:00' },
    { measuredAt: '2026-09-01' },
    { measuredAt: '2026-09-01T00:00:00.1234Z' },
    { userId: randomUUID() },
    { id: randomUUID() },
    { createdAt: '2026-09-01T00:00:00Z' },
    { updatedAt: '2026-09-01T00:00:00Z' },
    { foo: 'bar' },
    { weightLb: 180 },
    { unitSystem: 'IMPERIAL' },
  ];
  for (const [index, input] of invalid.entries())
    await context.test(`invalid body ${index + 1}`, async () => {
      await request('POST', endpoint, auth, { weightKg: 82, ...input }, 400);
      await request('PATCH', path(row), auth, input, 400);
    });
  for (const body of [[], null, '82'])
    await request('POST', endpoint, auth, body, 400);
});

void test('measurement query DTO rejects ambiguous/invalid timestamps, reversed ranges, noncanonical pages and unknown properties', async (context) => {
  for (const query of [
    'from=2026-09-01',
    'from=2026-09-01T00:00:00',
    'from=2026-02-31T00:00:00Z',
    'from=',
    'from=x&from=y',
    'from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z',
    'page=0',
    'page=01',
    'page=1e2',
    'page=1.5',
    'page=%201%20',
    'page=1&page=2',
    'page=2147483648&limit=100',
    'limit=0',
    'limit=101',
    'limit=x',
    'foo=bar',
    'userId=' + randomUUID(),
    'status=COMPLETED',
  ])
    await context.test(query, async () => {
      await request('GET', endpoint + '?' + query, token(), undefined, 400);
    });
});
