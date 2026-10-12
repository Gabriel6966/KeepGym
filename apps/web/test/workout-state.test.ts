import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authReturnPath } from '../src/features/auth/return-path';
import {
  applyServerSet,
  createSubmissionLock,
  mutationMessage,
} from '../src/features/workout/workout-state';
import {
  isWorkoutSession,
  isTemplatePage,
} from '../src/features/workout/workout.contract';
import { ApiError } from '../src/lib/api-client';
import {
  sessionFixture,
  setFixture,
  templatePage,
  sessionId,
  exerciseId,
} from './support/workout-fixture';

void test('synchronous submission lock admits exactly one mutation before render, then releases for retry', async () => {
  const lock = createSubmissionLock();
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function submit() {
    if (!lock.acquire()) return;
    try {
      calls++;
      await gate;
    } finally {
      lock.release();
    }
  }
  const first = submit();
  await submit();
  assert.equal(calls, 1);
  release();
  await first;
  await submit();
  assert.equal(calls, 2);
});
void test('set add/update uses backend positions and exact response values immutably, never recomputes indices', () => {
  const original = sessionFixture(),
    before = structuredClone(original);
  const added = applyServerSet(
    original,
    exerciseId,
    setFixture({ id: 'new', position: 7, loadKg: 0 }),
  );
  assert.deepEqual(
    added.exercises[0]!.sets.map((set) => set.position),
    [1, 7],
  );
  const edited = applyServerSet(
    added,
    exerciseId,
    setFixture({ position: 1, loadKg: 80.75 }),
  );
  assert.equal(edited.exercises[0]!.sets.length, 2);
  assert.equal(edited.exercises[0]!.sets[0]!.loadKg, 80.75);
  assert.deepEqual(original, before);
});
void test('response contract accepts snapshots/zero sets/terminal sessions and rejects missing fields', () => {
  const session = sessionFixture();
  assert.ok(isWorkoutSession(session));
  session.exercises[0]!.sets = [];
  assert.ok(isWorkoutSession(session));
  session.status = 'CANCELLED';
  session.endedAt = '2026-10-12T10:00:00Z';
  assert.ok(isWorkoutSession(session));
  assert.ok(isTemplatePage(templatePage()));
  assert.equal(
    isWorkoutSession({ ...session, exercises: [{ id: exerciseId }] }),
    false,
  );
  assert.equal(isTemplatePage({ items: [] }), false);
});
void test('auth deep links include Workout while retaining closed safe Dashboard behavior', () => {
  assert.equal(authReturnPath('/workout'), '/workout');
  assert.equal(
    authReturnPath('/workout/' + sessionId + '?userId=not-accepted'),
    '/workout/' + sessionId,
  );
  assert.equal(
    authReturnPath('/dashboard?weekStart=2026-10-12'),
    '/dashboard?weekStart=2026-10-12',
  );
  for (const value of [
    '//evil.test/workout',
    'https://evil.test/workout',
    '/workout/../../other',
    '/workout-other',
    '/workout/id/other',
    null,
  ])
    assert.equal(authReturnPath(value), '/dashboard');
});
void test('mutation copy never exposes server/stack details and warns on ambiguous network failures', () => {
  for (const error of [
    new Error('private stack'),
    new ApiError('response', 400),
    new ApiError('response', 404),
    new ApiError('response', 409),
  ])
    assert.doesNotMatch(mutationMessage(error), /private|stack|SQL/);
  assert.match(mutationMessage(new ApiError('network')), /Reload/);
});
