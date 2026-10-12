import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  historyPage,
  historyDetail,
  cancelledHistory,
} from './support/history-fixture';
import { sessionId } from './support/workout-fixture';

const base = 'https://api.example.test';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
void test('History list serializes only real pagination/status/search/inclusive timestamps and performs one domain read', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'memory', tokenType: 'Bearer' })
      : json({ ...historyPage(), page: 2, limit: 10 }),
  );
  const client = new ApiClient(base, fetcher);
  await client.listWorkoutHistory({
    page: 2,
    limit: 10,
    status: 'CANCELLED',
    q: ' Push & legs ',
    from: '2026-10-01T00:00:00+02:00',
    to: '2026-10-15T00:00:00Z',
  });
  const [url, init] = fetcher.mock.calls[1]!.arguments;
  assert.equal(
    String(url),
    base +
      '/history/workouts?page=2&limit=10&status=CANCELLED&q=Push+%26+legs&from=2026-10-01T00%3A00%3A00%2B02%3A00&to=2026-10-15T00%3A00%3A00Z',
  );
  assert.equal(init?.credentials, 'include');
  assert.equal(init?.cache, 'no-store');
  assert.equal(init?.body, undefined);
  assert.equal(init?.method ?? 'GET', 'GET');
  assert.equal(
    new Headers(init?.headers).get('authorization'),
    'Bearer memory',
  );
  assert.equal(fetcher.mock.callCount(), 2);
});
void test('History default list is all terminal workouts, page 1/limit20; detail has no query or mutable/exercise endpoint fan-out', async (context) => {
  const detail = cancelledHistory();
  const fetcher = context.mock.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'memory', tokenType: 'Bearer' })
      : String(url).includes('/history/workouts?')
        ? json(historyPage())
        : json(detail),
  );
  const client = new ApiClient(base, fetcher);
  await client.listWorkoutHistory();
  assert.deepEqual(await client.getWorkoutHistory(sessionId), detail);
  assert.deepEqual(
    fetcher.mock.calls.map((call) => String(call.arguments[0])),
    [
      base + '/auth/refresh',
      base + '/history/workouts?page=1&limit=20',
      base + '/history/workouts/' + sessionId,
    ],
  );
});
for (const detail of [false, true])
  void test(
    'History ' +
      (detail ? 'detail' : 'list') +
      ' reuses one 401 refresh/retry and keeps unauthorized errors bounded',
    async (context) => {
      for (const permanent of [false, true]) {
        let reads = 0,
          rotations = 0;
        const fetcher = context.mock.fn<typeof fetch>(async (url) =>
          String(url).endsWith('/auth/refresh')
            ? json({
                accessToken: 'memory-' + ++rotations,
                tokenType: 'Bearer',
              })
            : ++reads === 1 || permanent
              ? json({ message: 'private' }, 401)
              : json(detail ? historyDetail() : historyPage()),
        );
        const client = new ApiClient(base, fetcher),
          result = detail
            ? client.getWorkoutHistory(sessionId)
            : client.listWorkoutHistory();
        if (permanent)
          await assert.rejects(
            result,
            (error) =>
              error instanceof ApiError && error.kind === 'unauthorized',
          );
        else await result;
        assert.equal(reads, 2);
        assert.equal(rotations, 2);
      }
    },
  );
void test('History reads sanitize non-2xx/network/invalid payloads, never manufacture empty history', async (context) => {
  for (const status of [0, 400, 403, 404, 500, 200]) {
    const fetcher = context.mock.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/refresh'))
        return json({ accessToken: 'memory', tokenType: 'Bearer' });
      if (!status) throw new Error('SQL private stack');
      return json({ message: 'SQL private stack' }, status);
    });
    const client = new ApiClient(base, fetcher);
    for (const result of [
      client.listWorkoutHistory(),
      client.getWorkoutHistory(sessionId),
    ])
      await assert.rejects(
        result,
        (error) =>
          error instanceof ApiError &&
          !error.message.includes('SQL') &&
          error.cause === undefined,
      );
  }
});
void test('History never accepts IN_PROGRESS detail or a foreign response ID', async (context) => {
  for (const payload of [
    { ...historyDetail(), status: 'IN_PROGRESS' },
    { ...historyDetail(), id: 'other' },
  ]) {
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh')
        ? json({ accessToken: 'memory', tokenType: 'Bearer' })
        : json(payload),
    );
    await assert.rejects(
      new ApiClient(base, fetcher).getWorkoutHistory(sessionId),
      ApiError,
    );
  }
});
void test('History aborted reads do not retry or fetch after cancellation', async (context) => {
  const controller = new AbortController(),
    fetcher = context.mock.fn<typeof fetch>();
  controller.abort();
  const client = new ApiClient(base, fetcher);
  await assert.rejects(client.listWorkoutHistory({}, controller.signal));
  await assert.rejects(client.getWorkoutHistory(sessionId, controller.signal));
  assert.equal(fetcher.mock.callCount(), 0);
});
void test('History encodes opaque IDs and rejects malformed timestamp/pagination before fetching', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'memory', tokenType: 'Bearer' })
      : json({ ...historyDetail(), id: 'opaque/id?x' }),
  );
  const client = new ApiClient(base, fetcher);
  await client.getWorkoutHistory('opaque/id?x');
  assert.equal(
    String(fetcher.mock.calls.at(-1)!.arguments[0]),
    base + '/history/workouts/opaque%2Fid%3Fx',
  );
  for (const query of [
    { page: 0 },
    { limit: 101 },
    { q: '' },
    { from: '2026-10-12' },
    { from: '2026-10-15T00:00:00Z', to: '2026-10-12T00:00:00Z' },
  ])
    assert.throws(() => client.listWorkoutHistory(query), ApiError);
});
