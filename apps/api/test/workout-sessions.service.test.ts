import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkoutSessionsRepository } from '../src/workout-sessions/workout-sessions.repository';
import { WorkoutSessionsService } from '../src/workout-sessions/workout-sessions.service';
import { EmptyWorkoutTemplateError } from '../src/workout-sessions/errors/empty-workout-template.error';
import { InvalidWorkoutSessionInputError } from '../src/workout-sessions/errors/invalid-workout-session-input.error';
import { InvalidWorkoutSessionStateError } from '../src/workout-sessions/errors/invalid-workout-session-state.error';
import { WorkoutSessionNotFoundError } from '../src/workout-sessions/errors/workout-session-not-found.error';
import { WorkoutTemplateNotFoundError } from '../src/workout-templates/errors/workout-template-not-found.error';
import {
  sourceTemplate,
  WorkoutSessionsPrismaFake,
} from './support/workout-sessions-prisma.fake';

async function setup(context: TestContext) {
  const db = new WorkoutSessionsPrismaFake();
  const user = randomUUID();
  const source = sourceTemplate(user);
  db.templates.set(source.id, source);
  const module = await Test.createTestingModule({
    providers: [
      WorkoutSessionsService,
      WorkoutSessionsRepository,
      { provide: PrismaService, useValue: db },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    db,
    user,
    source,
    service: module.get(WorkoutSessionsService),
    repository: module.get(WorkoutSessionsRepository),
  };
}

void test('start delegates a scoped atomic snapshot and returns only frozen public fields', async (context) => {
  const { user, source, service, repository } = await setup(context);
  const start = context.mock.method(repository, 'createFromTemplateSnapshot');
  const session = await service.start(user, { workoutTemplateId: source.id });
  assert.deepEqual(start.mock.calls[0]?.arguments, [user, source.id]);
  assert.deepEqual(Object.keys(session).sort(), [
    'endedAt',
    'exercises',
    'id',
    'name',
    'notes',
    'startedAt',
    'status',
  ]);
  assert.equal(session.status, 'IN_PROGRESS');
  assert.equal(session.name, source.name);
  assert.equal(session.endedAt, null);
  assert.equal(session.exercises.length, 3);
  const entry = session.exercises[0];
  assert.ok(entry);
  assert.deepEqual(Object.keys(entry).sort(), [
    'exercise',
    'id',
    'plannedNotes',
    'plannedRepsMax',
    'plannedRepsMin',
    'plannedRestSeconds',
    'plannedSets',
    'position',
  ]);
  assert.deepEqual(Object.keys(entry.exercise).sort(), [
    'equipment',
    'movementPattern',
    'name',
    'primaryMuscle',
    'secondaryMuscles',
    'slug',
    'sourceExerciseId',
  ]);
});

void test('list normalizes pagination/status, scopes ownership and returns summaries without snapshot arrays', async (context) => {
  const { db, user, source, service, repository } = await setup(context);
  const other = sourceTemplate(randomUUID());
  db.templates.set(other.id, other);
  await service.start(other.userId, { workoutTemplateId: other.id });
  const a = await service.start(user, { workoutTemplateId: source.id });
  await service.start(user, { workoutTemplateId: source.id });
  await service.complete(user, a.id);
  const list = context.mock.method(repository, 'findManyByUser');
  const result = await service.list(user, { status: 'IN_PROGRESS' });
  assert.deepEqual(list.mock.calls[0]?.arguments, [
    user,
    { status: 'IN_PROGRESS', page: 1, limit: 20 },
  ]);
  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.equal('exercises' in result.items[0]!, false);
  const second = await service.list(user, { page: 2, limit: 1 });
  assert.equal(second.total, 2);
  assert.equal(second.items.length, 1);
  assert.equal(second.totalPages, 2);
  assert.deepEqual((await service.list(user, { page: 99 })).items, []);
});

void test('get is scoped and public arrays cannot mutate stored historical metadata', async (context) => {
  const { user, source, service, repository } = await setup(context);
  const session = await service.start(user, { workoutTemplateId: source.id });
  const find = context.mock.method(repository, 'findByIdAndUser');
  const original = await service.getById(user, session.id);
  assert.deepEqual(find.mock.calls[0]?.arguments, [user, session.id]);
  const modified = await service.getById(user, session.id);
  modified.exercises[0]?.exercise.secondaryMuscles.push('CORE');
  assert.deepEqual(await service.getById(user, session.id), original);
  await assert.rejects(
    service.getById(user, randomUUID()),
    WorkoutSessionNotFoundError,
  );
});

void test('complete and cancel only allow IN_PROGRESS to terminal with endedAt; several active sessions are allowed', async (context) => {
  const { user, source, service } = await setup(context);
  const a = await service.start(user, { workoutTemplateId: source.id });
  const b = await service.start(user, { workoutTemplateId: source.id });
  assert.equal((await service.list(user, { status: 'IN_PROGRESS' })).total, 2);
  const completed = await service.complete(user, a.id);
  const cancelled = await service.cancel(user, b.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.ok(completed.endedAt instanceof Date);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.ok(cancelled.endedAt instanceof Date);
  assert.deepEqual(completed.exercises, a.exercises);
  assert.deepEqual(cancelled.exercises, b.exercises);
  for (const id of [a.id, b.id]) {
    await assert.rejects(
      service.complete(user, id),
      InvalidWorkoutSessionStateError,
    );
    await assert.rejects(
      service.cancel(user, id),
      InvalidWorkoutSessionStateError,
    );
  }
  assert.deepEqual(await service.getById(user, a.id), completed);
});

void test('empty templates and missing/archived/foreign templates are rejected without creating history', async (context) => {
  const { db, user, source, service } = await setup(context);
  const empty = sourceTemplate(user, 0);
  db.templates.set(empty.id, empty);
  await assert.rejects(
    service.start(user, { workoutTemplateId: empty.id }),
    EmptyWorkoutTemplateError,
  );
  await assert.rejects(
    service.start(randomUUID(), { workoutTemplateId: source.id }),
    WorkoutTemplateNotFoundError,
  );
  source.archivedAt = new Date();
  for (const id of [source.id, randomUUID()])
    await assert.rejects(
      service.start(user, { workoutTemplateId: id }),
      WorkoutTemplateNotFoundError,
    );
  assert.equal(db.sessions.size, 0);
});

void test('foreign sessions are concealed for get/complete/cancel without changing their state', async (context) => {
  const { user, source, service } = await setup(context);
  const session = await service.start(user, { workoutTemplateId: source.id });
  const other = randomUUID();
  for (const operation of [
    () => service.getById(other, session.id),
    () => service.complete(other, session.id),
    () => service.cancel(other, session.id),
  ])
    await assert.rejects(operation(), WorkoutSessionNotFoundError);
  assert.deepEqual(await service.getById(user, session.id), session);
});

void test('service validates UUIDs and pagination independently of HTTP DTOs', async (context) => {
  const { user, source, service, repository } = await setup(context);
  const start = context.mock.method(repository, 'createFromTemplateSnapshot');
  await assert.rejects(
    service.start(user, { workoutTemplateId: 'invalid' }),
    InvalidWorkoutSessionInputError,
  );
  await assert.rejects(
    service.start('invalid', { workoutTemplateId: source.id }),
    InvalidWorkoutSessionInputError,
  );
  assert.equal(start.mock.calls.length, 0);
  for (const query of [
    { page: 0 },
    { limit: 0 },
    { limit: 101 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER, limit: 100 },
  ])
    await assert.rejects(
      service.list(user, query),
      InvalidWorkoutSessionInputError,
    );
  for (const operation of [
    () => service.getById(user, 'invalid'),
    () => service.complete(user, 'invalid'),
    () => service.cancel(user, 'invalid'),
  ])
    await assert.rejects(operation(), InvalidWorkoutSessionInputError);
});
