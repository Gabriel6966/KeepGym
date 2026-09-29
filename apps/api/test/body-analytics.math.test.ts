import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateChange,
  roundMetric,
} from '../src/body-analytics/body-analytics.math';

for (const [previous, latest, expected] of [
  [83.25, 82.4, -0.85],
  [15.75, 15.2, -0.55],
  [84.33, 84.33, 0],
  [82.4, 83.25, 0.85],
  [87.75, 84.5, -3.25],
  [103, 102.3, -0.7],
  [0.01, 1000, 999.99],
])
  void test(`body change ${previous} -> ${latest} = ${expected}`, () => {
    assert.equal(calculateChange(latest!, previous!), expected);
  });

void test('body math accepts decimal text/Decimal-like values without mutating inputs or importing Prisma', () => {
  const previous = Object.freeze({ toString: () => '83.25' });
  const latest = Object.freeze({ toString: () => '82.40' });
  assert.equal(calculateChange(latest, previous), -0.85);
  assert.equal(roundMetric(latest), 82.4);
  assert.equal(latest.toString(), '82.40');
});
void test('body rounding is half away from zero, removes float artifacts and never exposes negative zero', () => {
  assert.equal(roundMetric('1.005'), 1.01);
  assert.equal(roundMetric('-1.005'), -1.01);
  assert.equal(roundMetric('1.0049'), 1);
  assert.equal(roundMetric(0.1 + 0.2), 0.3);
  assert.equal(roundMetric(-0.004), 0);
  assert.equal(calculateChange('82.40', '83.25'), -0.85);
  for (const value of [82, 82.5, 82.25, 15.75, 84.33])
    assert.equal(roundMetric(value), value);
});
void test('body math rejects non-finite/invalid values and unsafe numeric precision', () => {
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    '',
    ' ',
    'invalid',
    '1e309',
    '9007199254740992',
  ])
    assert.throws(() => roundMetric(value), RangeError);
});
