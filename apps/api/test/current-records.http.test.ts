import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { RecordsRepository } from '../src/records/records.repository';
import { environmentConfig } from '../src/config/environment.config';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  recordsFixture,
  InMemoryRecordsRepository,
} from './support/in-memory-records.repository';
import { testEnvironment } from './support/test-environment';

const f = recordsFixture(),
  repository = new InMemoryRecordsRepository(f.occurrences);
for (let index = 0; index < 3; index++) {
  const entry = structuredClone(f.first);
  entry.snapshot.sourceExerciseId = randomUUID();
  entry.sets = [entry.sets[0]!];
  entry.sets[0]!.setId = randomUUID();
  f.occurrences.push(entry);
}
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
    .overrideProvider(RecordsRepository)
    .useValue(repository)
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
const endpoint = '/records/current';
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function items(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(object);
}
async function get(path = endpoint, expected = 200, bearer = token) {
  const response = await fetch(base + path, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, expected, path);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = object(await response.json());
  assert.doesNotMatch(
    JSON.stringify(body),
    /"(?:userId|passwordHash|stack|Prisma|sourceTemplateId)"/,
  );
  return body;
}

void test('current records require JWT, preserve default five and strict custom bounds, empty feed is explicit', async () => {
  for (const bearer of ['', 'invalid', expired])
    await get(endpoint, 401, bearer);
  assert.deepEqual(await get(endpoint, 200, empty), { items: [] });
  assert.equal(items((await get()).items).length, 5);
  assert.equal(items((await get(endpoint + '?limit=1')).items).length, 1);
  assert.equal(items((await get(endpoint + '?limit=20')).items).length, 8);
});

void test('current records reject unsupported, duplicate, noninteger and arbitrary numeric query inputs', async (context) => {
  for (const query of [
    'limit=0',
    'limit=21',
    'limit=1.5',
    'limit=abc',
    'limit=1e1',
    'limit=01',
    'limit=',
    'limit=Infinity',
    'limit=1&limit=2',
    'userId=' + f.other,
    'status=COMPLETED',
    'type=MAX_LOAD',
    'exerciseId=' + f.exerciseId,
    'from=2026-01-01T00:00:00Z',
    'page=1',
    'foo=bar',
  ])
    await context.test(query, async () => {
      await get(endpoint + '?' + query, 400);
    });
});

void test('HTTP current holder first attainment, snapshots and existing exercise route agree without routing collisions', async () => {
  const all = items((await get(endpoint + '?limit=20')).items);
  const max = all.find(
    (item) =>
      item.type === 'MAX_LOAD' &&
      object(item.exercise).sourceExerciseId === f.exerciseId,
  )!;
  assert.equal(max.valueKg, 100);
  assert.equal(max.setEntryId, f.first.sets[1]!.setId);
  assert.equal(object(max.exercise).name, f.first.snapshot.exerciseName);
  const previous = await get('/records/exercises/' + f.exerciseId);
  assert.equal(object(object(previous.maxLoadRecord).set).id, max.setEntryId);
  assert.equal(object(previous.exercise).name, f.later.snapshot.exerciseName);
  await get('/records/exercises/' + f.exerciseId + '?limit=1', 400);
  const other = items((await get(endpoint, 200, foreign)).items);
  assert.equal(other.length, 2);
  assert.ok(
    other.every((item) => item.workoutSessionId === f.foreign.sessionId),
  );
  assert.ok(
    all.every(
      (item) =>
        ![
          f.cancelled.sessionId,
          f.active.sessionId,
          f.foreign.sessionId,
        ].includes(String(item.workoutSessionId)),
    ),
  );
});

void test('current feed has no write routes and rejects GET body selectors', async () => {
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
      base + endpoint,
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

void test('current feed never returns empty success or SQL details for persistence failure', async (context) => {
  context.mock.method(repository, 'findCurrentRecordCandidates', async () => {
    throw new Error('private SQL');
  });
  assert.deepEqual(await get(endpoint, 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
