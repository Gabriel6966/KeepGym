import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { startProgressRead } from '../src/features/progress/progress-read';
import type { TrainingCalendar } from '../src/features/history/calendar.types';
import { trainingCalendar } from './support/training-calendar-fixture';
void test('October slow read cannot replace November fast read even if transport ignores AbortSignal', async () => {
  let resolveA: (data: TrainingCalendar) => void = () => undefined,
    signalA: AbortSignal | undefined;
  const shown: TrainingCalendar[] = [],
    errors: unknown[] = [];
  const cancel = startProgressRead(
    (signal) => {
      signalA = signal;
      return new Promise<TrainingCalendar>((resolve) => {
        resolveA = resolve;
      });
    },
    (data) => shown.push(data),
    (error) => errors.push(error),
  );
  cancel();
  const november = trainingCalendar('2026-11');
  const cancelB = startProgressRead(
    async () => november,
    (data) => shown.push(data),
    (error) => errors.push(error),
  );
  await setImmediate();
  resolveA(trainingCalendar('2026-10'));
  await setImmediate();
  assert.equal(signalA?.aborted, true);
  assert.deepEqual(shown, [november]);
  assert.deepEqual(errors, []);
  cancelB();
});
