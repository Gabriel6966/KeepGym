import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  exerciseId,
  occurrenceId,
  setId,
  templateEntryId,
  exerciseAnalytics,
  exerciseRecords,
  exerciseTrends,
} from './support/progress-fixture';
import { catalogFixture } from './support/templates-fixture';
const base = 'https://api.example.test',
  grant = { accessToken: 'memory-access', tokenType: 'Bearer' },
  json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
const trends = exerciseTrends(),
  weeklyQuery = { from: trends.from, to: trends.to, timezone: trends.timezone };
const scenarios = [
  {
    name: 'Catalog selector',
    run: (client: ApiClient, signal?: AbortSignal) =>
      client.listCatalogExercises({ q: 'bench', page: 2, limit: 10 }, signal),
    path: '/exercises?page=2&limit=10&q=bench',
    response: {
      items: [catalogFixture()],
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    },
  },
  {
    name: 'Analytics all-time performance pagination',
    run: (client: ApiClient, signal?: AbortSignal) =>
      client.getExerciseAnalytics(exerciseId, 2, 10, signal),
    path: '/analytics/exercises/' + exerciseId + '?page=2&limit=10',
    response: { ...exerciseAnalytics(), page: 2, limit: 10 },
  },
  {
    name: 'Exercise current holders',
    run: (client: ApiClient, signal?: AbortSignal) =>
      client.getExerciseRecords(exerciseId, signal),
    path: '/records/exercises/' + exerciseId,
    response: exerciseRecords(),
  },
  {
    name: 'Exercise Weekly Trends inclusive range/timezone',
    run: (client: ApiClient, signal?: AbortSignal) =>
      client.getExerciseWeeklyTrends(exerciseId, weeklyQuery, signal),
    path:
      '/training-trends/exercises/' +
      exerciseId +
      '/weekly?' +
      new URLSearchParams(weeklyQuery),
    response: trends,
  },
];
for (const scenario of scenarios)
  void test(
    scenario.name + ' uses real GET/path/query without userId or N+1',
    async (context) => {
      const fetcher = context.mock.fn<typeof fetch>(async (input) =>
          String(input).endsWith('/auth/login')
            ? json(grant)
            : json(scenario.response),
        ),
        client = new ApiClient(base, fetcher);
      await client.login('user@example.com', 'a'.repeat(15));
      const before = fetcher.mock.calls.length;
      assert.deepEqual(await scenario.run(client), scenario.response);
      assert.equal(fetcher.mock.calls.length, before + 1);
      const [url, init] = fetcher.mock.calls.at(-1)!.arguments;
      assert.equal(String(url), base + scenario.path);
      assert.equal(init?.method ?? 'GET', 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.credentials, 'include');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer memory-access',
      );
    },
  );
void test('three independent detail reads share one refresh; only source Exercise identity is requested', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      return json(
        path === '/auth/refresh'
          ? grant
          : path.startsWith('/analytics/')
            ? exerciseAnalytics()
            : path.startsWith('/records/')
              ? exerciseRecords()
              : trends,
      );
    }),
    client = new ApiClient(base, fetcher);
  await Promise.all([
    client.getExerciseAnalytics(exerciseId),
    client.getExerciseRecords(exerciseId),
    client.getExerciseWeeklyTrends(exerciseId, weeklyQuery),
  ]);
  assert.equal(fetcher.mock.calls.length, 4);
  for (const call of fetcher.mock.calls.slice(1)) {
    assert.ok(String(call.arguments[0]).includes(exerciseId));
    for (const wrong of [occurrenceId, templateEntryId, setId])
      assert.equal(String(call.arguments[0]).includes(wrong), false);
  }
});
for (const scenario of scenarios)
  void test(
    scenario.name + ' reuses one 401 refresh/retry and cancellation',
    async (context) => {
      let gets = 0;
      const fetcher = context.mock.fn<typeof fetch>(async (input) =>
          String(input).endsWith('/auth/login') ||
          String(input).endsWith('/auth/refresh')
            ? json(grant)
            : ++gets === 1
              ? json({}, 401)
              : json(scenario.response),
        ),
        client = new ApiClient(base, fetcher);
      await client.login('user@example.com', 'a'.repeat(15));
      await scenario.run(client);
      assert.equal(gets, 2);
      assert.equal(
        fetcher.mock.calls.filter((call) =>
          String(call.arguments[0]).endsWith('/auth/refresh'),
        ).length,
        1,
      );
      const signal = new AbortController();
      signal.abort();
      const before = fetcher.mock.calls.length;
      await assert.rejects(scenario.run(client, signal.signal));
      assert.equal(fetcher.mock.calls.length, before);
    },
  );
void test('malformed/foreign metadata/network errors are sanitized, never silently empty reads', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('user@example.com', 'a'.repeat(15));
  for (const scenario of scenarios.slice(1)) {
    for (const fail of [
      () => json({ message: 'private SQL' }, 500),
      () => json({}),
      () => {
        throw new Error('private network');
      },
    ]) {
      fetcher.mock.mockImplementation(async () => fail());
      await assert.rejects(
        scenario.run(client),
        (error: unknown) =>
          error instanceof ApiError && !error.message.includes('private'),
      );
    }
  }
  fetcher.mock.mockImplementation(async () =>
    json({
      ...exerciseAnalytics(),
      exercise: {
        sourceExerciseId: occurrenceId,
        name: 'Wrong identity',
        slug: 'wrong',
      },
    }),
  );
  await assert.rejects(client.getExerciseAnalytics(exerciseId), ApiError);
});
void test('invalid trends interval/offset timezone/page cannot send invalid input and path IDs are encoded', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('user@example.com', 'a'.repeat(15));
  const before = fetcher.mock.calls.length;
  for (const query of [
    { ...weeklyQuery, from: '2026-10-10T00:00:00' },
    { ...weeklyQuery, from: '2027-01-01T00:00:00Z' },
    { ...weeklyQuery, to: '2030-01-01T00:00:00Z' },
    { ...weeklyQuery, timezone: '+02:00' },
  ])
    await assert.rejects(
      client.getExerciseWeeklyTrends(exerciseId, query),
      ApiError,
    );
  await assert.rejects(client.getExerciseAnalytics(exerciseId, 0), ApiError);
  assert.equal(fetcher.mock.calls.length, before);
  fetcher.mock.mockImplementation(async () =>
    json({ exercise: null, maxLoadRecord: null, estimated1RMRecord: null }),
  );
  await client.getExerciseRecords('opaque/id?userId=other');
  assert.equal(
    String(fetcher.mock.calls.at(-1)!.arguments[0]),
    base + '/records/exercises/opaque%2Fid%3FuserId%3Dother',
  );
});
