import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { ExercisesService } from '../src/exercises/exercises.service';
import { ExercisesRepository } from '../src/exercises/exercises.repository';
import { ExerciseNotFoundError } from '../src/exercises/errors/exercise-not-found.error';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutTemplatesRepository } from '../src/workout-templates/workout-templates.repository';
import { WorkoutTemplatesService } from '../src/workout-templates/workout-templates.service';
import { ExerciseAlreadyInTemplateError } from '../src/workout-templates/errors/exercise-already-in-template.error';
import { WorkoutTemplateNotFoundError } from '../src/workout-templates/errors/workout-template-not-found.error';
import { TemplateExerciseNotFoundError } from '../src/workout-templates/errors/template-exercise-not-found.error';
import { InvalidWorkoutTemplateInputError } from '../src/workout-templates/errors/invalid-workout-template-input.error';
import { WorkoutTemplatesPrismaFake } from './support/workout-templates-prisma.fake';

const targets = { targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 };

async function setup(context: TestContext) {
  const db = new WorkoutTemplatesPrismaFake();
  const module = await Test.createTestingModule({
    providers: [
      WorkoutTemplatesService,
      WorkoutTemplatesRepository,
      ExercisesService,
      { provide: PrismaService, useValue: db },
      {
        provide: ExercisesRepository,
        useValue: {
          findById: async (id: string) =>
            db.catalog.find((item) => item.id === id && item.isActive) ?? null,
        },
      },
    ],
  }).compile();
  context.after(() => module.close());
  const exercise = db.catalog[0];
  const second = db.catalog[1];
  const third = db.catalog[2];
  assert.ok(exercise && second && third);
  return {
    service: module.get(WorkoutTemplatesService),
    repository: module.get(WorkoutTemplatesRepository),
    catalog: module.get(ExercisesService),
    db,
    user: randomUUID(),
    other: randomUUID(),
    exercise,
    second,
    third,
  };
}

void test('template create trims name, delegates ownership and exposes only explicit public fields', async (context) => {
  const { service, repository, user } = await setup(context);
  const spy = context.mock.method(repository, 'createTemplate');
  const result = await service.create(user, {
    name: '  Push Day  ',
    description: null,
  });
  assert.deepEqual(spy.mock.calls[0]?.arguments, [
    user,
    { name: 'Push Day', description: null },
  ]);
  assert.deepEqual(Object.keys(result).sort(), [
    'createdAt',
    'description',
    'exercises',
    'id',
    'name',
    'updatedAt',
  ]);
  assert.equal(result.name, 'Push Day');
  assert.equal(result.description, null);
  assert.deepEqual(result.exercises, []);
  await service.create(user, { name: 'Push Day' }); // names are deliberately not unique
});

