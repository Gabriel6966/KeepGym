import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { HistoryRepository } from '../src/history/history.repository';
import { HistoryService } from '../src/history/history.service';
import { InvalidHistoryQueryError } from '../src/history/errors/invalid-history-query.error';
import { WorkoutHistoryNotFoundError } from '../src/history/errors/workout-history-not-found.error';
import type {
  HistoryQueryInput,
  WorkoutHistoryQueryInput,
} from '../src/history/history.types';
import { historyTimestamp } from '../src/history/history.validation';
import {
  historyFixture,
  InMemoryHistoryRepository,
} from './support/in-memory-history.repository';

async function setup(context: TestContext) {
  const fixture = historyFixture();
  const repository = new InMemoryHistoryRepository(fixture.records);
  const module = await Test.createTestingModule({
    providers: [
      HistoryService,
      { provide: HistoryRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...fixture, repository, service: module.get(HistoryService) };
}

void test('history defaults to both terminal states, scopes ownership and exposes simple counts without operational data', async (context) => {
  const f = await setup(context);
  const call = context.mock.method(f.repository, 'findWorkoutHistory');
  const result = await f.service.listWorkouts(f.owner);
  assert.equal(result.total, 3);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [f.cancelled.session.id, f.completed.session.id, f.older.session.id],
  );
  assert.deepEqual(
    result.items.map((item) => [item.exerciseCount, item.setCount]),
    [
      [2, 2],
      [2, 6],
      [2, 6],
    ],
  );
  assert.deepEqual(Object.keys(result.items[0]!).sort(), [
    'endedAt',
    'exerciseCount',
    'id',
    'name',
    'setCount',
    'startedAt',
    'status',
  ]);
  assert.deepEqual(call.mock.calls[0]?.arguments, [
    f.owner,
    {
      page: 1,
      limit: 20,
      status: undefined,
      from: undefined,
      to: undefined,
      q: undefined,
    },
  ]);
  assert.equal(result.totalPages, 1);
});

void test('history supports individual states, normalized literal search, inclusive timezone dates and pagination', async (context) => {
  const f = await setup(context);
  assert.equal(
    (await f.service.listWorkouts(f.owner, { status: 'COMPLETED' })).total,
    2,
  );
  assert.equal(
    (await f.service.listWorkouts(f.owner, { status: 'CANCELLED' })).items[0]
      ?.id,
    f.cancelled.session.id,
  );
  const call = context.mock.method(f.repository, 'findWorkoutHistory');
  const input = {
    q: '  pUSH 50%_\\  ',
    from: '2026-09-20T12:00:00+02:00',
    to: '2026-09-20T10:00:00Z',
  };
  const result = await f.service.listWorkouts(f.owner, input);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [f.completed.session.id],
  );
  assert.equal(call.mock.calls[0]?.arguments[1].q, 'pUSH 50%_\\');
  assert.equal(
    call.mock.calls[0]?.arguments[1].from?.toISOString(),
    '2026-09-20T10:00:00.000Z',
  );
  const page = await f.service.listWorkouts(f.owner, { page: 2, limit: 1 });
  assert.equal(page.items[0]?.id, f.completed.session.id);
  assert.equal(page.totalPages, 3);
  assert.equal(
    (await f.service.listWorkouts(f.owner, { q: 'no match' })).totalPages,
    0,
  );
  assert.deepEqual(
    (await f.service.listWorkouts(f.owner, { page: 99 })).items,
    [],
  );
});

void test('historical detail retains completed/cancelled sets, planned data and ordered explicit snapshots', async (context) => {
  const f = await setup(context);
  for (const record of [f.completed, f.cancelled]) {
    const detail = await f.service.getWorkout(f.owner, record.session.id);
    assert.equal(detail.status, record.session.status);
    assert.equal(detail.notes, 'Historical notes');
    assert.deepEqual(
      detail.exercises.map((entry) => entry.position),
      [1, 2],
    );
    const entry = detail.exercises[0]!;
    assert.equal(entry.exercise.name, 'Original Bench');
    assert.equal(entry.plannedSets, 4);
    assert.deepEqual(
      entry.sets.map((set) => set.position),
      record === f.cancelled ? [1] : [1, 2, 3],
    );
    assert.deepEqual(
      entry.sets.map((set) => set.loadKg),
      record === f.cancelled ? [80] : [80, 80.5, 82.25],
    );
    assert.equal('userId' in detail, false);
    assert.equal('sourceTemplateId' in detail, false);
    assert.deepEqual(Object.keys(entry.sets[0]!).sort(), [
      'completedAt',
      'id',
      'loadKg',
      'position',
      'reps',
      'rir',
      'rpe',
    ]);
    if (record === f.completed) assert.equal(entry.sets[2]?.rpe, 8.5);
  }
  for (const id of [f.active.session.id, f.foreign.session.id, randomUUID()])
    await assert.rejects(
      f.service.getWorkout(f.owner, id),
      WorkoutHistoryNotFoundError,
    );
});

void test('exercise history defaults to completed, supports cancelled and limit=1 yields latest matching occurrence', async (context) => {
  const f = await setup(context);
  const call = context.mock.method(f.repository, 'findExerciseHistory');
  const result = await f.service.getExerciseHistory(f.owner, f.exerciseId, {
    limit: 1,
  });
  assert.equal(result.items[0]?.sessionId, f.completed.session.id);
  assert.equal(result.items[0]?.sessionStatus, 'COMPLETED');
  assert.equal(result.items[0]?.sets[2]?.loadKg, 82.25);
  assert.equal(result.total, 2);
  assert.equal(call.mock.calls[0]?.arguments[2].status, 'COMPLETED');
  assert.equal(call.mock.calls[0]?.arguments[0], f.owner);
  const cancelled = await f.service.getExerciseHistory(f.owner, f.exerciseId, {
    status: 'CANCELLED',
  });
  assert.equal(cancelled.items[0]?.sessionId, f.cancelled.session.id);
  assert.equal(cancelled.items[0]?.sets.length, 1);
  const dated = await f.service.getExerciseHistory(f.owner, f.exerciseId, {
    to: '2026-09-19T10:00:00Z',
  });
  assert.equal(dated.items[0]?.sessionId, f.older.session.id);
  assert.equal(
    (await f.service.getExerciseHistory(f.other, f.exerciseId)).items[0]
      ?.sessionId,
    f.foreign.session.id,
  );
  assert.deepEqual(await f.service.getExerciseHistory(f.owner, randomUUID()), {
    items: [],
    total: 0,
    totalPages: 0,
    page: 1,
    limit: 20,
  });
});

void test('nullable source IDs never lose the snapshot or infer identity from slug; empty occurrences remain descriptive', async (context) => {
  const f = await setup(context);
  const entry = f.completed.session.exercises.find(
    (item) => item.sourceExerciseId === f.exerciseId,
  )!;
  entry.sourceExerciseId = null;
  entry.sets = [];
  const detail = await f.service.getWorkout(f.owner, f.completed.session.id);
  assert.equal(detail.exercises[0]?.exercise.sourceExerciseId, null);
  assert.equal(detail.exercises[0]?.exercise.name, 'Original Bench');
  assert.deepEqual(detail.exercises[0]?.sets, []);
  assert.equal(
    (await f.service.getExerciseHistory(f.owner, f.exerciseId)).total,
    1,
  );
  entry.sourceExerciseId = f.exerciseId;
  assert.equal(
    (await f.service.getExerciseHistory(f.owner, f.exerciseId)).items[0]?.sets
      .length,
    0,
  );
});

void test('history DTO-independent rules reject invalid status, pagination, reversed and ambiguous dates', async (context) => {
  const f = await setup(context);
  const invalid: unknown[] = [
    { status: 'IN_PROGRESS' },
    { status: null },
    { page: 0 },
    { page: '1' },
    { page: 1.5 },
    { limit: 0 },
    { limit: 101 },
    { limit: null },
    { page: 2147483648, limit: 100 },
    { from: '2026-09-21T00:00:00Z', to: '2026-09-20T00:00:00Z' },
    { from: '2026-02-31T00:00:00Z' },
    { from: '2026-09-20T00:00:00' },
    { from: '2026-09-20' },
    { from: null },
    { from: new Date() },
    { to: '' },
  ];
  for (const input of invalid) {
    await assert.rejects(
      f.service.listWorkouts(f.owner, input as WorkoutHistoryQueryInput),
      InvalidHistoryQueryError,
    );
    await assert.rejects(
      f.service.getExerciseHistory(
        f.owner,
        f.exerciseId,
        input as HistoryQueryInput,
      ),
      InvalidHistoryQueryError,
    );
  }
  for (const q of ['', '  ', 'x'.repeat(101), null, 4])
    await assert.rejects(
      f.service.listWorkouts(f.owner, { q } as WorkoutHistoryQueryInput),
      InvalidHistoryQueryError,
    );
  await assert.rejects(
    f.service.getWorkout('invalid', f.completed.session.id),
    InvalidHistoryQueryError,
  );
});

void test('timestamp validation rejects rollover/calendar/timezone ambiguity without normalizing it silently', () => {
  for (const value of [
    '2026-02-29T00:00:00Z',
    '2100-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-09-00T00:00:00Z',
    '2026-09-01T24:00:00Z',
    '2026-09-01T00:60:00Z',
    '2026-09-01T00:00:60Z',
    '2026-09-01T00:00:00+24:00',
    '2026-09-01T00:00:00+02:60',
    '2026-09-01T00:00:00.1234Z',
    '2026-09-01 00:00:00Z',
    '0000-01-01T00:00:00Z',
    '0001-01-01T00:00:00+01:00',
    '9999-12-31T23:59:59-01:00',
    '2026-09-01T00:00:00+0200',
    ' 2026-09-01T00:00:00Z',
    ['2026-09-01T00:00:00Z'],
  ])
    assert.equal(historyTimestamp(value), null);
  for (const value of [
    '2024-02-29T00:00:00Z',
    '2000-02-29T00:00:00.123Z',
    '2026-09-01t00:00:00z',
    '2026-09-01T12:00:00-05:30',
  ])
    assert.ok(historyTimestamp(value));
});
