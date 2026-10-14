import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import { isTrainingCalendar } from '../src/features/history/calendar.contract';
import { trainingCalendar } from './support/training-calendar-fixture';
const base = 'https://api.test',
  grant = { accessToken: 'memory-access', tokenType: 'Bearer' },
  json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
const data = trainingCalendar(),
  query = {
    fromDate: data.fromDate,
    toDate: data.toDate,
    timezone: data.timezone,
  };
void test('calendar uses one real DATE-only GET with auth/cookies, no userId or per-day requests', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
      json(String(input).endsWith('/auth/login') ? grant : data),
    ),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  const before = fetcher.mock.calls.length;
  assert.deepEqual(await client.getTrainingCalendar(query), data);
  assert.equal(fetcher.mock.calls.length, before + 1);
  const [input, init] = fetcher.mock.calls.at(-1)!.arguments,
    url = new URL(String(input));
  assert.equal(url.pathname, '/training-calendar/days');
  assert.deepEqual(Object.fromEntries(url.searchParams), query);
  assert.equal(init?.method ?? 'GET', 'GET');
  assert.equal(init?.body, undefined);
  assert.equal(init?.credentials, 'include');
  assert.equal(
    new Headers(init?.headers).get('authorization'),
    'Bearer memory-access',
  );
});
void test('calendar keeps one refresh/retry on 401 and propagates live/pre-aborted AbortSignal', async (context) => {
  let reads = 0;
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
      String(input).includes('/auth/')
        ? json(grant)
        : ++reads === 1
          ? json({}, 401)
          : json(data),
    ),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  const live = new AbortController();
  await client.getTrainingCalendar(query, live.signal);
  assert.equal(reads, 2);
  assert.equal(
    fetcher.mock.calls.filter((c) =>
      String(c.arguments[0]).endsWith('/auth/refresh'),
    ).length,
    1,
  );
  assert.equal(fetcher.mock.calls.at(-1)!.arguments[1]?.signal, live.signal);
  live.abort();
  const before = fetcher.mock.calls.length;
  await assert.rejects(client.getTrainingCalendar(query, live.signal));
  assert.equal(fetcher.mock.calls.length, before);
  fetcher.mock.mockImplementation(async (input) =>
    String(input).includes('/auth/') ? json(grant) : json({}, 401),
  );
  await assert.rejects(
    client.getTrainingCalendar(query),
    (e: unknown) => e instanceof ApiError && e.kind === 'unauthorized',
  );
});
void test('calendar failures and foreign month/timezone remain sanitized errors; invalid queries never fetch', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  for (const fail of [
    () => json({ message: 'private SQL' }, 500),
    () => json({ ...data, timezone: 'UTC' }),
    () => json(trainingCalendar('2026-11')),
    () => json({ ...data, days: [] }),
    () => {
      throw Error('private network');
    },
  ]) {
    fetcher.mock.mockImplementation(async () => fail());
    await assert.rejects(
      client.getTrainingCalendar(query),
      (e: unknown) => e instanceof ApiError && !e.message.includes('private'),
    );
  }
  const before = fetcher.mock.calls.length;
  for (const invalid of [
    { ...query, fromDate: '2026-10-32' },
    { ...query, toDate: '2026-09-01' },
    { ...query, toDate: '2028-01-01' },
    { ...query, timezone: '+02:00' },
  ])
    await assert.rejects(client.getTrainingCalendar(invalid), ApiError);
  assert.equal(fetcher.mock.calls.length, before);
});
void test('dense contract requires every date once and ordered, including real zero rows; never repairs missing data', () => {
  for (const month of ['2026-02', '2024-02', '2026-04', '2026-10'])
    assert.equal(isTrainingCalendar(trainingCalendar(month)), true);
  const snapshot = structuredClone(data);
  for (const days of [
    [],
    data.days.slice(1),
    [data.days[0], ...data.days],
    [...data.days].reverse(),
    data.days.map((d, i) => (i === 10 ? data.days[9] : d)),
    data.days.map((d, i) => (i === 0 ? { ...d, date: '2026-09-30' } : d)),
  ])
    assert.equal(isTrainingCalendar({ ...data, days }), false);
  for (const override of [
    { totalVolumeKg: '0' },
    { completedWorkouts: null },
    { totalDurationSeconds: Infinity },
    { completedSets: -1 },
    { totalReps: 0.5 },
  ])
    assert.equal(
      isTrainingCalendar({
        ...data,
        days: [{ ...data.days[0], ...override }, ...data.days.slice(1)],
      }),
      false,
    );
  assert.deepEqual(data, snapshot);
  assert.equal(data.days[4]!.completedWorkouts, 0);
});
