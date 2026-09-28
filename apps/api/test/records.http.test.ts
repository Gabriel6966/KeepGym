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
import { RecordsPersistenceError } from '../src/records/errors/records-persistence.error';
import { environmentConfig } from '../src/config/environment.config';
import { configureHttp } from '../src/http/configure-http';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  recordsFixture,
  InMemoryRecordsRepository,
} from './support/in-memory-records.repository';
import { testEnvironment } from './support/test-environment';

const f = recordsFixture();
const repository = new InMemoryRecordsRepository(f.occurrences);
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
    .overrideProvider(RecordsRepository)
    .useValue(repository)
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
const endpoint = '/records/exercises/' + f.exerciseId;
async function get(path = endpoint, status = 200, bearer = token) {
  const response = await fetch(base + path, {
    headers: bearer ? { authorization: 'Bearer ' + bearer } : {},
  });
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = object(await response.json());
  for (const field of [
    'userId',
    'passwordHash',
    'stack',
    'sourceTemplateId',
    'PrismaClient',
  ])
    assert.equal(JSON.stringify(body).includes('"' + field + '"'), false);
  return body;
}
void test('records requires valid access JWT; health is unchanged and invalid UUID returns 400', async () => {
  for (const bearer of ['', 'malformed', expiredToken])
    await get(endpoint, 401, bearer);
  await get('/records/exercises/invalid', 400);
  assert.deepEqual(await get('/health', 200, ''), { status: 'ok' });
});
void test('valid unknown UUID returns 200 and explicit null metadata/records', async () => {
  assert.deepEqual(await get('/records/exercises/' + randomUUID()), {
    exercise: null,
    maxLoadRecord: null,
    estimated1RMRecord: null,
  });
});
void test('HTTP returns earliest max load, exact Epley and historical metadata without foreign/unfinished highs', async () => {
  const data = await get();
  const max = object(data.maxLoadRecord);
  const estimated = object(data.estimated1RMRecord);
  assert.equal(max.type, 'MAX_LOAD');
  assert.equal(max.valueKg, 100);
  assert.equal(object(max.set).id, f.first.sets[1]?.setId);
  assert.equal(object(max.set).reps, 3);
  assert.equal(max.achievedAt, f.first.sets[1]?.completedAt.toISOString());
  assert.equal(max.achievedAt, object(max.set).completedAt);
  assert.equal(estimated.type, 'ESTIMATED_1RM');
  assert.equal(estimated.valueKg, 116.67);
  assert.equal(object(estimated.set).id, f.later.sets[0]?.setId);
  assert.equal(object(max.set).rpe, 8.5);
  assert.equal(object(data.exercise).name, f.later.snapshot.exerciseName);
  assert.equal(
    object((await get(endpoint, 200, otherToken)).maxLoadRecord).valueKg,
    200,
  );
});
void test('records rejects all query parameters, including range, pagination, status and identity', async (context) => {
  for (const query of [
    'foo=bar',
    'userId=' + f.other,
    'from=2026-09-01T00:00:00Z',
    'to=2026-09-30T00:00:00Z',
    'page=1',
    'limit=20',
    'status=COMPLETED',
    'status=CANCELLED',
    'q=bench',
    'foo=',
    'foo=a&foo=b',
  ])
    await context.test(query, async () => {
      await get(endpoint + '?' + query, 400);
    });
});
void test('records exposes no writes and never accepts identity from a GET body', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 404);
  }
  const body = JSON.stringify({ userId: f.other });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      base + endpoint,
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
void test('persistence failures return generic 500 without exposing internal errors', async (context) => {
  context.mock.method(repository, 'findExerciseRecordData', async () => {
    throw new RecordsPersistenceError();
  });
  assert.equal((await get(endpoint, 500)).message, 'Internal server error');
});
