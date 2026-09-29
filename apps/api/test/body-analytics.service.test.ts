import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { BodyAnalyticsRepository } from '../src/body-analytics/body-analytics.repository';
import { BodyAnalyticsService } from '../src/body-analytics/body-analytics.service';
import {
  bodyMetrics,
  bodyMetricUnits,
  type BodyAnalyticsRangeInput,
  type BodyAnalyticsTimelineInput,
} from '../src/body-analytics/body-analytics.types';
import { InvalidBodyAnalyticsQueryError } from '../src/body-analytics/errors/invalid-body-analytics-query.error';
import { BodyAnalyticsPersistenceError } from '../src/body-analytics/errors/body-analytics-persistence.error';
import {
  InMemoryBodyAnalyticsRepository,
  seedBodyAnalytics,
} from './support/in-memory-body-analytics.repository';

async function setup(context: TestContext) {
  const repository = new InMemoryBodyAnalyticsRepository();
  const overview = context.mock.method(repository, 'getOverviewData');
  const timeline = context.mock.method(repository, 'findTimeline');
  const module = await Test.createTestingModule({
    providers: [
      BodyAnalyticsService,
      { provide: BodyAnalyticsRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    repository,
    overview,
    timeline,
    service: module.get(BodyAnalyticsService),
    user: randomUUID(),
  };
}
void test('empty body overview returns all five null summaries; timeline is an empty canonical page', async (context) => {
  const f = await setup(context);
  seedBodyAnalytics(f.repository, randomUUID());
  const empty = await f.service.getOverview(f.user);
  assert.deepEqual(Object.keys(empty), bodyMetrics);
  for (const metric of bodyMetrics)
    assert.deepEqual(empty[metric], {
      latest: null,
      previous: null,
      change: null,
    });
  assert.deepEqual(
    await f.service.getTimeline(f.user, { metric: 'weightKg' }),
    {
      metric: 'weightKg',
      unit: 'kg',
      items: [],
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
    },
  );
});
void test('body latest/previous follow independent non-null sequences with exact public changes', async (context) => {
  const f = await setup(context);
  const rows = seedBodyAnalytics(f.repository, f.user);
  const overview = await f.service.getOverview(f.user);
  assert.deepEqual(overview.weightKg, {
    latest: { value: 82.4, measuredAt: rows[3]!.measuredAt },
    previous: { value: 83.25, measuredAt: rows[1]!.measuredAt },
    change: -0.85,
  });
  assert.equal(overview.waistCm.latest?.value, 84.5);
  assert.equal(overview.waistCm.previous?.value, 87.75);
  assert.equal(overview.waistCm.change, -3.25);
  assert.equal(overview.chestCm.change, -0.7);
  assert.deepEqual(overview.bodyFatPercent, {
    latest: { value: 16.5, measuredAt: rows[1]!.measuredAt },
    previous: null,
    change: null,
  });
  assert.equal(overview.hipsCm.latest?.value, 98.4);
  assert.equal(overview.hipsCm.previous, null);
  assert.equal(overview.hipsCm.change, null);
  assert.deepEqual(f.overview.mock.calls[0]?.arguments, [
    f.user,
    { from: undefined, to: undefined },
  ]);
  assert.equal(JSON.stringify(overview).includes('userId'), false);
});
void test('body range is inclusive and never reaches outside scope to fill previous', async (context) => {
  const f = await setup(context);
  seedBodyAnalytics(f.repository, f.user);
  const result = await f.service.getOverview(f.user, {
    from: '2026-09-20T02:00:00+02:00',
    to: '2026-09-25T00:00:00Z',
  });
  assert.equal(result.weightKg.latest?.value, 82.4);
  assert.equal(result.weightKg.previous, null);
  assert.equal(result.weightKg.change, null);
  assert.equal(result.waistCm.previous, null);
  assert.equal(result.bodyFatPercent.latest, null);
  const firstSeptember = await f.service.getOverview(f.user, {
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-01T00:00:00Z',
  });
  assert.equal(firstSeptember.weightKg.latest?.value, 83.25);
  assert.equal(firstSeptember.weightKg.previous, null);
  assert.deepEqual(f.overview.mock.calls[0]?.arguments[1], {
    from: new Date('2026-09-20T00:00:00Z'),
    to: new Date('2026-09-25T00:00:00Z'),
  });
});
void test('body timeline maps all units, filters nulls and paginates chronologically without changing total', async (context) => {
  const f = await setup(context);
  seedBodyAnalytics(f.repository, f.user);
  for (const metric of bodyMetrics)
    assert.equal(
      (await f.service.getTimeline(f.user, { metric })).unit,
      bodyMetricUnits[metric],
    );
  const timeline = await f.service.getTimeline(f.user, { metric: 'weightKg' });
  assert.deepEqual(
    timeline.items.map((row) => row.value),
    [85.5, 83.25, 82.4],
  );
  assert.deepEqual(Object.keys(timeline.items[0]!).sort(), [
    'measuredAt',
    'measurementId',
    'value',
  ]);
  const page = await f.service.getTimeline(f.user, {
    metric: 'weightKg',
    page: 2,
    limit: 1,
  });
  assert.deepEqual(
    page.items.map((row) => row.value),
    [83.25],
  );
  assert.equal(page.total, 3);
  assert.equal(page.totalPages, 3);
  const range = await f.service.getTimeline(f.user, {
    metric: 'weightKg',
    from: '2026-09-01T00:00:00Z',
  });
  assert.deepEqual(
    range.items.map((row) => row.value),
    [83.25, 82.4],
  );
  assert.deepEqual(
    (await f.service.getTimeline(f.user, { metric: 'weightKg', page: 99 }))
      .items,
    [],
  );
});
void test('body queries isolate owners and deterministic timestamp ties use measurement id', async (context) => {
  const f = await setup(context);
  const a = seedBodyAnalytics(f.repository, f.user);
  const b = seedBodyAnalytics(f.repository, randomUUID());
  b[3]!.weightKg = b[0]!.weightKg;
  const last = a[3]!;
  const duplicate = {
    ...last,
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    weightKg: a[1]!.weightKg,
  };
  last.id = '00000000-0000-4000-8000-000000000001';
  f.repository.records.push(duplicate);
  const result = await f.service.getOverview(f.user);
  assert.equal(result.weightKg.latest?.value, 83.25);
  assert.equal(result.weightKg.previous?.value, 82.4);
  const timeline = await f.service.getTimeline(f.user, { metric: 'weightKg' });
  assert.equal(timeline.total, 4);
  assert.equal(timeline.items.at(-1)?.measurementId, duplicate.id);
  assert.ok(
    f.timeline.mock.calls.every((call) => call.arguments[0] === f.user),
  );
});
void test('body domain rejects invalid identities, dates, metric selectors and pagination before persistence', async (context) => {
  const f = await setup(context);
  for (const input of [
    { from: null },
    { from: '2026-09-01T00:00:00' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-20T00:00:00Z', to: '2026-09-01T00:00:00Z' },
  ])
    await assert.rejects(
      f.service.getOverview(f.user, input as BodyAnalyticsRangeInput),
      InvalidBodyAnalyticsQueryError,
    );
  for (const input of [
    {},
    { metric: 'weight' },
    { metric: 'constructor' },
    { metric: 'weightKg', page: 0 },
    { metric: 'weightKg', limit: 201 },
    { metric: 'weightKg', page: '2' },
    { metric: 'weightKg', limit: null },
    { metric: 'weightKg', page: 2147483648, limit: 200 },
  ])
    await assert.rejects(
      f.service.getTimeline(f.user, input as BodyAnalyticsTimelineInput),
      InvalidBodyAnalyticsQueryError,
    );
  await assert.rejects(
    f.service.getOverview('invalid'),
    InvalidBodyAnalyticsQueryError,
  );
  assert.equal(f.overview.mock.calls.length, 0);
  assert.equal(f.timeline.mock.calls.length, 0);
});
void test('body service does not fabricate success on persistence failure or unsafe counts', async (context) => {
  const f = await setup(context);
  f.overview.mock.mockImplementation(async () => {
    throw new BodyAnalyticsPersistenceError();
  });
  await assert.rejects(
    f.service.getOverview(f.user),
    BodyAnalyticsPersistenceError,
  );
  f.timeline.mock.mockImplementation(async () => ({
    items: [],
    total: '9007199254740992',
  }));
  await assert.rejects(
    f.service.getTimeline(f.user, { metric: 'weightKg' }),
    BodyAnalyticsPersistenceError,
  );
});
