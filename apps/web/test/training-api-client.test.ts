import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  weeklyTraining,
  weeklyConsistency,
  weeklyDuration,
  trainingPeriod,
  trainingRange,
} from './support/training-fixture';
const base = 'https://api.example.test',
  grant = { accessToken: 'memory-access', tokenType: 'Bearer' },
  json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
const scenarios = [
  {
    name: 'Training Trends',
    path: '/training-trends/weekly',
    query: trainingPeriod,
    response: weeklyTraining(),
    run: (c: ApiClient, s?: AbortSignal) =>
      c.getWeeklyTraining(trainingPeriod, s),
  },
  {
    name: 'Consistency',
    path: '/training-consistency/weekly',
    query: { ...trainingRange, timezone: trainingPeriod.timezone },
    response: weeklyConsistency(),
    run: (c: ApiClient, s?: AbortSignal) =>
      c.getWeeklyConsistency(
        { ...trainingRange, timezone: trainingPeriod.timezone },
        s,
      ),
  },
  {
    name: 'Duration',
    path: '/training-duration/weekly',
    query: trainingPeriod,
    response: weeklyDuration(),
    run: (c: ApiClient, s?: AbortSignal) =>
      c.getWeeklyDuration(trainingPeriod, s),
  },
];
for (const scenario of scenarios) {
  void test(
    scenario.name +
      ' exact GET/query, cookie/Bearer reuse, no userId or per-bucket reads',
    async (context) => {
      const fetcher = context.mock.fn<typeof fetch>(async (input) =>
          json(
            String(input).endsWith('/auth/login') ? grant : scenario.response,
          ),
        ),
        client = new ApiClient(base, fetcher);
      await client.login('u@example.com', 'a'.repeat(15));
      const before = fetcher.mock.calls.length;
      assert.deepEqual(await scenario.run(client), scenario.response);
      assert.equal(fetcher.mock.calls.length, before + 1);
      const [input, init] = fetcher.mock.calls.at(-1)!.arguments,
        url = new URL(String(input));
      assert.equal(url.pathname, scenario.path);
      assert.deepEqual(Object.fromEntries(url.searchParams), scenario.query);
      assert.equal(init?.method ?? 'GET', 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.credentials, 'include');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer memory-access',
      );
    },
  );
  void test(
    scenario.name +
      ' 401 retries once; abort propagates without requests; private errors remain sanitized',
    async (context) => {
      let gets = 0;
      const fetcher = context.mock.fn<typeof fetch>(async (input) =>
          String(input).includes('/auth/')
            ? json(grant)
            : ++gets === 1
              ? json({}, 401)
              : json(scenario.response),
        ),
        client = new ApiClient(base, fetcher);
      await client.login('u@example.com', 'a'.repeat(15));
      await scenario.run(client);
      assert.equal(gets, 2);
      assert.equal(
        fetcher.mock.calls.filter((c) =>
          String(c.arguments[0]).endsWith('/auth/refresh'),
        ).length,
        1,
      );
      const abort = new AbortController();
      abort.abort();
      const before = fetcher.mock.calls.length;
      await assert.rejects(scenario.run(client, abort.signal));
      assert.equal(fetcher.mock.calls.length, before);
      for (const fail of [
        () => json({ message: 'SQL private' }, 500),
        () => json({}),
        () => {
          throw Error('private network');
        },
      ]) {
        fetcher.mock.mockImplementation(async () => fail());
        await assert.rejects(
          scenario.run(client),
          (e: unknown) =>
            e instanceof ApiError && !e.message.includes('private'),
        );
      }
    },
  );
}
void test('three parallel analytics reads share one refresh and return independent payloads', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      return json(
        path === '/auth/refresh'
          ? grant
          : scenarios.find((s) => s.path === path)!.response,
      );
    }),
    client = new ApiClient(base, fetcher);
  await Promise.all(scenarios.map((s) => s.run(client)));
  assert.equal(fetcher.mock.calls.length, 4);
  assert.equal(
    fetcher.mock.calls.filter((c) =>
      String(c.arguments[0]).endsWith('/auth/refresh'),
    ).length,
    1,
  );
});
void test('invalid ranges/timezones and mismatched response scope are rejected, never an empty success', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  const before = fetcher.mock.calls.length;
  for (const query of [
    { ...trainingPeriod, from: 'bad' },
    { ...trainingPeriod, to: '2030-01-01T00:00:00Z' },
    { ...trainingPeriod, timezone: '+01:00' },
    { ...trainingPeriod, from: '2027-01-01T00:00:00Z' },
  ]) {
    await assert.rejects(client.getWeeklyTraining(query), ApiError);
    await assert.rejects(client.getWeeklyDuration(query), ApiError);
  }
  await assert.rejects(
    client.getWeeklyConsistency({
      ...trainingRange,
      fromWeekStart: '2026-09-22',
      timezone: 'UTC',
    }),
    ApiError,
  );
  await assert.rejects(
    client.getWeeklyConsistency({
      fromWeekStart: '2024-01-01',
      toWeekStart: '2026-01-05',
      timezone: 'UTC',
    }),
    ApiError,
  );
  assert.equal(fetcher.mock.calls.length, before);
  for (const scenario of scenarios) {
    fetcher.mock.mockImplementation(async () =>
      json({ ...scenario.response, timezone: 'UTC' }),
    );
    await assert.rejects(scenario.run(client), ApiError);
  }
});
