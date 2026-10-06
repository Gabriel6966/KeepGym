import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateDelta,
  calculatePercentageChange,
  compareMetric,
} from '../src/training-trends/training-trends.math';

for (const [previous, current, delta, percentageChange] of [
  [3, 4, 1, 33.33],
  [4, 3, -1, -25],
  [0, 10, 10, null],
  [0, 0, 0, null],
  [10, 0, -10, -100],
  [10, 10, 0, 0],
  [20000, 25120.5, 5120.5, 25.6],
  [1280, 1151.5, -128.5, -10.04],
  [0.29, 0.3, 0.01, 3.45],
  [0.3, 0.29, -0.01, -3.33],
  [320, 410, 90, 28.13],
  [32, 31, -1, -3.13],
] as const)
  void test(`comparison math ${previous} -> ${current}: signed delta ${delta}, percentage ${percentageChange}`, () => {
    assert.deepEqual(compareMetric(previous, current), {
      delta,
      percentageChange,
    });
    assert.equal(calculateDelta(String(previous), String(current)), delta);
    assert.equal(
      calculatePercentageChange(String(previous), String(current)),
      percentageChange,
    );
  });

void test('comparison fixed-point arithmetic stays pure, exact and finite at large reasonable totals', () => {
  const input = Object.freeze({
    previous: '10000000000.25',
    current: '10000000000.26',
  });
  for (let i = 0; i < 5; i++)
    assert.deepEqual(compareMetric(input.previous, input.current), {
      delta: 0.01,
      percentageChange: 0,
    });
  assert.equal(
    Object.is(calculatePercentageChange('10000', '9999.99'), -0),
    false,
  );
  assert.equal(input.previous, '10000000000.25');
  for (const invalid of [
    'NaN',
    'Infinity',
    '-1',
    '1.001',
    '1e2',
    '',
    ' 1 ',
    Number.NaN,
    Infinity,
  ])
    assert.throws(() => compareMetric(invalid, 1), RangeError);
  assert.throws(() => compareMetric(0, '9007199254740992'), RangeError);
  assert.throws(
    () => calculatePercentageChange('0.01', '900719925474.00'),
    RangeError,
  );
});
