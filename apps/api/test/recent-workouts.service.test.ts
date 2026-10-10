import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { HistoryRepository } from '../src/history/history.repository';
import { HistoryService } from '../src/history/history.service';
import { HistoryPersistenceError } from '../src/history/errors/history-persistence.error';
import { InvalidHistoryQueryError } from '../src/history/errors/invalid-history-query.error';
import type { RecentWorkoutRecord } from '../src/history/history.types';
import {
  historyFixture,
  InMemoryHistoryRepository,
} from './support/in-memory-history.repository';

async function setup(context: TestContext) {
  const f = historyFixture(),
    repository = new InMemoryHistoryRepository(f.records);
  const read = context.mock.method(repository, 'findRecentCompletedWorkouts');
  const module = await Test.createTestingModule({
    providers: [
      HistoryService,
      { provide: HistoryRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, read, service: module.get(HistoryService) };
}
void test('recent empty history, default limit and authenticated ownership contract', async (context) => {
  const f = await setup(context),
    emptyOwner = randomUUID();
  assert.deepEqual(await f.service.getRecentCompletedWorkouts(emptyOwner), {
    items: [],
  });
  assert.deepEqual(f.read.mock.calls[0]!.arguments, [emptyOwner, 5]);
  assert.deepEqual(
    (await f.service.getRecentCompletedWorkouts(f.other)).items.map(
      (s) => s.id,
    ),
    [f.foreign.session.id],
  );
});
void test('recent canonical ordering, explicit limit and completed-only data keep historical names and totals', async (context) => {
  const f = await setup(context);
  const result = await f.service.getRecentCompletedWorkouts(f.owner, {
    limit: 20,
  });
  assert.deepEqual(
    result.items.map((s) => s.id),
    [f.completed.session.id, f.older.session.id],
  );
  const item = result.items[0]!;
  assert.deepEqual(item, {
    id: f.completed.session.id,
    name: f.completed.session.name,
    startedAt: f.completed.session.startedAt,
    endedAt: f.completed.session.endedAt,
    durationSeconds: 3600,
    completedSets: 6,
    totalReps: 48,
    totalVolumeKg: 3884,
  });
  assert.deepEqual(
    (await f.service.getRecentCompletedWorkouts(f.owner, { limit: 1 })).items,
    [item],
  );
  assert.equal(typeof item.totalVolumeKg, 'number');
});
void test('recent zero-set workouts survive and fractional/zero durations remain exact', async (context) => {
  const f = await setup(context);
  f.completed.session.exercises = [];
  f.completed.session.endedAt = new Date(
    f.completed.session.startedAt.getTime() + 3600500,
  );
  let item = (await f.service.getRecentCompletedWorkouts(f.owner, { limit: 1 }))
    .items[0]!;
  assert.deepEqual(
    [
      item.completedSets,
      item.totalReps,
      item.totalVolumeKg,
      item.durationSeconds,
    ],
    [0, 0, 0, 3600.5],
  );
  f.completed.session.endedAt = f.completed.session.startedAt;
  item = (await f.service.getRecentCompletedWorkouts(f.owner, { limit: 1 }))
    .items[0]!;
  assert.equal(item.durationSeconds, 0);
});
void test('recent bodyweight counts sets/reps while external volume stays zero', async (context) => {
  const f = await setup(context);
  for (const exercise of f.completed.session.exercises)
    for (const set of exercise.sets) set.loadKg = set.loadKg.times(0);
  const item = (await f.service.getRecentCompletedWorkouts(f.owner)).items[0]!;
  assert.deepEqual(
    [item.completedSets, item.totalReps, item.totalVolumeKg],
    [6, 48, 0],
  );
});
void test('recent limit and principal validation precede any persistence read', async (context) => {
  const f = await setup(context);
  for (const limit of [0, -1, 21, 1.5, NaN, Infinity])
    await assert.rejects(
      f.service.getRecentCompletedWorkouts(f.owner, { limit }),
      InvalidHistoryQueryError,
    );
  await assert.rejects(
    f.service.getRecentCompletedWorkouts('invalid'),
    InvalidHistoryQueryError,
  );
  assert.equal(f.read.mock.calls.length, 0);
});
void test('recent corrupt null/negative duration and unsafe aggregates fail safely without empty or partial success', async (context) => {
  const f = await setup(context);
  const original = (await f.read(f.owner, 1))[0]!;
  const invalid: Partial<RecentWorkoutRecord>[] = [
    { endedAt: null },
    { durationSeconds: null },
    { endedAt: new Date(original.startedAt.getTime() - 1) },
    { durationSeconds: '-0.001' },
    { durationSeconds: '0.0001' },
    { completedSets: '9007199254740992' },
    { totalReps: '-1' },
    { totalVolumeKg: 'NaN' },
    { totalVolumeKg: '-1' },
  ];
  for (const override of invalid) {
    f.read.mock.mockImplementationOnce(async () => [
      original,
      { ...original, ...override },
    ]);
    await assert.rejects(
      f.service.getRecentCompletedWorkouts(f.owner),
      HistoryPersistenceError,
    );
  }
  f.read.mock.mockImplementationOnce(async () => {
    throw new Error('private SQL');
  });
  await assert.rejects(
    f.service.getRecentCompletedWorkouts(f.owner),
    (error: unknown) =>
      error instanceof HistoryPersistenceError &&
      error.message === 'Unable to read workout history.' &&
      error.cause === undefined,
  );
});
