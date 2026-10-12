import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  measurementFixture,
  measurementId,
  measurementPage,
} from './support/body-fixture';

const base = 'https://api.example.test',
  path = '/body-measurements/' + measurementId;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const scenarios: {
  label: string;
  call: (client: ApiClient) => Promise<unknown>;
  path: string;
  method: string;
  body?: object;
  result?: unknown;
}[] = [
  {
    label: 'list default backend page without per-item reads',
    call: (c) => c.listBodyMeasurements(),
    path: '/body-measurements?page=1&limit=20',
    method: 'GET',
    result: measurementPage(),
  },
  {
    label:
      'list safely serializes supported inclusive range and pagination only',
    call: (c) =>
      c.listBodyMeasurements({
        page: 2,
        limit: 10,
        from: '2026-10-01T00:00:00+02:00',
        to: '2026-10-10T00:00:00Z',
      }),
    path: '/body-measurements?page=2&limit=10&from=2026-10-01T00%3A00%3A00%2B02%3A00&to=2026-10-10T00%3A00%3A00Z',
    method: 'GET',
    result: { ...measurementPage(), page: 2, limit: 10 },
  },
  {
    label: 'get owned measurement detail for edit deep link',
    call: (c) => c.getBodyMeasurement(measurementId),
    path,
    method: 'GET',
    result: measurementFixture(),
  },
  {
    label: 'create partial exact decimals, omits measuredAt for server Now',
    call: (c) => c.createBodyMeasurement({ weightKg: 79.25 }),
    path: '/body-measurements',
    method: 'POST',
    body: { weightKg: 79.25 },
    result: measurementFixture({ weightKg: 79.25 }),
  },
  {
    label: 'create multiple metrics with explicit timestamp offset and notes',
    call: (c) =>
      c.createBodyMeasurement({
        waistCm: 84,
        chestCm: 99.5,
        measuredAt: '2026-10-01T20:30:00.123+02:00',
        notes: 'evening',
      }),
    path: '/body-measurements',
    method: 'POST',
    body: {
      waistCm: 84,
      chestCm: 99.5,
      measuredAt: '2026-10-01T20:30:00.123+02:00',
      notes: 'evening',
    },
    result: measurementFixture(),
  },
  {
    label:
      'PATCH keeps omitted values/time and explicitly clears metrics/notes via null',
    call: (c) =>
      c.updateBodyMeasurement(measurementId, { weightKg: null, notes: null }),
    path,
    method: 'PATCH',
    body: { weightKg: null, notes: null },
    result: measurementFixture({ weightKg: null, notes: null }),
  },
  {
    label:
      'PATCH historical measuredAt retains explicit timezone and supported fields',
    call: (c) =>
      c.updateBodyMeasurement(measurementId, {
        measuredAt: '2026-10-02T08:15:00Z',
        hipsCm: 98.25,
      }),
    path,
    method: 'PATCH',
    body: { measuredAt: '2026-10-02T08:15:00Z', hipsCm: 98.25 },
    result: measurementFixture(),
  },
  {
    label:
      'DELETE physically removes observation through existing 204 endpoint, not archive',
    call: (c) => c.deleteBodyMeasurement(measurementId),
    path,
    method: 'DELETE',
  },
];
for (const scenario of scenarios)
  void test('Body ' + scenario.label, async (context) => {
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh')
        ? json({ accessToken: 'memory', tokenType: 'Bearer' })
        : scenario.result === undefined
          ? new Response(null, { status: 204 })
          : json(scenario.result),
    );
    assert.deepEqual(
      await scenario.call(new ApiClient(base, fetcher)),
      scenario.result,
    );
    const [url, init] = fetcher.mock.calls[1]!.arguments;
    assert.equal(String(url), base + scenario.path);
    assert.equal(init?.method ?? 'GET', scenario.method);
    assert.equal(init?.credentials, 'include');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer memory',
    );
    assert.deepEqual(
      init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      scenario.body,
    );
    assert.doesNotMatch(String(init?.body), /userId|profile|unitSystem/);
    assert.equal(fetcher.mock.callCount(), 2);
  });
void test('Body all methods reuse bounded 401 refresh/retry and no parallel auth implementation', async (context) => {
  for (const scenario of scenarios) {
    let calls = 0,
      rotations = 0;
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh')
        ? json({ accessToken: 'memory-' + ++rotations, tokenType: 'Bearer' })
        : ++calls === 1
          ? json({ message: 'private' }, 401)
          : scenario.result === undefined
            ? new Response(null, { status: 204 })
            : json(scenario.result),
    );
    await scenario.call(new ApiClient(base, fetcher));
    assert.equal(calls, 2);
    assert.equal(rotations, 2);
  }
});
void test('Body network/400/404/500 errors are sanitized, writes never replay or produce fabricated zeros', async (context) => {
  for (const scenario of scenarios)
    for (const status of [0, 400, 404, 500]) {
      let calls = 0;
      const fetcher = context.mock.fn<typeof fetch>(async (url) => {
        if (String(url).endsWith('/auth/refresh'))
          return json({ accessToken: 'memory', tokenType: 'Bearer' });
        calls++;
        if (!status) throw Error('private SQL');
        return json({ message: 'private SQL' }, status);
      });
      await assert.rejects(
        scenario.call(new ApiClient(base, fetcher)),
        (error) => error instanceof ApiError && !error.message.includes('SQL'),
      );
      assert.equal(calls, 1);
    }
});
void test('Body invalid/empty metrics payloads and foreign detail IDs fail safely', async (context) => {
  for (const result of [
    { ...measurementFixture(), weightKg: null, waistCm: null },
    { ...measurementFixture(), weightKg: 0 },
    { ...measurementFixture(), id: 'foreign' },
    { id: 'partial' },
  ]) {
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh')
        ? json({ accessToken: 'memory', tokenType: 'Bearer' })
        : json(result),
    );
    await assert.rejects(
      new ApiClient(base, fetcher).getBodyMeasurement(measurementId),
      ApiError,
    );
  }
});
void test('Body read cancellation prevents fetch/refetch; unsafe URL pagination/timestamps never sent', async (context) => {
  const controller = new AbortController(),
    fetcher = context.mock.fn<typeof fetch>();
  controller.abort();
  const client = new ApiClient(base, fetcher);
  await assert.rejects(client.listBodyMeasurements({}, controller.signal));
  await assert.rejects(
    client.getBodyMeasurement(measurementId, controller.signal),
  );
  assert.equal(fetcher.mock.callCount(), 0);
  for (const query of [
    { page: 0 },
    { limit: 101 },
    { from: '2026-10-01' },
    { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
  ])
    assert.throws(() => client.listBodyMeasurements(query), ApiError);
});
