import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  exerciseId,
  sessionId,
  setId,
  templateId,
  sessionFixture,
  setFixture,
  templatePage,
} from './support/workout-fixture';

const base = 'https://api.example.test';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const setInput = { loadKg: 0, reps: 10, rpe: null, rir: null };
const sessionPath = '/workout-sessions/' + sessionId;
const setPath = sessionPath + '/exercises/' + exerciseId + '/sets';
const cases: {
  label: string;
  invoke: (client: ApiClient) => Promise<unknown>;
  path: string;
  method: string;
  body?: object;
  result?: unknown;
}[] = [
  {
    label: 'list active templates, using existing pagination',
    invoke: (c) => c.listWorkoutTemplates(),
    path: '/workout-templates?page=1&limit=20',
    method: 'GET',
    result: templatePage(),
  },
  {
    label: 'discover existing in-progress sessions',
    invoke: (c) => c.listInProgressWorkouts(),
    path: '/workout-sessions?status=IN_PROGRESS&page=1&limit=20',
    method: 'GET',
    result: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
  },
  {
    label: 'start from template without constructing snapshots',
    invoke: (c) => c.startWorkout(templateId),
    path: '/workout-sessions',
    method: 'POST',
    body: { workoutTemplateId: templateId },
    result: sessionFixture(),
  },
  {
    label: 'get complete session detail without catalog requests',
    invoke: (c) => c.getWorkoutSession(sessionId),
    path: sessionPath,
    method: 'GET',
    result: sessionFixture(),
  },
  {
    label: 'add bodyweight set without position or userId',
    invoke: (c) => c.addSet(sessionId, exerciseId, setInput),
    path: setPath,
    method: 'POST',
    body: setInput,
    result: setFixture({ loadKg: 0, reps: 10, rpe: null, rir: null }),
  },
  {
    label: 'patch set and explicitly clear optional effort fields',
    invoke: (c) =>
      c.updateSet(sessionId, exerciseId, setId, {
        loadKg: 80.25,
        rpe: null,
        rir: null,
      }),
    path: setPath + '/' + setId,
    method: 'PATCH',
    body: { loadKg: 80.25, rpe: null, rir: null },
    result: setFixture({ loadKg: 80.25, rpe: null, rir: null }),
  },
  {
    label: 'delete set with 204, not fabricated positions',
    invoke: (c) => c.deleteSet(sessionId, exerciseId, setId),
    path: setPath + '/' + setId,
    method: 'DELETE',
  },
  {
    label: 'complete through the terminal endpoint without body',
    invoke: (c) => c.completeWorkout(sessionId),
    path: sessionPath + '/complete',
    method: 'POST',
    result: {
      ...sessionFixture(),
      status: 'COMPLETED',
      endedAt: '2026-10-12T10:00:00.000Z',
    },
  },
  {
    label: 'cancel, never delete session or claim completed',
    invoke: (c) => c.cancelWorkout(sessionId),
    path: sessionPath + '/cancel',
    method: 'POST',
    result: {
      ...sessionFixture(),
      status: 'CANCELLED',
      endedAt: '2026-10-12T10:00:00.000Z',
    },
  },
];
for (const scenario of cases)
  void test(scenario.label, async (context) => {
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/login')
        ? json({ accessToken: 'memory-access', tokenType: 'Bearer' })
        : scenario.result === undefined
          ? new Response(null, { status: 204 })
          : json(scenario.result),
    );
    const client = new ApiClient(base, fetcher);
    await client.login('test@example.com', 'fixture-password');
    assert.deepEqual(await scenario.invoke(client), scenario.result);
    assert.equal(fetcher.mock.calls.length, 2);
    const [url, init] = fetcher.mock.calls[1]!.arguments;
    assert.equal(String(url), base + scenario.path);
    assert.equal(init?.method ?? 'GET', scenario.method);
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer memory-access',
    );
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store');
    assert.deepEqual(
      init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      scenario.body,
    );
    assert.doesNotMatch(String(init?.body), /userId|position|exerciseName/);
  });
void test('all workout operations reuse one refresh flow and retry a guarded 401 once', async (context) => {
  for (const scenario of cases) {
    let attempts = 0,
      refreshes = 0;
    const fetcher = context.mock.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshes++;
        return json({
          accessToken: 'rotated-' + refreshes,
          tokenType: 'Bearer',
        });
      }
      if (++attempts === 1)
        return json({ message: 'ignored private content' }, 401);
      return scenario.result === undefined
        ? new Response(null, { status: 204 })
        : json(scenario.result);
    });
    await scenario.invoke(new ApiClient(base, fetcher));
    assert.equal(attempts, 2);
    assert.equal(refreshes, 2); // Bootstrap plus expired/invalid-access recovery.
  }
});
void test('mutation failures are sanitized and never automatically retry ambiguous network errors', async (context) => {
  let mutationCalls = 0;
  const fetcher = context.mock.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/auth/refresh'))
      return json({ accessToken: 'memory-access', tokenType: 'Bearer' });
    mutationCalls++;
    throw new Error('private SQL/credential detail');
  });
  await assert.rejects(
    new ApiClient(base, fetcher).addSet(sessionId, exerciseId, setInput),
    (error: unknown) =>
      error instanceof ApiError &&
      error.kind === 'network' &&
      !error.message.includes('private'),
  );
  assert.equal(mutationCalls, 1);
});
void test('invalid full responses, foreign identifiers and 400/404/409/500 are not empty successes', async (context) => {
  for (const response of [
    json({ exercises: [] }),
    json({ ...sessionFixture(), id: 'different' }),
    ...[400, 404, 409, 500].map((status) =>
      json({ message: 'private stack detail' }, status),
    ),
  ]) {
    const client = new ApiClient(
      base,
      context.mock.fn<typeof fetch>(async (url) =>
        String(url).endsWith('/auth/refresh')
          ? json({ accessToken: 'memory-access', tokenType: 'Bearer' })
          : response,
      ),
    );
    await assert.rejects(
      client.getWorkoutSession(sessionId),
      (error: unknown) =>
        error instanceof ApiError && !error.message.includes('private'),
    );
  }
});
void test('opaque path IDs are encoded, never interpreted as additional routes/query', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'memory-access', tokenType: 'Bearer' })
      : json({ ...sessionFixture(), id: 'id/?x=1' }),
  );
  await new ApiClient(base, fetcher).getWorkoutSession('id/?x=1');
  assert.equal(
    String(fetcher.mock.calls.at(-1)!.arguments[0]),
    base + '/workout-sessions/id%2F%3Fx%3D1',
  );
});
void test('empty and dot segments cannot normalize resource requests to another endpoint', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async () => json({}));
  const client = new ApiClient(base, fetcher);
  for (const id of ['', '.', '..'])
    await assert.rejects(client.getWorkoutSession(id), ApiError);
  assert.equal(fetcher.mock.calls.length, 0);
});
