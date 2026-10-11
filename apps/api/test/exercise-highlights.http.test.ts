import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AnalyticsRepository } from '../src/analytics/analytics.repository';
import { environmentConfig } from '../src/config/environment.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureHttp } from '../src/http/configure-http';
import { testEnvironment } from './support/test-environment';
import { exerciseHighlightsFixture } from './support/exercise-highlights';

const f = exerciseHighlightsFixture();
let app: INestApplication,
  base: string,
  token: string,
  foreign: string,
  empty: string;
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(environmentConfig.KEY)
    .useValue(testEnvironment())
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AnalyticsRepository)
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
});
after(async () => app?.close());
const path = '/analytics/exercise-highlights';
async function get(url = path, status = 200, bearer = token) {
  const response = await fetch(base + url, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, status, url);
  assert.equal(response.headers.get('set-cookie'), null);
  return (await response.json()) as {
    items: {
      exercise: { sourceExerciseId: string; name: string };
      latest: { maxLoadKg: number; completedSets: number };
      previous: { maxLoadKg: number } | null;
    }[];
  };
}
void test('highlights require authentication, return empty 200 and coexist with overview/exercise routes', async () => {
  await get(path, 401, '');
  await get(path, 401, 'invalid');
  assert.deepEqual(await get(path, 200, empty), { items: [] });
  const result = await get();
  assert.deepEqual(
    result.items.map((item) => item.exercise.sourceExerciseId),
    [f.benchId, f.squatId, f.rowId],
  );
  assert.equal(result.items[0]!.latest.maxLoadKg, 80);
  assert.equal(result.items[0]!.previous!.maxLoadKg, 75);
  assert.equal(result.items[0]!.exercise.name, 'Latest Bench snapshot');
  assert.equal(
    (await get(path, 200, foreign)).items[0]!.latest.maxLoadKg,
    9000,
  );
  await get('/analytics/overview');
  await get('/analytics/exercises/' + f.benchId);
  await get('/analytics/exercises/not-a-uuid', 400);
  assert.equal(JSON.stringify(result).includes('userId'), false);
});
void test('bounded feed accepts default/1/20 but rejects noncanonical numeric formats and unknown selectors', async (context) => {
  assert.equal((await get(path + '?limit=1')).items.length, 1);
  assert.equal((await get(path + '?limit=20')).items.length, 3);
  for (const query of [
    'limit=0',
    'limit=21',
    'limit=1.5',
    'limit=abc',
    'limit=01',
    'limit=1e1',
    'limit=-1',
    'limit=%201%20',
    'limit=',
    'limit=1&limit=2',
    'limit=Infinity',
    'limit=NaN',
    'limit=0x10',
    'userId=' + f.other,
    'status=COMPLETED',
    'page=1',
    'from=2026-09-01',
    'metric=volume',
    'foo=bar',
  ])
    await context.test(query, async () => {
      await get(path + '?' + query, 400);
    });
});
void test('highlights have no write routes and repository failures are generic errors, not empty feeds', async (context) => {
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
  context.mock.method(
    f.repository,
    'findExerciseHighlightPerformances',
    async () => {
      throw new Error('Private SQL credentials');
    },
  );
  const result = await get(path, 500);
  assert.deepEqual(result, {
    statusCode: 500,
    message: 'Internal server error',
  });
});
