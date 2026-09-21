import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { ExerciseNotFoundError } from '../src/exercises/errors/exercise-not-found.error';
import { InvalidExerciseQueryError } from '../src/exercises/errors/invalid-exercise-query.error';
import { ExercisesRepository } from '../src/exercises/exercises.repository';
import { ExercisesService } from '../src/exercises/exercises.service';
import type {
  ListExercisesInput,
  PublicExercise,
} from '../src/exercises/exercises.types';
import { InMemoryExercisesRepository } from './support/in-memory-exercises.repository';

async function setup(context: TestContext) {
  const repository = new InMemoryExercisesRepository();
  const findMany = context.mock.method(repository, 'findMany');
  const findById = context.mock.method(repository, 'findById');
  const module = await Test.createTestingModule({
    providers: [
      ExercisesService,
      { provide: ExercisesRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    service: module.get(ExercisesService),
    repository,
    findMany,
    findById,
  };
}

function assertPublic(exercise: PublicExercise) {
  assert.deepEqual(Object.keys(exercise).sort(), [
    'description',
    'equipment',
    'id',
    'instructions',
    'movementPattern',
    'name',
    'primaryMuscle',
    'secondaryMuscles',
    'slug',
  ]);
}

void test('exercise list defaults to a bounded, sorted page with correct metadata', async (context) => {
  const { service, findMany } = await setup(context);
  const result = await service.list();
  assert.deepEqual(
    {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
    { page: 1, limit: 20, total: 24, totalPages: 2 },
  );
  assert.equal(result.items.length, 20);
  assert.equal(findMany.mock.callCount(), 1);
  assert.deepEqual(
    result.items.map((item) => item.name),
    result.items.map((item) => item.name).sort((a, b) => a.localeCompare(b)),
  );
  result.items.forEach(assertPublic);
});

void test('exercise search is trimmed and finds name or slug without case sensitivity', async (context) => {
  const { service, findMany } = await setup(context);
  const nameResult = await service.list({ q: '  bEnCh  ' });
  assert.equal(findMany.mock.calls[0]?.arguments[0].q, 'bEnCh');
  assert.deepEqual(
    nameResult.items.map((exercise) => exercise.slug),
    ['barbell-bench-press'],
  );
  assert.equal((await service.list({ q: 'BARBELL-BENCH' })).total, 1);
  assert.equal((await service.list({ q: '%' })).total, 0);
});

const filters: Array<{
  name: string;
  query: ListExercisesInput;
  total: number;
}> = [
  { name: 'primary muscle', query: { primaryMuscle: 'CHEST' }, total: 3 },
  { name: 'equipment', query: { equipment: 'DUMBBELL' }, total: 6 },
  { name: 'movement pattern', query: { movementPattern: 'HINGE' }, total: 3 },
  {
    name: 'combined filters',
    query: {
      q: 'press',
      primaryMuscle: 'CHEST',
      equipment: 'DUMBBELL',
      movementPattern: 'HORIZONTAL_PUSH',
    },
    total: 1,
  },
];
for (const { name, query, total } of filters) {
  void test(`exercise service supports ${name}`, async (context) => {
    const { service, findMany } = await setup(context);
    const result = await service.list(query);
    assert.equal(result.total, total);
    const delegated = findMany.mock.calls[0]?.arguments[0];
    assert.ok(delegated);
    for (const key of [
      'q',
      'primaryMuscle',
      'equipment',
      'movementPattern',
    ] as const)
      assert.equal(delegated[key], query[key]);
  });
}

void test('exercise pagination has stable boundaries, no duplicates and empty pages retain totals', async (context) => {
  const { service } = await setup(context);
  const first = await service.list({ limit: 10 });
  const second = await service.list({ page: 2, limit: 10 });
  const third = await service.list({ page: 3, limit: 10 });
  assert.equal(second.page, 2);
  assert.equal(second.items.length, 10);
  assert.equal(third.items.length, 4);
  assert.equal(
    new Set(
      [...first.items, ...second.items, ...third.items].map(
        (exercise) => exercise.id,
      ),
    ).size,
    24,
  );
  const outside = await service.list({ page: 50, limit: 10 });
  assert.deepEqual(outside.items, []);
  assert.equal(outside.total, 24);
  assert.equal(outside.totalPages, 3);
  const empty = await service.list({ q: 'no-such-exercise' });
  assert.equal(empty.totalPages, 0);
});

void test('inactive exercises are excluded from list and detail; existing detail uses an explicit public allowlist', async (context) => {
  const { service, repository, findById } = await setup(context);
  const record = repository.records[0];
  assert.ok(record);
  const publicExercise = await service.getById(record.id);
  assertPublic(publicExercise);
  assert.equal(publicExercise.id, record.id);
  publicExercise.instructions.push(
    'This public copy must not mutate persistence.',
  );
  publicExercise.secondaryMuscles.push('CORE');
  assert.notDeepEqual(publicExercise.instructions, record.instructions);
  assert.notDeepEqual(publicExercise.secondaryMuscles, record.secondaryMuscles);
  record.isActive = false;
  assert.equal((await service.list()).total, 23);
  await assert.rejects(service.getById(record.id), ExerciseNotFoundError);
  // Also guard against a repository returning an inactive row unexpectedly.
  findById.mock.mockImplementation(async () => record);
  await assert.rejects(service.getById(record.id), ExerciseNotFoundError);
});

void test('missing exercise returns domain not-found; invalid identifiers and queries never reach persistence', async (context) => {
  const { service, findMany, findById } = await setup(context);
  await assert.rejects(service.getById(randomUUID()), ExerciseNotFoundError);
  await assert.rejects(
    service.getById('not-a-uuid'),
    InvalidExerciseQueryError,
  );
  assert.equal(findById.mock.callCount(), 1);
  for (const input of [
    { q: ' ' },
    { q: 'x'.repeat(101) },
    { page: 0 },
    { page: 1.5 },
    { limit: 0 },
    { limit: 101 },
    { page: Number.MAX_SAFE_INTEGER },
    { page: 2147483648, limit: 100 },
  ]) {
    await assert.rejects(service.list(input), InvalidExerciseQueryError);
  }
  assert.equal(findMany.mock.callCount(), 0);
});
