import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
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

const f = historyFixture(),
  repository = new InMemoryHistoryRepository(f.records);
for (let index = 0; index < 4; index++) {
  const copy = { ...f.older.session, exercises: [] };
  copy.id = randomUUID();
  copy.startedAt = new Date(`2026-09-${10 + index}T10:00:00Z`);
  copy.exercises = [];
  f.records.push({ userId: f.owner, session: copy });
}
let app: INestApplication,
  base: string,
  token: string,
  empty: string,
  foreign: string,
  expired: string;
const endpoint = '/history/recent-workouts';
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(HistoryRepository)
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
async function get(query = '', expected = 200, bearer = token) {
  const response = await fetch(base + endpoint + query, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, expected, query);
  assert.equal(response.headers.get('set-cookie'), null);
  const body: unknown = await response.json();
  assert.ok(typeof body === 'object' && body !== null);
  assert.doesNotMatch(
    JSON.stringify(body),
    /"(?:userId|sourceTemplateId|passwordHash|stack|Prisma)"/,
  );
  return body as Record<string, unknown>;
}
void test('recent HTTP authenticates and empty history returns only items', async () => {
  for (const bearer of ['', expired, 'invalid']) await get('', 401, bearer);
  assert.deepEqual(await get('', 200, empty), { items: [] });
});
void test('recent HTTP default 5, minimum 1, maximum 20; excludes other owners and non-completed sessions', async () => {
  for (const [query, length] of [
    ['', 5],
    ['?limit=1', 1],
    ['?limit=20', 6],
  ] as const) {
    const body = await get(query);
    assert.ok(Array.isArray(body.items));
    assert.equal(body.items.length, length);
    assert.equal(
      (body.items[0] as Record<string, unknown>).id,
      f.completed.session.id,
    );
    assert.deepEqual(Object.keys(body), ['items']);
  }
  const body = await get('', 200, foreign);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items.length, 1);
  assert.equal(
    (body.items[0] as Record<string, unknown>).id,
    f.foreign.session.id,
  );
});
void test('recent HTTP strictly validates limit and rejects unknown selectors', async (context) => {
  for (const value of [
    '0',
    '21',
    '-1',
    '1.5',
    'abc',
    '',
    'NaN',
    'Infinity',
    '1e1',
    '01',
    ' 1 ',
    '0x10',
  ])
    await context.test('limit=' + value, async () => {
      await get('?limit=' + encodeURIComponent(value), 400);
    });
  await get('?limit=1&limit=2', 400);
  for (const key of ['userId', 'status', 'page', 'from', 'to', 'q', 'unknown'])
    await get('?' + key + '=1', 400);
});
void test('recent static route coexists with History list/detail/exercise routes and has no writes', async () => {
  for (const path of [
    '/history/workouts',
    '/history/workouts/' + f.completed.session.id,
    '/history/exercises/' + f.exerciseId,
  ]) {
    const response = await fetch(base + path, {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
});
void test('recent HTTP sanitizes corrupted duration and storage errors', async (context) => {
  context.mock.method(repository, 'findRecentCompletedWorkouts', async () => {
    throw new Error('private SQL');
  });
  assert.deepEqual(await get('', 500), {
    statusCode: 500,
    message: 'Internal server error',
  });
});
