import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { environmentConfig } from '../src/config/environment.config';
import { HistoryRepository } from '../src/history/history.repository';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  historyFixture,
  InMemoryHistoryRepository,
} from './support/in-memory-history.repository';
import { testEnvironment } from './support/test-environment';

const f = historyFixture();
let app: INestApplication;
let base: string;
let token: string;
let otherToken: string;
let expiredToken: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(HistoryRepository)
    .useValue(new InMemoryHistoryRepository(f.records))
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const jwt = app.get(JwtService);
  token = jwt.sign({ sub: f.owner });
  otherToken = jwt.sign({ sub: f.other });
  expiredToken = jwt.sign({ sub: f.owner }, { expiresIn: -1 });
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
function items(value: Record<string, unknown>) {
  assert.ok(Array.isArray(value.items));
  return value.items.map(object);
}
async function get(path: string, status = 200, bearer = token) {
  const response = await fetch(base + path, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = object(await response.json());
  for (const field of [
    'passwordHash',
    'userId',
    'sourceTemplateId',
    'PrismaClient',
    'stack',
  ])
    assert.equal(JSON.stringify(body).includes('"' + field + '"'), false);
  return body;
}
const workouts = '/history/workouts';
const exercise = '/history/exercises/' + f.exerciseId;

void test('all historical routes require valid access tokens and leave auth cookies unchanged', async () => {
  for (const path of [
    workouts,
    workouts + '/' + f.completed.session.id,
    exercise,
  ])
    for (const bearer of ['', 'malformed', expiredToken])
      await get(path, 401, bearer);
});

void test('workout history HTTP defaults to both terminal states and supports individual status filters', async () => {
  const result = await get(workouts);
  assert.equal(result.total, 3);
  assert.deepEqual(
    items(result).map((item) => item.id),
    [f.cancelled.session.id, f.completed.session.id, f.older.session.id],
  );
  assert.deepEqual(
    items(result).map((item) => item.setCount),
    [2, 6, 6],
  );
  for (const status of ['COMPLETED', 'CANCELLED'])
    assert.ok(
      items(await get(workouts + '?status=' + status)).every(
        (item) => item.status === status,
      ),
    );
  await get(workouts + '?status=IN_PROGRESS', 400);
});

void test('workout HTTP literal search, inclusive timezone limits and pagination return accurate metadata', async () => {
  const query = new URLSearchParams({
    q: '  pUSH 50%_\\  ',
    from: '2026-09-20T12:00:00+02:00',
    to: '2026-09-20T10:00:00Z',
  });
  const result = await get(workouts + '?' + query.toString());
  assert.deepEqual(
    items(result).map((item) => item.id),
    [f.completed.session.id],
  );
  const paged = await get(workouts + '?page=2&limit=1');
  assert.deepEqual(
    [paged.page, paged.limit, paged.total, paged.totalPages],
    [2, 1, 3, 3],
  );
  assert.equal(items(paged)[0]?.id, f.completed.session.id);
  assert.deepEqual(items(await get(workouts + '?q=unmatched')), []);
  assert.deepEqual(items(await get(workouts + '?page=99')), []);
});

void test('history detail exposes ordered planned snapshots and actual numeric sets for completed and cancelled sessions', async () => {
  for (const record of [f.completed, f.cancelled]) {
    const body = await get(workouts + '/' + record.session.id);
    assert.equal(body.status, record.session.status);
    assert.equal(body.name, record.session.name);
    assert.ok(Array.isArray(body.exercises));
    const entries = body.exercises.map(object);
    assert.deepEqual(
      entries.map((entry) => entry.position),
      [1, 2],
    );
    const entry = entries[0]!;
    assert.equal(object(entry.exercise).name, 'Original Bench');
    assert.equal(entry.plannedSets, 4);
    assert.ok(Array.isArray(entry.sets));
    const sets = entry.sets.map(object);
    assert.deepEqual(
      sets.map((set) => set.loadKg),
      record === f.cancelled ? [80] : [80, 80.5, 82.25],
    );
    assert.equal(typeof sets[0]?.completedAt, 'string');
    assert.equal(typeof sets[0]?.loadKg, 'number');
  }
});

void test('detail conceals active, foreign and missing sessions identically and rejects invalid UUIDs/selectors', async () => {
  for (const id of [f.active.session.id, f.foreign.session.id, randomUUID()]) {
    const error = await get(workouts + '/' + id, 404);
    assert.equal(error.message, 'Workout history not found.');
  }
  await get(workouts + '/' + f.completed.session.id, 404, otherToken);
  await get(workouts + '/invalid', 400);
  await get(
    workouts + '/' + f.completed.session.id + '?userId=' + f.other,
    400,
  );
  await get(workouts + '/' + f.completed.session.id + '?status=COMPLETED', 400);
});

void test('exercise HTTP history defaults to completed, keeps cancelled sets, scopes users and supports last-time pagination', async () => {
  const last = await get(exercise + '?limit=1');
  assert.equal(last.total, 2);
  const entry = items(last)[0]!;
  assert.equal(entry.sessionId, f.completed.session.id);
  assert.equal(entry.sessionStatus, 'COMPLETED');
  assert.equal(object(entry.exercise).name, 'Original Bench');
  assert.ok(Array.isArray(entry.sets));
  assert.deepEqual(
    entry.sets.map((set) => object(set).position),
    [1, 2, 3],
  );
  assert.equal(object(entry.sets[2]).rpe, 8.5);
  const cancelled = items(await get(exercise + '?status=CANCELLED'));
  assert.equal(cancelled[0]?.sessionId, f.cancelled.session.id);
  assert.equal(cancelled[0]?.sessionStatus, 'CANCELLED');
  const other = items(await get(exercise, 200, otherToken));
  assert.deepEqual(
    other.map((item) => item.sessionId),
    [f.foreign.session.id],
  );
  const older = await get(exercise + '?to=2026-09-19T10%3A00%3A00Z');
  assert.deepEqual(
    items(older).map((item) => item.sessionId),
    [f.older.session.id],
  );
  const empty = await get('/history/exercises/' + randomUUID());
  assert.deepEqual(empty, {
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  await get('/history/exercises/invalid', 400);
  await get(exercise + '?q=bench', 400);
});

void test('history HTTP strictly rejects unknown, repeated, ambiguous, impossible and out-of-range query values', async (context) => {
  for (const query of [
    'status=IN_PROGRESS',
    'status=OTHER',
    'status=completed',
    'status=',
    'status=COMPLETED&status=CANCELLED',
    'foo=bar',
    'userId=' + f.other,
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1e2',
    'page=01',
    'page=%201%20',
    'page=1&page=2',
    'page=2147483648&limit=100',
    'limit=0',
    'limit=101',
    'limit=2x',
    'limit=1.5',
    'limit=',
    'from=',
    'to=',
    'from=2026-09-01',
    'from=2026-09-01T00%3A00%3A00',
    'from=2026-02-31T00%3A00%3A00Z',
    'from=2026-09-01T24%3A00%3A00Z',
    'from=2026-09-01T00%3A00%3A00.1234Z',
    'from=x&from=y',
    'from=0001-01-01T00%3A00%3A00%2B01%3A00',
    'to=9999-12-31T23%3A59%3A59-01%3A00',
    'from=2026-09-02T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z',
  ])
    await context.test(query, async () => {
      await get(workouts + '?' + query, 400);
      await get(exercise + '?' + query, 400);
    });
  for (const query of ['q=', 'q=%20%20', 'q=x&q=y', 'q=' + 'x'.repeat(101)])
    await get(workouts + '?' + query, 400);
});

void test('history exposes no write endpoints and rejects body-based selectors; health remains public', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
    for (const path of [
      workouts,
      workouts + '/' + f.completed.session.id,
      exercise,
    ]) {
      const response = await fetch(base + path, {
        method,
        headers: { authorization: 'Bearer ' + token },
      });
      assert.equal(response.status, 404);
    }
  const body = JSON.stringify({ userId: f.other });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      base + workouts,
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
  assert.deepEqual(await get('/health', 200, ''), { status: 'ok' });
});
