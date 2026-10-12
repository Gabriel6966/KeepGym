import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addCalendarDaysToDateOnly,
  canonicalBrowserTimezone,
  dashboardReturnPath,
  getLocalDate,
  getLocalMondayDate,
  isDashboardWeek,
  parseDateOnly,
  resolveWeekStart,
} from '../src/features/dashboard/calendar';

for (const [date, monday] of [
  ['2026-10-12', '2026-10-12'],
  ['2026-10-18', '2026-10-12'],
  ['2026-11-01', '2026-10-26'],
  ['2026-01-01', '2025-12-29'],
  ['2024-02-29', '2024-02-26'],
  ['2026-03-29', '2026-03-23'],
  ['2026-10-25', '2026-10-19'],
] as const)
  void test(`local date ${date} has Monday ${monday}`, () =>
    assert.equal(getLocalMondayDate(date), monday));
void test('DATE-only previous/next and +6-day range cross months, years and leap day without elapsed-hour arithmetic', () => {
  assert.equal(addCalendarDaysToDateOnly('2026-10-12', -7), '2026-10-05');
  assert.equal(addCalendarDaysToDateOnly('2026-10-12', 7), '2026-10-19');
  assert.equal(addCalendarDaysToDateOnly('2026-10-12', 6), '2026-10-18');
  assert.equal(addCalendarDaysToDateOnly('2026-10-26', 7), '2026-11-02');
  assert.equal(addCalendarDaysToDateOnly('2026-12-28', 7), '2027-01-04');
  assert.equal(addCalendarDaysToDateOnly('2024-02-28', 1), '2024-02-29');
  assert.equal(addCalendarDaysToDateOnly('2024-02-29', 1), '2024-03-01');
});
void test('URL values must be real supported Mondays; malformed dates fall back to the local current week', () => {
  for (const value of [
    null,
    '',
    '2026-02-30',
    '2026-10-13',
    '2026-10-12T00:00:00Z',
    '2026-1-12',
    ' 2026-10-12 ',
    '0001-01-01',
    '9999-12-27',
  ]) {
    assert.equal(isDashboardWeek(value), false);
    assert.equal(resolveWeekStart(value, '2026-10-18'), '2026-10-12');
  }
  assert.equal(resolveWeekStart('2099-01-05', '2026-10-18'), '2099-01-05');
  assert.equal(
    parseDateOnly('2024-02-29')?.toISOString(),
    '2024-02-29T00:00:00.000Z',
  );
  assert.equal(parseDateOnly('2025-02-29'), null);
  assert.throws(() => addCalendarDaysToDateOnly('2026-02-30', 1), RangeError);
  assert.throws(() => addCalendarDaysToDateOnly('9999-12-31', 1), RangeError);
});
void test('browser date and IANA zone determine initial Monday independently of CI/process timezone', () => {
  const before = process.env.TZ;
  try {
    for (const processTimezone of [
      'UTC',
      'America/Los_Angeles',
      'Asia/Tokyo',
    ]) {
      process.env.TZ = processTimezone;
      const instant = new Date('2026-09-20T22:30:00Z');
      assert.equal(
        getLocalMondayDate(getLocalDate(instant, 'Europe/Madrid')),
        '2026-09-21',
      );
      assert.equal(
        getLocalMondayDate(getLocalDate(instant, 'UTC')),
        '2026-09-14',
      );
      assert.equal(addCalendarDaysToDateOnly('2026-03-23', 7), '2026-03-30');
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
  for (const value of ['Europe/Foo', 'GMT+2', '+02:00', '', undefined])
    assert.equal(canonicalBrowserTimezone(value), 'UTC');
  assert.equal(canonicalBrowserTimezone('Europe/Madrid'), 'Europe/Madrid');
});
void test('login return path is restricted to Dashboard and never becomes an external redirect', () => {
  assert.equal(
    dashboardReturnPath('/dashboard?weekStart=2026-10-12&userId=x'),
    '/dashboard?weekStart=2026-10-12',
  );
  for (const value of [
    null,
    '//evil.test/dashboard',
    'https://evil.test/dashboard',
    '/dashboard-other',
    '/dashboard?weekStart=invalid',
    '/dashboard/../other',
  ])
    assert.equal(dashboardReturnPath(value), '/dashboard');
});
