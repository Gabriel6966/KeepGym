import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  setDraft,
  validateSetDraft,
} from '../src/features/workout/set-form.validation';
import { setFixture } from './support/workout-fixture';

void test('bodyweight zero is valid; optional effort is null, not forced', () =>
  assert.deepEqual(
    validateSetDraft({ loadKg: '0', reps: '10', rpe: '', rir: '' }),
    { input: { loadKg: 0, reps: 10, rpe: null, rir: null } },
  ));
void test('complete decimal parsing accepts comma or dot, without rounding/truncation', () => {
  for (const loadKg of ['82.25', '82,25'])
    assert.deepEqual(
      validateSetDraft({ loadKg, reps: '7', rpe: '8,5', rir: '0' }),
      { input: { loadKg: 82.25, reps: 7, rpe: 8.5, rir: 0 } },
    );
  assert.ok(
    validateSetDraft({ loadKg: '82.251', reps: '7', rpe: '', rir: '' }).errors
      ?.loadKg,
  );
});
void test('exact backend boundaries, not planned sets/reps, govern obvious input checks', () => {
  assert.ok(
    validateSetDraft({ loadKg: '10000', reps: '1000', rpe: '10', rir: '10' })
      .input,
  );
  assert.ok(
    validateSetDraft({ loadKg: '0', reps: '1', rpe: '1', rir: '0' }).input,
  );
});
for (const [field, values] of [
  [
    'loadKg',
    ['', '-1', '10000.01', '1e2', '1.000', '1,2,3', 'Infinity', 'NaN'],
  ],
  ['reps', ['', '0', '-1', '1001', '1.5', '1e2', 'abc']],
  ['rpe', ['0', '10.5', '8.2', '-1', '8.50', 'abc']],
  ['rir', ['-1', '11', '1.5', 'abc']],
] as const)
  void test(field + ' rejects malformed/out-of-contract strings', () => {
    for (const value of values)
      assert.ok(
        validateSetDraft({
          loadKg: '80',
          reps: '8',
          rpe: '',
          rir: '',
          [field]: value,
        }).errors?.[field],
        value,
      );
  });
void test('editing preserves exact values; clearing optional fields sends null', () => {
  assert.deepEqual(setDraft(setFixture()), {
    loadKg: '82.25',
    reps: '7',
    rpe: '8.5',
    rir: '2',
  });
  assert.deepEqual(setDraft(setFixture({ loadKg: 0, rpe: null, rir: null })), {
    loadKg: '0',
    reps: '7',
    rpe: '',
    rir: '',
  });
});
