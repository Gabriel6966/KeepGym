import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatDate,
  formatDuration,
  formatKg,
  formatNumber,
  formatPercentage,
  formatSignedNumber,
  formatWeekRange,
} from '../src/features/dashboard/format';

void test('duration presentation preserves null versus zero and formats canonical seconds without mutating data', () => {
  assert.equal(formatDuration(null, 'en-US'), '—');
  assert.equal(formatDuration(0, 'en-US'), '0s');
  assert.equal(formatDuration(9300.5, 'en-US'), '2h 35m');
  assert.equal(formatDuration(2325.125, 'en-US'), '38m');
  assert.equal(formatDuration(30.5, 'en-US'), '30.5s');
  assert.equal(formatDuration(3600, 'en-US'), '1h 0m');
});
void test('canonical kg and factual signed percentages use locale formatting with explicit nulls', () => {
  assert.equal(formatKg(1855.75, 'en-US'), '1,855.75 kg');
  assert.equal(formatKg(1855.75, 'es-ES'), '1855,75 kg');
  assert.equal(formatKg(null), '—');
  assert.equal(formatNumber(null), '—');
  assert.equal(formatSignedNumber(-0.85, 'en-US'), '-0.85');
  assert.equal(formatSignedNumber(1, 'en-US'), '+1');
  assert.equal(formatPercentage(null), '—');
  assert.equal(formatPercentage(-100, 'en-US'), '-100%');
  assert.equal(formatPercentage(0, 'en-US'), '0%');
});
void test('date and week-range presentation keep DATE-only dates separate from observation instants', () => {
  assert.equal(
    formatDate('2026-10-11T22:30:00Z', 'Europe/Madrid', 'en-US'),
    'Oct 12, 2026',
  );
  assert.equal(
    formatDate('2026-10-11T22:30:00Z', 'UTC', 'en-US'),
    'Oct 11, 2026',
  );
  const range = formatWeekRange('2026-10-12', 'en-US');
  assert.match(range, /Oct 12/);
  assert.match(range, /18/);
  assert.match(range, /2026/);
});
