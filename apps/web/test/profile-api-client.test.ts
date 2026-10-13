import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import { profileFixture } from './support/profile-fixture';

const base = 'https://api.example.test';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const grant = { accessToken: 'memory-test-token', tokenType: 'Bearer' };
const missing = {
  statusCode: 404,
  message: 'Profile not found.',
  error: 'Not Found',
};
void test('register uses exact existing endpoint/cookie contract and memory token for deliberate Profile check', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
    String(input).endsWith('/auth/register')
      ? json(grant, 201)
      : json(missing, 404),
  );
  const client = new ApiClient(base, fetcher);
  await client.register('user@example.com', 'a'.repeat(15));
  assert.equal(await client.getProfile(), null);
  assert.equal(fetcher.mock.calls.length, 2);
  const [url, init] = fetcher.mock.calls[0]!.arguments;
  assert.equal(String(url), base + '/auth/register');
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    email: 'user@example.com',
    password: 'a'.repeat(15),
  });
  assert.equal(
    new Headers(fetcher.mock.calls[1]!.arguments[1]?.headers).get(
      'authorization',
    ),
    'Bearer memory-test-token',
  );
  for (const call of fetcher.mock.calls) {
    assert.equal(call.arguments[1]?.credentials, 'include');
    assert.equal(call.arguments[1]?.cache, 'no-store');
  }
});
const operations: {
  name: string;
  call: (c: ApiClient) => Promise<unknown>;
  method: string;
  body?: object;
}[] = [
  { name: 'GET own Profile', call: (c) => c.getProfile(), method: 'GET' },
  {
    name: 'POST required name only',
    call: (c) => c.createProfile({ displayName: 'Name' }),
    method: 'POST',
    body: { displayName: 'Name' },
  },
  {
    name: 'POST all real fields',
    call: (c) =>
      c.createProfile({
        displayName: 'Name',
        birthDate: '1995-04-10',
        heightCm: 180,
        experienceLevel: 'ADVANCED',
        trainingGoal: 'STRENGTH',
        unitSystem: 'IMPERIAL',
      }),
    method: 'POST',
    body: {
      displayName: 'Name',
      birthDate: '1995-04-10',
      heightCm: 180,
      experienceLevel: 'ADVANCED',
      trainingGoal: 'STRENGTH',
      unitSystem: 'IMPERIAL',
    },
  },
  {
    name: 'PATCH preserves omitted fields and clears nullable values',
    call: (c) => c.updateProfile({ birthDate: null, trainingGoal: null }),
    method: 'PATCH',
    body: { birthDate: null, trainingGoal: null },
  },
];
for (const operation of operations)
  void test(
    operation.name + ' reuses auth without userId or other-domain requests',
    async (context) => {
      const fetcher = context.mock.fn<typeof fetch>(async (input) =>
        String(input).endsWith('/auth/refresh')
          ? json(grant)
          : json(profileFixture()),
      );
      const client = new ApiClient(base, fetcher);
      assert.deepEqual(await operation.call(client), profileFixture());
      assert.equal(fetcher.mock.calls.length, 2);
      const [url, init] = fetcher.mock.calls[1]!.arguments;
      assert.equal(String(url), base + '/profile');
      assert.equal(init?.method ?? 'GET', operation.method);
      assert.deepEqual(
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        operation.body,
      );
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer memory-test-token',
      );
    },
  );
void test('only domain-specific Profile 404 means missing; generic404/network/500 remain errors', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('user@example.com', 'a'.repeat(15));
  fetcher.mock.mockImplementation(async () => json(missing, 404));
  assert.equal(await client.getProfile(), null);
  for (const response of [
    () => json({ message: 'Cannot GET /profile', statusCode: 404 }, 404),
    () => json({ message: 'private SQL stack' }, 500),
    () => new Response('not JSON', { status: 404 }),
    () => json({ displayName: 'partial' }),
    () => {
      throw new Error('private network');
    },
  ]) {
    fetcher.mock.mockImplementation(async () => response());
    await assert.rejects(
      client.getProfile(),
      (error: unknown) =>
        error instanceof ApiError &&
        !error.message.includes('private') &&
        error.cause === undefined,
    );
  }
});
void test('Profile 401 uses one existing refresh/retry and invalid session cannot become missing', async (context) => {
  let gets = 0;
  const fetcher = context.mock.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/auth/login') ||
      String(input).endsWith('/auth/refresh')
        ? json(grant)
        : ++gets === 1
          ? json({}, 401)
          : json(profileFixture()),
    ),
    client = new ApiClient(base, fetcher);
  await client.login('user@example.com', 'a'.repeat(15));
  await client.getProfile();
  assert.equal(gets, 2);
  assert.equal(
    fetcher.mock.calls.filter((call) =>
      String(call.arguments[0]).endsWith('/auth/refresh'),
    ).length,
    1,
  );
  fetcher.mock.mockImplementation(async () => json({}, 401));
  await assert.rejects(
    client.getProfile(),
    (error: unknown) =>
      error instanceof ApiError && error.kind === 'unauthorized',
  );
});
void test('POST/PATCH ambiguous network/JSON failures never replay; conflict stays sanitized', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher);
  await client.login('user@example.com', 'a'.repeat(15));
  for (const operation of [
    () => client.register('user@example.com', 'a'.repeat(15)),
    () => client.createProfile({ displayName: 'Name' }),
    () => client.updateProfile({ heightCm: 181 }),
  ]) {
    for (const failure of [
      () => {
        throw new Error('private network');
      },
      () => new Response('bad JSON'),
      () => json({ message: 'private database' }, 409),
    ]) {
      fetcher.mock.mockImplementation(async () => failure());
      const before = fetcher.mock.calls.length;
      await assert.rejects(operation(), ApiError);
      assert.equal(fetcher.mock.calls.length, before + 1);
    }
  }
});
void test('Profile read cancellation propagates without refresh/fetch or stale application', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json(grant)),
    client = new ApiClient(base, fetcher),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getProfile(controller.signal));
  assert.equal(fetcher.mock.calls.length, 0);
});
