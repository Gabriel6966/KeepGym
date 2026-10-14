import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import { isWeeklyMuscleGroups } from '../src/features/progress/muscle.contract';
import { muscleWeeks } from './support/muscle-fixture';
const base = 'https://api.example.test',
  grant = { accessToken: 'memory-access', tokenType: 'Bearer' },
  json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
const data = muscleWeeks(),
  query = { from: data.from, to: data.to, timezone: data.timezone };
void test('muscle read uses one real GET with only from/to/timezone, existing Bearer/cookie auth and no per-group reads', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
      json(String(input).endsWith('/auth/login') ? grant : data),
    ),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  const before = fetcher.mock.calls.length;
  assert.deepEqual(await client.getMuscleGroupWeeklyTrends(query), data);
  assert.equal(fetcher.mock.calls.length, before + 1);
  const [input, init] = fetcher.mock.calls.at(-1)!.arguments,
    url = new URL(String(input));
  assert.equal(url.pathname, '/training-trends/muscle-groups/weekly');
  assert.deepEqual(Object.fromEntries(url.searchParams), query);
  assert.equal(init?.method ?? 'GET', 'GET');
  assert.equal(init?.body, undefined);
  assert.equal(init?.credentials, 'include');
  assert.equal(
    new Headers(init?.headers).get('authorization'),
    'Bearer memory-access',
  );
});
void test('muscle read reuses bounded 401 refresh/retry and cancellation', async (context) => {
  let gets = 0;
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
      String(input).includes('/auth/')
        ? json(grant)
        : ++gets === 1
          ? json({}, 401)
          : json(data),
    ),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  await client.getMuscleGroupWeeklyTrends(query);
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
  await assert.rejects(client.getMuscleGroupWeeklyTrends(query, abort.signal));
  assert.equal(fetcher.mock.calls.length, before);
  const live = new AbortController();
  await client.getMuscleGroupWeeklyTrends(query, live.signal);
  assert.equal(fetcher.mock.calls.at(-1)!.arguments[1]?.signal, live.signal);
});
void test('malformed/foreign scope/private server and network failures remain sanitized errors, never empty success', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('u@example.com', 'a'.repeat(15));
  for (const fail of [
    () => json({}, 500),
    () => json({ message: 'private SQL' }, 400),
    () => json({ ...data, timezone: 'UTC' }),
    () => json({ ...data, from: '2026-09-01T00:00:00Z' }),
    () => json([]),
    () => {
      throw Error('private network');
    },
  ]) {
    fetcher.mock.mockImplementation(async () => fail());
    await assert.rejects(
      client.getMuscleGroupWeeklyTrends(query),
      (e: unknown) => e instanceof ApiError && !e.message.includes('private'),
    );
  }
  const before = fetcher.mock.calls.length;
  for (const invalid of [
    { ...query, from: 'bad' },
    { ...query, to: '2030-01-01T00:00:00Z' },
    { ...query, from: '2027-01-01T00:00:00Z' },
    { ...query, timezone: '+02:00' },
  ])
    await assert.rejects(client.getMuscleGroupWeeklyTrends(invalid), ApiError);
  assert.equal(fetcher.mock.calls.length, before);
});
void test('public muscle contract preserves numeric zero and sparse buckets, rejects unknown enum/date/count/Decimal shape', () => {
  assert.equal(isWeeklyMuscleGroups(data), true);
  assert.equal(isWeeklyMuscleGroups({ ...data, buckets: [] }), true);
  for (const row of [
    { muscleGroup: 'LEGS' },
    { completedSets: '2' },
    { totalVolumeKg: null },
    { totalVolumeKg: Infinity },
  ])
    assert.equal(
      isWeeklyMuscleGroups({
        ...data,
        buckets: [
          {
            weekStart: '2026-10-05',
            muscleGroups: [{ ...data.buckets[1]!.muscleGroups[0]!, ...row }],
          },
        ],
      }),
      false,
    );
  assert.equal(
    isWeeklyMuscleGroups({
      ...data,
      buckets: [{ ...data.buckets[0], weekStart: '2026-10-06' }],
    }),
    false,
  );
});
