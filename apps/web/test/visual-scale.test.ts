import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeNonNegativeBars } from '../src/features/dashboard/visual-scale';

const examples: { name: string; input: number[]; widths: number[] }[] = [
  { name: 'empty scale', input: [], widths: [] },
  { name: 'both zero', input: [0, 0], widths: [0, 0] },
  { name: 'zero then positive', input: [0, 5], widths: [0, 100] },
  { name: 'positive then zero', input: [5, 0], widths: [100, 0] },
  { name: 'equal positive', input: [5, 5], widths: [100, 100] },
  { name: 'very different', input: [1, 10000], widths: [0.01, 100] },
  { name: 'decimal-compatible', input: [0.5, 1.25], widths: [40, 100] },
  {
    name: 'finite maximum does not overflow',
    input: [Number.MAX_VALUE, Number.MAX_VALUE / 2],
    widths: [100, 50],
  },
  {
    name: 'tiny value underflow is visual zero, not Infinity',
    input: [Number.MIN_VALUE, Number.MAX_VALUE],
    widths: [0, 100],
  },
];
for (const example of examples)
  void test('presentation bars: ' + example.name, () => {
    const input = Object.freeze([...example.input]);
    const actual = normalizeNonNegativeBars(input);
    assert.deepEqual(actual, example.widths);
    assert.deepEqual(input, example.input);
    assert.ok(
      actual.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      ),
    );
  });
void test('negative zero is real zero and a scale never rounds public metrics', () => {
  assert.equal(Object.is(normalizeNonNegativeBars([-0, 1])[0], -0), false);
  const input = [575.75, 1855.75],
    before = [...input];
  const result = normalizeNonNegativeBars(input);
  assert.ok(result[0] !== input[0]);
  assert.deepEqual(input, before);
});
for (const invalid of [-1, NaN, Infinity, -Infinity])
  void test(
    'non-finite/negative presentation input fails rather than becoming fake data: ' +
      invalid,
    () =>
      assert.throws(() => normalizeNonNegativeBars([0, invalid]), RangeError),
  );
