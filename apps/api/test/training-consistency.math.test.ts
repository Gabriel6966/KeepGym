import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalIanaTimezone,
  parseLocalMonday,
  shiftLocalMonday,
} from '../src/common/calendar-week';
import {
  calculateEndingWeeklyStreak,
  calculateLongestWeeklyStreak,
  calculateTotalWeeks,
} from '../src/training-consistency/training-consistency.math';

const weeks = [
  '2026-08-24',
  '2026-08-31',
  '2026-09-07',
  '2026-09-14',
  '2026-09-21',
  '2026-09-28',
];
for (const scenario of [
  { name: 'empty', active: [], longest: 0, ending: 0 },
  { name: 'single earlier week', active: [weeks[0]!], longest: 1, ending: 0 },
  { name: 'single ending week', active: [weeks[5]!], longest: 1, ending: 1 },
  { name: 'three consecutive', active: weeks.slice(3), longest: 3, ending: 3 },
  {
    name: 'gap with longest at end',
    active: weeks.filter((_, index) => index !== 2),
    longest: 3,
    ending: 3,
  },
  { name: 'inactive ending', active: weeks.slice(0, 3), longest: 3, ending: 0 },
  {
    name: 'duplicates and unordered',
    active: [weeks[5]!, weeks[3]!, weeks[4]!, weeks[5]!, weeks[0]!],
    longest: 3,
    ending: 3,
  },
])
  void test('consistency streak math: ' + scenario.name, () => {
    const active = Object.freeze([...scenario.active]);
    assert.equal(
      calculateLongestWeeklyStreak(weeks[0]!, weeks[5]!, active),
      scenario.longest,
    );
    assert.equal(
      calculateEndingWeeklyStreak(weeks[0]!, weeks[5]!, active),
      scenario.ending,
    );
    assert.deepEqual(active, scenario.active);
  });

void test('streaks are clipped to the requested range, never extended by activity outside it', () => {
  assert.equal(calculateLongestWeeklyStreak(weeks[1]!, weeks[2]!, weeks), 2);
  assert.equal(calculateEndingWeeklyStreak(weeks[1]!, weeks[2]!, weeks), 2);
  assert.equal(
    calculateLongestWeeklyStreak(weeks[2]!, weeks[2]!, [weeks[1]!, weeks[3]!]),
    0,
  );
});
void test('totalWeeks counts inclusive Mondays exactly: one, two, 104 and 105', () => {
  assert.equal(calculateTotalWeeks(weeks[0]!, weeks[0]!), 1);
  assert.equal(calculateTotalWeeks(weeks[0]!, weeks[1]!), 2);
  assert.equal(
    calculateTotalWeeks(weeks[0]!, shiftLocalMonday(weeks[0]!, 103)),
    104,
  );
  assert.equal(
    calculateTotalWeeks(weeks[0]!, shiftLocalMonday(weeks[0]!, 104)),
    105,
  );
  assert.throws(() => calculateTotalWeeks(weeks[1]!, weeks[0]!), RangeError);
});
void test('date-only streaks cross year, leap day and DST calendars without a clock or process timezone', () => {
  for (const from of ['2025-12-29', '2024-02-26', '2026-03-16', '2026-10-12']) {
    const active = [0, 1, 2].map((index) => shiftLocalMonday(from, index));
    assert.equal(calculateTotalWeeks(from, active[2]!), 3);
    assert.equal(calculateLongestWeeklyStreak(from, active[2]!, active), 3);
    assert.equal(calculateEndingWeeklyStreak(from, active[2]!, active), 3);
  }
  assert.equal(shiftLocalMonday('2024-02-26', 1), '2024-03-04');
  assert.equal(shiftLocalMonday('2026-01-05', -1), '2025-12-29');
});
void test('shared calendar parser rejects timestamps, rollovers, non-Mondays and malformed values', () => {
  for (const value of [
    '',
    '2026-02-30',
    '2026-09-29',
    '2026-09-28T00:00:00Z',
    '2026-9-28',
    ' 2026-09-28 ',
    '0000-01-01',
    undefined,
    null,
    20260928,
    ['2026-09-28'],
  ])
    assert.equal(parseLocalMonday(value), null);
  assert.equal(parseLocalMonday('0001-01-01')?.getUTCFullYear(), 1);
  assert.ok(parseLocalMonday('2099-01-05'));
  assert.throws(() => shiftLocalMonday('0001-01-01', -1), RangeError);
  assert.throws(() => shiftLocalMonday('9999-12-27', 1), RangeError);
  assert.throws(() => shiftLocalMonday('2026-09-28', 1.5), RangeError);
  assert.throws(
    () => calculateEndingWeeklyStreak(weeks[0]!, weeks[5]!, ['2026-09-29']),
    RangeError,
  );
});
void test('shared IANA validation preserves named zones and rejects arbitrary offsets/injection', () => {
  for (const timezone of ['Europe/Madrid', 'America/New_York', 'UTC'])
    assert.equal(canonicalIanaTimezone(timezone), timezone);
  assert.equal(canonicalIanaTimezone('utc'), 'UTC');
  for (const timezone of [
    'GMT+2',
    '+02:00',
    'Europe/Foo',
    '',
    ' UTC ',
    "UTC'; SELECT 1 --",
    undefined,
    null,
    ['UTC'],
  ])
    assert.equal(canonicalIanaTimezone(timezone), null);
});
