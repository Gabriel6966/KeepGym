import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startProgressRead } from '../src/features/progress/progress-read';
import { weeklyTraining } from './support/training-fixture';
import type { WeeklyTraining } from '../src/features/progress/training.types';

void test('slow range A cannot overwrite fast range B even when transport ignores AbortSignal', async () => {
  let resolveA: (data: WeeklyTraining) => void = () => undefined,
    signalA: AbortSignal | undefined;
  const states: WeeklyTraining[] = [],
    errors: unknown[] = [];
  const cancelA = startProgressRead(
    (signal) => {
      signalA = signal;
      return new Promise<WeeklyTraining>((resolve) => {
        resolveA = resolve;
      });
    },
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  cancelA();
  assert.equal(signalA?.aborted, true);
  const b = {
    ...weeklyTraining(),
    from: '2026-10-04T22:00:00.000Z',
    buckets: weeklyTraining().buckets.slice(1),
  };
  const cancelB = startProgressRead(
    async () => b,
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  await setImmediate();
  resolveA(weeklyTraining());
  await setImmediate();
  assert.deepEqual(states, [b]);
  assert.deepEqual(errors, []);
  cancelB();
});
void test('aborted old error cannot replace new successful range; Retry uses new GET without empty fallback', async () => {
  let rejectA: (error: unknown) => void = () => undefined;
  const states: WeeklyTraining[] = [],
    errors: unknown[] = [];
  const cancelA = startProgressRead(
    () =>
      new Promise<WeeklyTraining>((_, reject) => {
        rejectA = reject;
      }),
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  cancelA();
  startProgressRead(
    async () => weeklyTraining(),
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  rejectA(Error('late A'));
  await setImmediate();
  assert.equal(errors.length, 0);
  assert.equal(states.length, 1);
  startProgressRead<WeeklyTraining>(
    async () => {
      throw Error('safe failure');
    },
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  await setImmediate();
  assert.equal(errors.length, 1);
  assert.equal(states.length, 1);
  startProgressRead(
    async () => weeklyTraining(),
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  await setImmediate();
  assert.equal(states.length, 2);
});
