import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError } from '../src/lib/api-client';
import {
  templateFixture,
  templateId,
  templatePage,
} from './support/workout-fixture';
import { catalogFixture } from './support/templates-fixture';

const base = 'https://api.example.test';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const metadata = { name: 'Push A', description: null };
const planning = {
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  restSeconds: 0,
  notes: null,
};
const entry = templateFixture().exercises[0]!,
  path = '/workout-templates/' + templateId;
const scenarios: {
  label: string;
  call: (client: ApiClient) => Promise<unknown>;
  path: string;
  method: string;
  body?: object;
  result?: unknown;
}[] = [
  {
    label: 'list real active template page',
    call: (c) => c.listWorkoutTemplates(2),
    path: '/workout-templates?page=2&limit=20',
    method: 'GET',
    result: { ...templatePage(), page: 2 },
  },
  {
    label: 'create with only real metadata fields',
    call: (c) => c.createWorkoutTemplate(metadata),
    path: '/workout-templates',
    method: 'POST',
    body: metadata,
    result: templateFixture(),
  },
  {
    label: 'get owned template detail',
    call: (c) => c.getWorkoutTemplate(templateId),
    path,
    method: 'GET',
    result: templateFixture(),
  },
  {
    label: 'patch metadata and clear nullable description',
    call: (c) => c.updateWorkoutTemplate(templateId, { description: null }),
    path,
    method: 'PATCH',
    body: { description: null },
    result: templateFixture(),
  },
  {
    label: 'archive through DELETE with 204, never fabricate archived fields',
    call: (c) => c.archiveWorkoutTemplate(templateId),
    path,
    method: 'DELETE',
  },
  {
    label:
      'catalog query safely serializes search and supported filters without isActive/userId',
    call: (c) =>
      c.listCatalogExercises({
        q: ' Bench & press ',
        primaryMuscle: 'CHEST',
        equipment: 'BARBELL',
        movementPattern: 'HORIZONTAL_PUSH',
        page: 2,
        limit: 10,
      }),
    path: '/exercises?page=2&limit=10&q=Bench+%26+press&primaryMuscle=CHEST&equipment=BARBELL&movementPattern=HORIZONTAL_PUSH',
    method: 'GET',
    result: {
      items: [catalogFixture()],
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    },
  },
  {
    label: 'add uses catalog Exercise.id and no manual position',
    call: (c) =>
      c.addTemplateExercise(templateId, {
        exerciseId: entry.exercise.id,
        ...planning,
      }),
    path: path + '/exercises',
    method: 'POST',
    body: { exerciseId: entry.exercise.id, ...planning },
    result: entry,
  },
  {
    label: 'planning patch uses WorkoutTemplateExercise.id, not Exercise.id',
    call: (c) =>
      c.updateTemplateExercise(templateId, entry.id, {
        restSeconds: 0,
        notes: null,
      }),
    path: path + '/exercises/' + entry.id,
    method: 'PATCH',
    body: { restSeconds: 0, notes: null },
    result: entry,
  },
  {
    label: 'remove uses WorkoutTemplateExercise.id and expects 204',
    call: (c) => c.removeTemplateExercise(templateId, entry.id),
    path: path + '/exercises/' + entry.id,
    method: 'DELETE',
  },
  {
    label:
      'reorder PUT uses templateExerciseIds, never Exercise ids or persisted positions',
    call: (c) => c.reorderTemplateExercises(templateId, [entry.id]),
    path: path + '/exercises/order',
    method: 'PUT',
    body: { templateExerciseIds: [entry.id] },
    result: templateFixture(),
  },
];
for (const scenario of scenarios)
  void test(scenario.label, async (context) => {
    const fetcher = context.mock.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/auth/refresh')
        ? json({ accessToken: 'memory-access', tokenType: 'Bearer' })
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
      'Bearer memory-access',
    );
    assert.deepEqual(
      init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      scenario.body,
    );
    assert.doesNotMatch(String(init?.body), /userId|position|archivedAt/);
  });
void test('all template/catalog methods share the existing single 401 retry, including PUT and 204', async (context) => {
  for (const scenario of scenarios) {
    let calls = 0,
      refreshes = 0;
    const fetcher = context.mock.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/refresh'))
        return json({
          accessToken: 'access-' + ++refreshes,
          tokenType: 'Bearer',
        });
      if (++calls === 1)
        return json({ message: 'ignored private details' }, 401);
      return scenario.result === undefined
        ? new Response(null, { status: 204 })
        : json(scenario.result);
    });
    await scenario.call(new ApiClient(base, fetcher));
    assert.equal(calls, 2);
    assert.equal(refreshes, 2);
  }
});
void test('writes never automatically replay a network/400/404/409/500 failure and errors stay sanitized', async (context) => {
  for (const scenario of scenarios.filter((item) => item.method !== 'GET')) {
    for (const status of [0, 400, 404, 409, 500]) {
      let writes = 0;
      const fetcher = context.mock.fn<typeof fetch>(async (url) => {
        if (String(url).endsWith('/auth/refresh'))
          return json({ accessToken: 'access', tokenType: 'Bearer' });
        writes++;
        if (status === 0) throw new Error('private SQL stack');
        return json({ message: 'private SQL stack' }, status);
      });
      await assert.rejects(
        scenario.call(new ApiClient(base, fetcher)),
        (error: unknown) =>
          error instanceof ApiError &&
          !error.message.includes('private') &&
          error.cause === undefined,
      );
      assert.equal(writes, 1);
    }
  }
});
void test('identity is explicitly different for add versus patch/remove/reorder', () => {
  assert.notEqual(entry.id, entry.exercise.id);
  assert.ok(
    scenarios.find(
      (item) => item.method === 'PATCH' && item.path.endsWith(entry.id),
    ),
  );
  assert.deepEqual(scenarios.at(-1)!.body, { templateExerciseIds: [entry.id] });
});
void test('default catalog pagination omits empty search; incomplete catalog/template payloads fail safely', async (context) => {
  const fetcher = context.mock.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'access', tokenType: 'Bearer' })
      : json({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
  );
  await new ApiClient(base, fetcher).listCatalogExercises({ q: ' ' });
  assert.equal(
    String(fetcher.mock.calls.at(-1)!.arguments[0]),
    base + '/exercises?page=1&limit=10',
  );
  fetcher.mock.mockImplementation(async (url) =>
    String(url).endsWith('/auth/refresh')
      ? json({ accessToken: 'access', tokenType: 'Bearer' })
      : json({
          items: [{ id: 'partial' }],
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        }),
  );
  await assert.rejects(
    new ApiClient(base, fetcher).listCatalogExercises(),
    ApiError,
  );
  await assert.rejects(
    new ApiClient(base, fetcher).getWorkoutTemplate(templateId),
    ApiError,
  );
});
