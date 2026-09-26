import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../src/generated/prisma/client';
import {
  calculateSetVolume,
  calculateEstimated1RM,
  estimated1RMScore,
  roundMetric,
  sumSetVolumes,
} from '../src/analytics/analytics.math';

for (const [load, reps, expected] of [
  [80, 8, 640],
  [80.5, 8, 644],
  [82.25, 7, 575.75],
  [0, 100, 0],
])
  void test(`volume ${load} x ${reps} = ${expected}`, () =>
    assert.equal(calculateSetVolume(load!, reps!), expected));
void test('Epley rounds 82.25 x 7 to 101.44, with inclusive rep boundaries', () => {
  assert.equal(calculateEstimated1RM('82.25', 7), 101.44);
  assert.equal(calculateEstimated1RM(60, 1), 62);
  assert.equal(calculateEstimated1RM(60, 20), 100);
});
void test('Epley excludes zero/negative load and ineligible repetitions without returning a misleading zero', () => {
  for (const [load, reps] of [
    [0, 8],
    [-1, 8],
    [80, 0],
    [80, 21],
    [80, 1000],
    [80, 1.5],
  ])
    assert.equal(calculateEstimated1RM(load!, reps!), null);
});
void test('decimal arithmetic is pure, deterministic and exact for large reasonable sums', () => {
  const sets = Object.freeze([
    Object.freeze({ loadKg: 80, reps: 8 }),
    Object.freeze({ loadKg: 80, reps: 8 }),
    Object.freeze({ loadKg: new Prisma.Decimal('82.25'), reps: 7 }),
  ]);
  assert.equal(sumSetVolumes(sets), 1855.75);
  assert.equal(sumSetVolumes(sets), 1855.75);
  assert.equal(
    sumSetVolumes(
      Array.from({ length: 10000 }, () => ({ loadKg: '82.25', reps: 7 })),
    ),
    5757500,
  );
  assert.equal(roundMetric('1.005'), 1.01);
  assert.equal(roundMetric(1855.7499999997), 1855.75);
  assert.equal(sets[2]!.loadKg.toString(), '82.25');
  assert.throws(() => roundMetric('9007199254740991'), RangeError);
});
void test('ranking retains unrounded Epley values and exact cross-rep ties', () => {
  assert.equal(
    estimated1RMScore(80, 15)!.comparedTo(estimated1RMScore(90, 10)!),
    0,
  );
  assert.equal(calculateEstimated1RM(1, 1), calculateEstimated1RM(0.97, 2));
  assert.ok(estimated1RMScore(0.97, 2)!.gt(estimated1RMScore(1, 1)!));
});
