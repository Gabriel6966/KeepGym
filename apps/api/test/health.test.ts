import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication;
let baseUrl: string;

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

after(async () => {
  await app?.close();
});

// The Node.js test runner waits for registered tests and reports their failures.
void test('GET /health returns HTTP 200 and the expected JSON body', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

void test('GET / returns HTTP 404 because no other endpoint is configured', async () => {
  const response = await fetch(baseUrl);

  assert.equal(response.status, 404);
});
