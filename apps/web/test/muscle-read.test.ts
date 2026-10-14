import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startProgressRead } from '../src/features/progress/progress-read';
import { muscleWeeks } from './support/muscle-fixture';
import type { WeeklyMuscleGroups } from '../src/features/progress/muscle.types';
void test('slow muscle range A cannot replace fast B even when transport ignores cancellation', async () => {
  let resolveA: (value: WeeklyMuscleGroups) => void = () => undefined,
    signalA: AbortSignal | undefined;
  const states: WeeklyMuscleGroups[] = [],
    errors: unknown[] = [];
  const cancelA = startProgressRead(
    (signal) => {
      signalA = signal;
      return new Promise<WeeklyMuscleGroups>((resolve) => {
        resolveA = resolve;
      });
    },
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  cancelA();
  const b = { ...muscleWeeks(), buckets: muscleWeeks().buckets.slice(1) };
  const cancelB = startProgressRead(
    async () => b,
    (data) => states.push(data),
    (error) => errors.push(error),
  );
  await setImmediate();
  resolveA(muscleWeeks());
  await setImmediate();
  assert.equal(signalA?.aborted, true);
  assert.deepEqual(states, [b]);
  assert.deepEqual(errors, []);
  cancelB();
});
