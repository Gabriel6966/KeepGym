import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import { emptyDashboard } from './support/dashboard-fixture';

const base = 'https://api.example.test';
const grant = (token: string) => ({ accessToken: token, tokenType: 'Bearer' });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
async function login(client: ApiClient) {
  await client.login('test@example.com', 'test-password-for-fixture');
}
function setup(context: TestContext, implementation: typeof fetch) {
  const fetcher = context.mock.fn(implementation);
  return { fetcher, client: new ApiClient(base, fetcher) };
}
void test('default browser fetch is called on the global receiver, never on ApiClient', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async function (this: unknown, input: Parameters<typeof fetch>[0]) {
      assert.equal(this, globalThis);
      return String(input).endsWith('/auth/login')
        ? json(grant('memory-access'))
        : json(emptyDashboard());
    },
  );
  const client = new ApiClient(base);
  await login(client);
  await client.getDashboard('2026-10-12', 'Europe/Madrid');
});
void test('API client uses existing auth JSON/cookie contract and one composed Dashboard GET with only weekStart/timezone', async (context) => {
  const f = setup(context, async (input) =>
    String(input).endsWith('/auth/login')
      ? json(grant('memory-access'))
      : json(emptyDashboard()),
  );
  await login(f.client);
  assert.deepEqual(
    await f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
    emptyDashboard(),
  );
  const [url, init] = f.fetcher.mock.calls[1]!.arguments;
  assert.equal(
    String(url),
    base + '/dashboard/summary?weekStart=2026-10-12&timezone=Europe%2FMadrid',
  );
  assert.equal(
    new Headers(init?.headers).get('authorization'),
    'Bearer memory-access',
  );
  for (const call of f.fetcher.mock.calls) {
    assert.equal(call.arguments[1]?.credentials, 'include');
    assert.equal(call.arguments[1]?.cache, 'no-store');
  }
  assert.deepEqual(
    JSON.parse(String(f.fetcher.mock.calls[0]!.arguments[1]?.body)),
    { email: 'test@example.com', password: 'test-password-for-fixture' },
  );
  assert.equal(f.fetcher.mock.calls.length, 2);
});
void test('reload recovers access through HttpOnly refresh cookie; concurrent requests share one rotation', async (context) => {
  const f = setup(context, async (input) =>
    String(input).endsWith('/auth/refresh')
      ? json(grant('refreshed-access'))
      : json(emptyDashboard()),
  );
  await Promise.all([
    f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
    f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
  ]);
  assert.equal(
    f.fetcher.mock.calls.filter((call) =>
      String(call.arguments[0]).endsWith('/auth/refresh'),
    ).length,
    1,
  );
  for (const call of f.fetcher.mock.calls.filter((call) =>
    String(call.arguments[0]).includes('/dashboard/summary'),
  ))
    assert.equal(
      new Headers(call.arguments[1]?.headers).get('authorization'),
      'Bearer refreshed-access',
    );
});
void test('401 refreshes and retries once, but invalid sessions remain unauthorized rather than looping', async (context) => {
  let gets = 0;
  const f = setup(context, async (input) => {
    if (String(input).endsWith('/auth/login'))
      return json(grant('expired-access'));
    if (String(input).endsWith('/auth/refresh'))
      return json(grant('new-access'));
    return ++gets === 1
      ? json({ message: 'private ignored' }, 401)
      : json(emptyDashboard());
  });
  await login(f.client);
  await f.client.getDashboard('2026-10-12', 'Europe/Madrid');
  assert.equal(gets, 2);
  assert.equal(
    new Headers(f.fetcher.mock.calls.at(-1)!.arguments[1]?.headers).get(
      'authorization',
    ),
    'Bearer new-access',
  );
  f.fetcher.mock.mockImplementation(async () =>
    json({ message: 'private invalid refresh' }, 401),
  );
  await assert.rejects(
    f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
    (error: unknown) =>
      error instanceof ApiError &&
      error.kind === 'unauthorized' &&
      !error.message.includes('private'),
  );
});
void test('parallel expired responses do not trigger multiple rotations, including delayed old 401s', async (context) => {
  let refreshes = 0;
  const f = setup(context, async (input, init) => {
    if (String(input).endsWith('/auth/login')) return json(grant('old-access'));
    if (String(input).endsWith('/auth/refresh')) {
      refreshes++;
      return json(grant('new-access'));
    }
    return new Headers(init?.headers).get('authorization') ===
      'Bearer old-access'
      ? json({}, 401)
      : json(emptyDashboard());
  });
  await login(f.client);
  await Promise.all(
    Array.from({ length: 3 }, () =>
      f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
    ),
  );
  assert.equal(refreshes, 1);
});
void test('network/non-2xx/invalid JSON/partial data errors are sanitized, never empty successes', async (context) => {
  const f = setup(context, async () => json(grant('access')));
  await login(f.client);
  for (const implementation of [
    async () => {
      throw new Error('private network detail');
    },
    async () => json({ message: 'private SQL stack' }, 500),
    async () => new Response('invalid JSON'),
    async () => json({ week: { completedWorkouts: 0 } }),
    async () => json({ ...emptyDashboard(), weekStart: '2026-10-19' }),
  ]) {
    f.fetcher.mock.mockImplementation(implementation);
    await assert.rejects(
      f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
      (error: unknown) =>
        error instanceof ApiError &&
        !error.message.includes('private') &&
        error.cause === undefined,
    );
  }
});
void test('logout uses the backend endpoint and clears memory; the next request must authorize again', async (context) => {
  const f = setup(context, async () => json(grant('access')));
  await login(f.client);
  f.fetcher.mock.mockImplementation(async (input) =>
    String(input).endsWith('/auth/logout')
      ? new Response(null, { status: 204 })
      : json({}, 401),
  );
  await f.client.logout();
  await assert.rejects(
    f.client.getDashboard('2026-10-12', 'Europe/Madrid'),
    ApiError,
  );
  assert.ok(
    String(f.fetcher.mock.calls.at(-1)!.arguments[0]).endsWith('/auth/refresh'),
  );
});
void test('invalid configuration fails before fetch; aborted requests never refetch or expose stale data', async (context) => {
  const f = setup(context, async () => json(grant('access')));
  for (const [week, timezone] of [
    ['2026-10-13', 'UTC'],
    ['2026-10-12', 'Europe/Foo'],
    ['2026-10-12', '+02:00'],
  ] as const)
    await assert.rejects(f.client.getDashboard(week, timezone), ApiError);
  for (const url of [
    undefined,
    'javascript:alert(1)',
    'https://user:password@example.test',
    base + '?query=x',
  ])
    await assert.rejects(
      new ApiClient(url, f.fetcher).getDashboard('2026-10-12', 'UTC'),
      ApiError,
    );
  assert.equal(f.fetcher.mock.calls.length, 0);
  await login(f.client);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.client.getDashboard('2026-10-12', 'Europe/Madrid', controller.signal),
  );
  assert.equal(f.fetcher.mock.calls.length, 1);
});