void test('template list scopes owner, searches literal case-insensitive names, paginates and excludes archived', async (context) => {
  const { service, user, other } = await setup(context);
  const a = await service.create(user, { name: 'Push A' });
  await service.create(user, { name: 'Push B' });
  await service.create(user, { name: 'Legs' });
  await service.create(other, { name: 'Push private' });
  const result = await service.list(user, { q: '  PUSH ', page: 2, limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.items.length, 1);
  await service.archive(user, a.id);
  assert.equal((await service.list(user)).total, 2);
  await assert.rejects(
    service.getById(user, a.id),
    WorkoutTemplateNotFoundError,
  );
  await assert.rejects(
    service.archive(user, a.id),
    WorkoutTemplateNotFoundError,
  );
  assert.equal((await service.list(user, { q: '%' })).total, 0);
});

void test('template get/update preserve absent description, allow null clearing and reject empty changes', async (context) => {
  const { service, user } = await setup(context);
  const a = await service.create(user, {
    name: 'Push',
    description: 'Original',
  });
  assert.equal((await service.getById(user, a.id)).description, 'Original');
  const updated = await service.update(user, a.id, { name: ' New name ' });
  assert.equal(updated.name, 'New name');
  assert.equal(updated.description, 'Original');
  assert.equal(
    (await service.update(user, a.id, { description: null })).description,
    null,
  );
  await assert.rejects(
    service.update(user, a.id, {}),
    InvalidWorkoutTemplateInputError,
  );
  await assert.rejects(
    service.getById(user, randomUUID()),
    WorkoutTemplateNotFoundError,
  );
});

void test('add checks ExercisesService, assigns sequential positions/default rest and rejects duplicate/inactive exercises', async (context) => {
  const { service, catalog, user, exercise, second, third } =
    await setup(context);
  const spy = context.mock.method(catalog, 'getById');
  const template = await service.create(user, { name: 'Push' });
  const first = await service.addExercise(user, template.id, {
    exerciseId: exercise.id,
    ...targets,
  });
  const next = await service.addExercise(user, template.id, {
    exerciseId: second.id,
    ...targets,
    restSeconds: 0,
  });
  assert.equal(first.position, 1);
  assert.equal(first.restSeconds, 90);
  assert.equal(next.position, 2);
  assert.equal(next.restSeconds, 0);
  assert.equal(spy.mock.calls.length, 2);
  assert.deepEqual(Object.keys(first).sort(), [
    'exercise',
    'id',
    'notes',
    'position',
    'restSeconds',
    'targetRepsMax',
    'targetRepsMin',
    'targetSets',
  ]);
  assert.deepEqual(Object.keys(first.exercise).sort(), [
    'equipment',
    'id',
    'isAvailable',
    'movementPattern',
    'name',
    'primaryMuscle',
    'slug',
  ]);
  await assert.rejects(
    service.addExercise(user, template.id, {
      exerciseId: exercise.id,
      ...targets,
    }),
    ExerciseAlreadyInTemplateError,
  );
  third.isActive = false;
  await assert.rejects(
    service.addExercise(user, template.id, {
      exerciseId: third.id,
      ...targets,
    }),
    ExerciseNotFoundError,
  );
  exercise.isActive = false;
  const loaded = await service.getById(user, template.id);
  assert.equal(loaded.exercises.length, 2);
  assert.equal(loaded.exercises[0]?.exercise.isAvailable, false);
});

void test('target updates validate merged rep ranges, leave omitted fields unchanged and clear notes with null', async (context) => {
  const { service, user, exercise } = await setup(context);
  const template = await service.create(user, { name: 'Push' });
  await assert.rejects(
    service.addExercise(user, template.id, {
      exerciseId: exercise.id,
      ...targets,
      targetRepsMin: 9,
    }),
    InvalidWorkoutTemplateInputError,
  );
  const entry = await service.addExercise(user, template.id, {
    exerciseId: exercise.id,
    ...targets,
    notes: 'Note',
  });
  await assert.rejects(
    service.updateExercise(user, template.id, entry.id, { targetRepsMin: 9 }),
    InvalidWorkoutTemplateInputError,
  );
  assert.equal(
    (await service.getById(user, template.id)).exercises[0]?.targetRepsMin,
    6,
  );
  const updated = await service.updateExercise(user, template.id, entry.id, {
    targetSets: 3,
    notes: null,
    restSeconds: 0,
  });
  assert.equal(updated.notes, null);
  assert.equal(updated.targetSets, 3);
  assert.equal(updated.targetRepsMax, 8);
  await assert.rejects(
    service.updateExercise(user, template.id, entry.id, {}),
    InvalidWorkoutTemplateInputError,
  );
});

void test('reorder is complete and atomic, delete compacts positions, and later add appends to the compact order', async (context) => {
  const { service, user, exercise, second, third } = await setup(context);
  const template = await service.create(user, { name: 'Push' });
  assert.deepEqual(
    (await service.reorder(user, template.id, [])).exercises,
    [],
  );
  const entries = [];
  for (const catalog of [exercise, second, third])
    entries.push(
      await service.addExercise(user, template.id, {
        exerciseId: catalog.id,
        ...targets,
      }),
    );
  const ids = entries.map((entry) => entry.id);
  const desired = [ids[2]!, ids[0]!, ids[1]!];
  const reordered = await service.reorder(user, template.id, desired);
  assert.deepEqual(
    reordered.exercises.map((entry) => entry.id),
    desired,
  );
  assert.deepEqual(
    reordered.exercises.map((entry) => entry.position),
    [1, 2, 3],
  );
  for (const invalid of [
    ids.slice(1),
    [ids[0]!, ids[0]!, ids[2]!],
    [ids[0]!, ids[1]!, randomUUID()],
  ]) {
    await assert.rejects(
      service.reorder(user, template.id, invalid),
      InvalidWorkoutTemplateInputError,
    );
    assert.deepEqual(
      (await service.getById(user, template.id)).exercises,
      reordered.exercises,
    );
  }
  await service.removeExercise(user, template.id, ids[0]!);
  const after = await service.getById(user, template.id);
  assert.deepEqual(
    after.exercises.map((entry) => entry.position),
    [1, 2],
  );
  assert.deepEqual(
    after.exercises.map((entry) => entry.id),
    [ids[2], ids[1]],
  );
  const appended = await service.addExercise(user, template.id, {
    exerciseId: exercise.id,
    ...targets,
  });
  assert.equal(appended.position, 3);
});

void test('every operation conceals templates owned by another principal; child IDs cannot cross templates', async (context) => {
  const { service, catalog, user, other, exercise } = await setup(context);
  const a = await service.create(user, { name: 'A' });
  const b = await service.create(other, { name: 'B' });
  const entry = await service.addExercise(other, b.id, {
    exerciseId: exercise.id,
    ...targets,
  });
  const before = await service.getById(other, b.id);
  const spy = context.mock.method(catalog, 'getById');
  for (const operation of [
    () => service.getById(user, b.id),
    () => service.update(user, b.id, { name: 'Attack' }),
    () => service.archive(user, b.id),
    () =>
      service.addExercise(user, b.id, { exerciseId: exercise.id, ...targets }),
    () => service.updateExercise(user, b.id, entry.id, { targetSets: 2 }),
    () => service.removeExercise(user, b.id, entry.id),
    () => service.reorder(user, b.id, [entry.id]),
  ])
    await assert.rejects(operation(), WorkoutTemplateNotFoundError);
  assert.equal(spy.mock.calls.length, 0);
  await assert.rejects(
    service.updateExercise(user, a.id, entry.id, { targetSets: 2 }),
    TemplateExerciseNotFoundError,
  );
  await assert.rejects(
    service.removeExercise(user, a.id, entry.id),
    TemplateExerciseNotFoundError,
  );
  assert.deepEqual(await service.getById(other, b.id), before);
});

void test('domain rejects invalid input even without HTTP DTO validation', async (context) => {
  const { service, user, exercise } = await setup(context);
  for (const name of ['', ' ', 'x'.repeat(121)])
    await assert.rejects(
      service.create(user, { name }),
      InvalidWorkoutTemplateInputError,
    );
  const template = await service.create(user, { name: 'Valid' });
  for (const changes of [
    { targetSets: 0 },
    { targetSets: 21 },
    { targetRepsMin: 0 },
    { targetRepsMax: 101 },
    { restSeconds: -1 },
    { restSeconds: 1801 },
    { targetSets: 1.5 },
    { notes: 'x'.repeat(501) },
  ]) {
    await assert.rejects(
      service.addExercise(user, template.id, {
        exerciseId: exercise.id,
        ...targets,
        ...changes,
      }),
      InvalidWorkoutTemplateInputError,
    );
  }
  for (const query of [
    { page: 0 },
    { limit: 101 },
    { q: ' ' },
    { page: 2147483648, limit: 100 },
  ])
    await assert.rejects(
      service.list(user, query),
      InvalidWorkoutTemplateInputError,
    );
});
