import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { RecordsService } from '../src/records/records.service';
import { RecordsRepository } from '../src/records/records.repository';
import { InvalidRecordsQueryError } from '../src/records/errors/invalid-records-query.error';
import {
  recordsFixture,
  InMemoryRecordsRepository,
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
void test('no completed history returns null records and metadata without a catalog lookup', async (context) => {
  const f = await setup(context);
  for (const [userId, exerciseId] of [
    [randomUUID(), f.exerciseId],
    [f.owner, randomUUID()],
  ])
    assert.deepEqual(await f.service.getExerciseRecords(userId!, exerciseId!), {
      exercise: null,
      maxLoadRecord: null,
      estimated1RMRecord: null,
    });
  f.first.status = f.second.status = f.later.status = 'CANCELLED';
  assert.deepEqual(await f.service.getExerciseRecords(f.owner, f.exerciseId), {
    exercise: null,
    maxLoadRecord: null,
    estimated1RMRecord: null,
  });
});
void test('service scopes by authenticated user and exact exercise; cancelled, active and foreign highs do not contribute', async (context) => {
  const f = await setup(context);
  const spy = context.mock.method(f.repository, 'findExerciseRecordData');
  const result = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.deepEqual(spy.mock.calls[0]?.arguments, [f.owner, f.exerciseId]);
  assert.equal(result.maxLoadRecord?.valueKg, 100);
  assert.equal(result.estimated1RMRecord?.valueKg, 116.67);
  assert.equal(result.estimated1RMRecord?.set.id, f.later.sets[0]?.setId);
  assert.equal(
    (await f.service.getExerciseRecords(f.other, f.exerciseId)).maxLoadRecord
      ?.valueKg,
    200,
  );
});
void test('MAX_LOAD keeps first achievement regardless of later reps; achievedAt is completedAt, not session time', async (context) => {
  const f = await setup(context);
  const data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.equal(data.maxLoadRecord?.set.id, f.first.sets[1]?.setId);
  assert.equal(data.maxLoadRecord?.set.reps, 3);
  assert.equal(data.maxLoadRecord?.session.id, f.first.sessionId);
  assert.equal(data.maxLoadRecord?.achievedAt, f.first.sets[1]?.completedAt);
  assert.notEqual(
    data.maxLoadRecord?.achievedAt,
    data.maxLoadRecord?.session.startedAt,
  );
  assert.equal(data.exercise?.name, f.later.snapshot.exerciseName);
});
void test('equal mathematical Epley across rep counts retains first achievement, not higher load or later time', async (context) => {
  const f = await setup(context);
  f.first.sets = [f.first.sets[0]!];
  Object.assign(f.first.sets[0]!, { loadKg: '80', reps: 15 });
  Object.assign(f.second.sets[0]!, { loadKg: '90', reps: 10 });
  Object.assign(f.later.sets[0]!, { loadKg: '80', reps: 15 });
  const data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.equal(data.estimated1RMRecord?.valueKg, 120);
  assert.equal(data.estimated1RMRecord?.set.id, f.first.sets[0]?.setId);
  assert.equal(data.maxLoadRecord?.valueKg, 90);
});
void test('equal timestamp ties use ascending set UUID, never reps/load as an extra Epley tie-break', async (context) => {
  const f = await setup(context);
  f.first.sets = [];
  const time = new Date('2026-09-09T10:00:00Z');
  Object.assign(f.second.sets[0]!, {
    loadKg: '80',
    reps: 15,
    completedAt: time,
    setId: '00000000-0000-4000-8000-000000000001',
  });
  Object.assign(f.later.sets[0]!, {
    loadKg: '90',
    reps: 10,
    completedAt: time,
    setId: '00000000-0000-4000-8000-000000000002',
  });
  assert.equal(
    (await f.service.getExerciseRecords(f.owner, f.exerciseId))
      .estimated1RMRecord?.set.id,
    f.second.sets[0]?.setId,
  );
  Object.assign(f.second.sets[0]!, { loadKg: '90', reps: 1 });
  assert.equal(
    (await f.service.getExerciseRecords(f.owner, f.exerciseId)).maxLoadRecord
      ?.set.id,
    f.second.sets[0]?.setId,
  );
});
void test('Epley ranks before rounding so an actual improvement replaces an earlier rounded-equal value', async (context) => {
  const f = await setup(context);
  f.first.sets = [];
  Object.assign(f.second.sets[0]!, { loadKg: '1', reps: 1 });
  Object.assign(f.later.sets[0]!, { loadKg: '0.97', reps: 2 });
  const data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.equal(data.estimated1RMRecord?.valueKg, 1.03);
  assert.equal(data.estimated1RMRecord?.set.id, f.later.sets[0]?.setId);
});
void test('zero loads generate neither record, over-20 reps only MAX_LOAD, and zero-set metadata remains historical', async (context) => {
  const f = await setup(context);
  for (const entry of [f.first, f.second, f.later])
    for (const set of entry.sets) set.loadKg = '0';
  let data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.equal(data.maxLoadRecord, null);
  assert.equal(data.estimated1RMRecord, null);
  assert.ok(data.exercise);
  Object.assign(f.first.sets[0]!, { loadKg: '82.25', reps: 21 });
  data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.equal(data.maxLoadRecord?.valueKg, 82.25);
  assert.equal(data.estimated1RMRecord, null);
  for (const entry of [f.first, f.second, f.later]) entry.sets = [];
  assert.equal(
    (await f.service.getExerciseRecords(f.owner, f.exerciseId)).maxLoadRecord,
    null,
  );
});
void test('shared Epley yields 101.44 and public fields are explicit numeric snapshots with no Prisma internals', async (context) => {
  const f = await setup(context);
  f.second.sets = f.later.sets = [];
  f.first.sets = [f.first.sets[0]!];
  Object.assign(f.first.sets[0]!, { loadKg: '82.25', reps: 7 });
  const data = await f.service.getExerciseRecords(f.owner, f.exerciseId);
  assert.deepEqual(data.estimated1RMRecord, {
    type: 'ESTIMATED_1RM',
    valueKg: 101.44,
    achievedAt: f.first.sets[0]!.completedAt,
    session: {
      id: f.first.sessionId,
      name: f.first.sets[0]!.sessionName,
      startedAt: f.first.startedAt,
    },
    set: {
      id: f.first.sets[0]!.setId,
      position: 1,
      loadKg: 82.25,
      reps: 7,
      rpe: 8.5,
      rir: 2,
      completedAt: f.first.sets[0]!.completedAt,
    },
  });
  assert.deepEqual(data.exercise?.secondaryMuscles, ['TRICEPS']);
  assert.notEqual(
    data.exercise?.secondaryMuscles,
    f.later.snapshot.secondaryMuscles,
  );
  for (const field of [
    'userId',
    'passwordHash',
    'sourceTemplateId',
    'updatedAt',
    'createdAt',
  ])
    assert.equal(JSON.stringify(data).includes('"' + field + '"'), false);
});
void test('service validates IDs before persistence', async (context) => {
  const f = await setup(context);
  const spy = context.mock.method(f.repository, 'findExerciseRecordData');
  await assert.rejects(
    f.service.getExerciseRecords('invalid', f.exerciseId),
    InvalidRecordsQueryError,
  );
  await assert.rejects(
    f.service.getExerciseRecords(f.owner, 'invalid'),
    InvalidRecordsQueryError,
  );
  assert.equal(spy.mock.calls.length, 0);
});
