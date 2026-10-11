import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { RecordsService } from '../src/records/records.service';
import { RecordsRepository } from '../src/records/records.repository';
import { InvalidRecordsQueryError } from '../src/records/errors/invalid-records-query.error';
import { RecordsPersistenceError } from '../src/records/errors/records-persistence.error';
import {
  InMemoryRecordsRepository,
  recordsFixture,
} from './support/in-memory-records.repository';

async function setup(context: TestContext) {
  const f = recordsFixture();
  const repository = new InMemoryRecordsRepository(f.occurrences);
  const module = await Test.createTestingModule({
    providers: [
      RecordsService,
      { provide: RecordsRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return { ...f, repository, service: module.get(RecordsService) };
}

void test('current feed is empty without eligible canonical completed performance', async (context) => {
  const f = await setup(context);
  assert.deepEqual(await f.service.getCurrentRecords(randomUUID()), {
    items: [],
  });
  for (const entry of [f.first, f.second, f.later]) {
    entry.snapshot.sourceExerciseId = null;
  }
  assert.deepEqual(await f.service.getCurrentRecords(f.owner), { items: [] });
});

void test('current MAX_LOAD retains first attainment without favoring later reps, and each record uses its winning snapshot', async (context) => {
  const f = await setup(context);
  const spy = context.mock.method(f.repository, 'findCurrentRecordCandidates');
  const data = await f.service.getCurrentRecords(f.owner);
  assert.deepEqual(spy.mock.calls[0]!.arguments, [f.owner]);
  assert.equal(data.items.length, 2);
  const max = data.items.find((item) => item.type === 'MAX_LOAD')!;
  const estimated = data.items.find((item) => item.type === 'ESTIMATED_1RM')!;
  assert.equal(max.valueKg, 100);
  assert.equal(max.setEntryId, f.first.sets[1]!.setId);
  assert.equal(max.reps, 3);
  assert.equal(max.achievedAt, f.first.sets[1]!.completedAt);
  assert.equal(max.exercise.name, f.first.snapshot.exerciseName);
  assert.equal(estimated.valueKg, 116.67);
  assert.equal(estimated.exercise.name, f.later.snapshot.exerciseName);
  assert.equal(data.items[0]!.type, 'ESTIMATED_1RM');
  assert.equal(
    (await f.service.getCurrentRecords(f.other)).items[0]!.valueKg,
    200,
  );
  assert.deepEqual(Object.keys(max).sort(), [
    'achievedAt',
    'exercise',
    'loadKg',
    'reps',
    'setEntryId',
    'type',
    'valueKg',
    'workoutSessionId',
  ]);
});

void test('exact Epley ties across and within rep counts retain earliest completedAt then ascending UUID', async (context) => {
  const f = await setup(context);
  f.first.sets = [f.first.sets[0]!];
  Object.assign(f.first.sets[0]!, { loadKg: '80', reps: 15 });
  Object.assign(f.second.sets[0]!, { loadKg: '90', reps: 10 });
  Object.assign(f.later.sets[0]!, { loadKg: '80', reps: 15 });
  let estimated = (await f.service.getCurrentRecords(f.owner)).items.find(
    (item) => item.type === 'ESTIMATED_1RM',
  )!;
  assert.equal(estimated.valueKg, 120);
  assert.equal(estimated.setEntryId, f.first.sets[0]!.setId);
  const time = new Date('2026-09-10T10:00:00Z');
  for (const [index, entry] of [f.first, f.second, f.later].entries())
    Object.assign(entry.sets[0]!, {
      completedAt: time,
      setId: `00000000-0000-4000-8000-00000000000${3 - index}`,
    });
  estimated = (await f.service.getCurrentRecords(f.owner)).items.find(
    (item) => item.type === 'ESTIMATED_1RM',
  )!;
  assert.equal(estimated.setEntryId, f.later.sets[0]!.setId);
});

void test('Epley compares exact scores before rounding even when public values coincide', async (context) => {
  const f = await setup(context);
  f.first.sets = [];
  Object.assign(f.second.sets[0]!, { loadKg: '1', reps: 1 });
  Object.assign(f.later.sets[0]!, { loadKg: '0.97', reps: 2 });
  const estimated = (await f.service.getCurrentRecords(f.owner)).items.find(
    (item) => item.type === 'ESTIMATED_1RM',
  )!;
  assert.equal(estimated.valueKg, 1.03);
  assert.equal(estimated.setEntryId, f.later.sets[0]!.setId);
});

void test('bodyweight has no records, over twenty reps only MAX_LOAD, shared Decimal Epley returns 101.44', async (context) => {
  const f = await setup(context);
  f.first.sets = [f.first.sets[0]!];
  f.second.sets = f.later.sets = [];
  const set = f.first.sets[0]!;
  set.loadKg = '0';
  assert.deepEqual(await f.service.getCurrentRecords(f.owner), { items: [] });
  Object.assign(set, { loadKg: '82.25', reps: 21 });
  let data = await f.service.getCurrentRecords(f.owner);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0]!.valueKg, 82.25);
  set.reps = 7;
  data = await f.service.getCurrentRecords(f.owner);
  assert.deepEqual(
    data.items.map((item) => [
      item.type,
      item.valueKg,
      item.loadKg,
      item.setEntryId,
    ]),
    [
      ['MAX_LOAD', 82.25, 82.25, set.setId],
      ['ESTIMATED_1RM', 101.44, 82.25, set.setId],
    ],
  );
});

void test('canonical loads 80, 80.5 and 82.25 remain clean JSON numbers', async (context) => {
  const f = await setup(context);
  f.first.sets = [f.first.sets[0]!];
  f.second.sets = f.later.sets = [];
  for (const value of ['80', '80.50', '82.25']) {
    f.first.sets[0]!.loadKg = value;
    const data = await f.service.getCurrentRecords(f.owner);
    assert.equal(data.items[0]!.valueKg, Number(value));
    assert.ok(data.items.every((item) => item.loadKg === Number(value)));
    assert.equal(JSON.stringify(data).includes('Decimal'), false);
  }
});

void test('global exact-time order is canonical type, exercise UUID, set UUID, independent of repository row order', async (context) => {
  const f = await setup(context);
  const time = new Date('2026-09-10T10:00:00Z');
  f.second.sets = f.later.sets = [];
  f.first.sets = [f.first.sets[0]!];
  f.first.sets[0]!.completedAt = time;
  f.first.snapshot.sourceExerciseId = '00000000-0000-4000-8000-000000000002';
  const clone = structuredClone(f.first);
  clone.snapshot.sourceExerciseId = '00000000-0000-4000-8000-000000000001';
  clone.sets[0]!.setId = randomUUID();
  f.occurrences.push(clone);
  const data = await f.service.getCurrentRecords(f.owner, 20);
  assert.deepEqual(
    data.items.map((item) => [item.type, item.exercise.sourceExerciseId]),
    [
      ['MAX_LOAD', clone.snapshot.sourceExerciseId],
      ['MAX_LOAD', f.first.snapshot.sourceExerciseId],
      ['ESTIMATED_1RM', clone.snapshot.sourceExerciseId],
      ['ESTIMATED_1RM', f.first.snapshot.sourceExerciseId],
    ],
  );
});

void test('limit applies after deriving all current holders, never to newest sets or superseded records', async (context) => {
  const f = await setup(context);
  f.second.sets = f.later.sets = [];
  f.first.sets = [f.first.sets[0]!];
  Object.assign(f.first.sets[0]!, { loadKg: '100', reps: 5 });
  const expected: string[] = [];
  for (let index = 0; index < 6; index++) {
    const entry = structuredClone(f.first);
    entry.snapshot.sourceExerciseId = randomUUID();
    const set = entry.sets[0]!;
    set.setId = randomUUID();
    set.completedAt = new Date(Date.UTC(2026, 8, index + 10));
    expected.unshift(set.setId);
    f.occurrences.push(entry);
    // Much newer submaximal observation is not a current record/event.
    const recent = structuredClone(entry);
    Object.assign(recent.sets[0]!, {
      loadKg: '1',
      setId: randomUUID(),
      completedAt: new Date('2026-12-01T00:00:00Z'),
    });
    f.occurrences.push(recent);
  }
  const all = (await f.service.getCurrentRecords(f.owner, 20)).items;
  assert.equal(all.length, 14);
  assert.deepEqual(
    all.slice(0, 2).map((item) => item.setEntryId),
    [expected[0], expected[0]],
  );
  assert.deepEqual(
    (await f.service.getCurrentRecords(f.owner, 2)).items,
    all.slice(0, 2),
  );
  assert.equal((await f.service.getCurrentRecords(f.owner)).items.length, 5);
  assert.ok(all.every((item) => item.loadKg === 100));
});

void test('invalid limits/identity fail before repository; persistence details never become empty success', async (context) => {
  const f = await setup(context);
  const spy = context.mock.method(f.repository, 'findCurrentRecordCandidates');
  for (const limit of [0, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await assert.rejects(
      f.service.getCurrentRecords(f.owner, limit),
      InvalidRecordsQueryError,
    );
  await assert.rejects(
    f.service.getCurrentRecords('invalid'),
    InvalidRecordsQueryError,
  );
  assert.equal(spy.mock.calls.length, 0);
  spy.mock.mockImplementation(async () => {
    throw new Error('private SQL stack');
  });
  await assert.rejects(
    f.service.getCurrentRecords(f.owner),
    (error: unknown) =>
      error instanceof RecordsPersistenceError &&
      !error.message.includes('SQL') &&
      error.cause === undefined,
  );
});
