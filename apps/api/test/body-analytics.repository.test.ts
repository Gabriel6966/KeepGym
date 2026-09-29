import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { BodyAnalyticsRepository } from '../src/body-analytics/body-analytics.repository';
import {
  bodyMetrics,
  type BodyMetric,
} from '../src/body-analytics/body-analytics.types';
import { BodyAnalyticsPersistenceError } from '../src/body-analytics/errors/body-analytics-persistence.error';
import { InvalidBodyAnalyticsQueryError } from '../src/body-analytics/errors/invalid-body-analytics-query.error';

async function setup(context: TestContext) {
  const row = {
    measurementId: randomUUID(),
    measuredAt: new Date('2026-09-20T00:00:00Z'),
    value: '82.40',
  };
  const sql = context.mock.fn<(query: Prisma.Sql) => Promise<unknown[]>>(
    async (query) => {
      if (query.text.includes('COUNT(*)')) return [{ total: '30' }];
      if (query.text.includes('UNION ALL'))
        return [{ ...row, metric: 'weightKg' }];
      return [row];
    },
  );
  const tx = { $queryRaw: sql };
  const transaction = context.mock.fn(
    async (
      callback: (client: typeof tx) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return callback(tx);
    },
  );
  const module = await Test.createTestingModule({
    providers: [
      BodyAnalyticsRepository,
      {
        provide: PrismaService,
        useValue: { ...tx, $transaction: transaction },
      },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    row,
    sql,
    transaction,
    repository: module.get(BodyAnalyticsRepository),
  };
}

void test('body overview is one consistent bounded statement: two non-null observations per metric, owner and inclusive dates parameterized', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-30T00:00:00Z');
  assert.deepEqual(await f.repository.getOverviewData(user, { from, to }), [
    { ...f.row, metric: 'weightKg' },
  ]);
  assert.equal(f.sql.mock.calls.length, 1);
  assert.equal(f.transaction.mock.calls.length, 0);
  const sql = f.sql.mock.calls[0]!.arguments[0];
  assert.deepEqual(
    sql.values,
    bodyMetrics.flatMap((metric) => [metric, user, from, to]),
  );
  assert.equal(sql.text.includes(user), false);
  assert.equal(sql.text.match(/LIMIT 2/g)?.length, 5);
  assert.equal(
    sql.text.match(/ORDER BY b.measured_at DESC, b.id DESC/g)?.length,
    5,
  );
  assert.equal(sql.text.match(/b.user_id = \$\d+::uuid/g)?.length, 5);
  assert.equal(sql.text.match(/b.measured_at >= \$\d+/g)?.length, 5);
  assert.equal(sql.text.match(/b.measured_at <= \$\d+/g)?.length, 5);
  for (const column of [
    'weight_kg',
    'body_fat_percent',
    'waist_cm',
    'chest_cm',
    'hips_cm',
  ])
    assert.match(sql.text, new RegExp('b\\.' + column + ' IS NOT NULL'));
  assert.doesNotMatch(
    sql.text,
    /JOIN|profiles|users|notes|created_at|updated_at/,
  );
});

void test('body timeline uses two RepeatableRead SELECTs, chronological order and a global count with the same scope', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-30T00:00:00Z');
  const result = await f.repository.findTimeline(user, {
    metric: 'waistCm',
    from,
    to,
    page: 3,
    limit: 10,
  });
  assert.deepEqual(result, { items: [f.row], total: '30' });
  assert.equal(f.transaction.mock.calls.length, 1);
  assert.equal(f.sql.mock.calls.length, 2);
  const [items, count] = f.sql.mock.calls.map((call) => call.arguments[0]);
  assert.deepEqual(items!.values, [user, from, to, 10, 20]);
  assert.deepEqual(count!.values, [user, from, to]);
  for (const query of [items!, count!]) {
    assert.match(query.text, /b.user_id = \$1::uuid/);
    assert.match(query.text, /b.measured_at >= \$2/);
    assert.match(query.text, /b.measured_at <= \$3/);
    assert.match(query.text, /b.waist_cm IS NOT NULL/);
    assert.equal(query.text.includes(user), false);
  }
  assert.match(items!.text, /b.waist_cm::text AS value/);
  assert.match(items!.text, /ORDER BY b.measured_at ASC, b.id ASC/);
  assert.match(items!.text, /LIMIT \$4 OFFSET \$5/);
  assert.doesNotMatch(count!.text, /LIMIT|OFFSET/);
});

void test('metric SQL allowlist is exhaustive; malicious selectors and inherited keys never reach persistence', async (context) => {
  const f = await setup(context);
  const unsafe = "' OR TRUE --";
  const columns = [
    'weight_kg',
    'body_fat_percent',
    'waist_cm',
    'chest_cm',
    'hips_cm',
  ];
  for (const [index, metric] of bodyMetrics.entries()) {
    await f.repository.findTimeline(unsafe, { metric, page: 1, limit: 200 });
    const sql = f.sql.mock.calls[index * 2]!.arguments[0];
    assert.match(
      sql.text,
      new RegExp('b\\.' + columns[index] + '::text AS value'),
    );
    assert.equal(sql.text.includes(unsafe), false);
    assert.equal(sql.values[0], unsafe);
  }
  for (const metric of [
    'weightKg; DROP TABLE users',
    'constructor',
    '__proto__',
    'WEIGHTKG',
    '',
  ])
    await assert.rejects(
      f.repository.findTimeline(randomUUID(), {
        metric: metric as BodyMetric,
        page: 1,
        limit: 50,
      }),
      InvalidBodyAnalyticsQueryError,
    );
  assert.equal(f.sql.mock.calls.length, 10);
  assert.equal(f.transaction.mock.calls.length, 5);
});

void test('query count stays fixed across pagination and database errors are sanitized, not converted to empty success', async (context) => {
  const f = await setup(context);
  const user = randomUUID();
  for (const limit of [1, 200]) {
    await f.repository.getOverviewData(user, {});
    await f.repository.findTimeline(user, {
      metric: 'weightKg',
      page: 2,
      limit,
    });
  }
  assert.equal(f.sql.mock.calls.length, 6);
  f.sql.mock.mockImplementation(async () => {
    throw new Error('Private database detail');
  });
  for (const operation of [
    () => f.repository.getOverviewData(user, {}),
    () =>
      f.repository.findTimeline(user, {
        metric: 'weightKg',
        page: 1,
        limit: 50,
      }),
  ])
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof BodyAnalyticsPersistenceError &&
        !error.message.includes('Private') &&
        error.cause === undefined,
    );
  f.sql.mock.mockImplementation(async () => []);
  await assert.rejects(
    f.repository.findTimeline(user, { metric: 'weightKg', page: 1, limit: 50 }),
    BodyAnalyticsPersistenceError,
  );
});
