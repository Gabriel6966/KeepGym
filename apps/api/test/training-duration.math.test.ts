import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateAverageDuration,
  roundDurationSeconds,
  sumDurationSeconds,
} from '../src/training-duration/training-duration.math';

for (const [total, count, expected] of [
  ['0', 0, null],
  ['3600', 1, 3600],
  ['7200', 2, 3600],
  ['5430.500000', 1, 5430.5],
  ['16230.500000', 4, 4057.625],
  ['1000', 4, 250],
  ['0', 1, 0],
  ['1', 3, 0.333],
  ['0.001', 2, 0.001],
] as const)
  void test(`duration average ${total}/${count} = ${expected}`, () => {
    assert.equal(calculateAverageDuration(total, count), expected);
  });
void test('duration rounding uses three decimals without binary artifacts or Prisma', () => {
  assert.equal(roundDurationSeconds(0.1 + 0.2), 0.3);
  assert.equal(roundDurationSeconds('5430.500000'), 5430.5);
  assert.equal(roundDurationSeconds('1.2345'), 1.235);
  assert.equal(roundDurationSeconds('1.2344999'), 1.234);
});
void test('duration totals retain exact milliseconds and do not mutate inputs, including large accumulations', () => {
  const values = Object.freeze(['7200.000000', '3600', '5430.500000']);
  assert.equal(sumDurationSeconds(values), '16230.500');
  assert.equal(
    sumDurationSeconds(Array<string>(10000).fill('5430.501000')),
    '54305010.000',
  );
  assert.equal(sumDurationSeconds([]), '0.000');
  assert.equal(roundDurationSeconds('172800.001'), 172800.001);
});
void test('duration invalid numeric data fails rather than hiding corruption', () => {
  for (const value of ['-1', 'NaN', 'Infinity', '', '1x']) {
    assert.throws(() => roundDurationSeconds(value), RangeError);
    assert.throws(() => sumDurationSeconds([value]), RangeError);
  }
  assert.throws(() => sumDurationSeconds(['0.0001']), RangeError);
  assert.throws(() => roundDurationSeconds('9007199254740992'), RangeError);
  for (const count of [-1, 1.5, Infinity])
    assert.throws(() => calculateAverageDuration('1', count), RangeError);
});
