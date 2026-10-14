import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  isCalendarMonth,
  monthBoundaries,
  shiftCalendarMonth,
  mondayFirstOffset,
  calendarDates,
  calendarMonthFromUrl,
  calendarUrl,
} from '../src/features/history/calendar-month';
import { authReturnPath } from '../src/features/auth/return-path';

void test('month accepts only real YYYY-MM; January/December arithmetic preserves year boundaries', () => {
  for (const value of ['2026-10', '0001-01', '9999-12', '2024-02'])
    assert.equal(isCalendarMonth(value), true);
  for (const value of [
    '',
    '2026-1',
    '2026-00',
    '2026-13',
    '0000-01',
    '2026-10-01',
    ' 2026-10',
    null,
  ])
    assert.equal(isCalendarMonth(value), false);
  assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
  assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
  assert.equal(shiftCalendarMonth('0001-01', -1), null);
  assert.equal(shiftCalendarMonth('9999-12', 1), null);
  assert.equal(shiftCalendarMonth('bad', 1), null);
  assert.equal(shiftCalendarMonth('2026-10', 0.5), null);
});
void test('month boundaries handle 28/29/30/31 days, leap centuries and Monday-first offset', () => {
  for (const [month, last] of [
    ['2026-02', '28'],
    ['2024-02', '29'],
    ['2000-02', '29'],
    ['1900-02', '28'],
    ['2026-04', '30'],
    ['2026-10', '31'],
  ] as const) {
    const range = monthBoundaries(month);
    assert.deepEqual(range, {
      fromDate: month + '-01',
      toDate: month + '-' + last,
    });
    assert.equal(
      calendarDates(range.fromDate, range.toDate)?.length,
      Number(last),
    );
  }
  assert.equal(mondayFirstOffset('2026-10-01'), 3);
  assert.equal(mondayFirstOffset('2026-06-01'), 0);
  assert.equal(mondayFirstOffset('2026-02-01'), 6);
  assert.throws(() => monthBoundaries('2026-13'), RangeError);
});
void test('calendar coverage validates actual DATE-only dates and inclusive maximum 366 without instant arithmetic', () => {
  assert.equal(calendarDates('2024-01-01', '2024-12-31')?.length, 366);
  for (const [from, to] of [
    ['2024-01-01', '2025-01-01'],
    ['2026-02-30', '2026-03-01'],
    ['2026-10-02', '2026-10-01'],
    ['2026-10-01T00:00Z', '2026-10-31'],
  ] as const)
    assert.equal(calendarDates(from, to), null);
  assert.deepEqual(calendarDates('9999-12-31', '9999-12-31'), ['9999-12-31']);
});
void test('URL and safe auth return preserve month only; invalid and duplicate months fall back safely', () => {
  const url = calendarUrl('2026-10');
  assert.equal(url, '/history/calendar?month=2026-10');
  assert.equal(
    calendarMonthFromUrl(new URLSearchParams(url.split('?')[1])),
    '2026-10',
  );
  assert.equal(authReturnPath(url + '&userId=foreign&day=bad'), url);
  for (const raw of ['', 'month=bad', 'month=2026-10&month=2026-11']) {
    assert.equal(calendarMonthFromUrl(new URLSearchParams(raw)), null);
    assert.equal(
      authReturnPath('/history/calendar?' + raw),
      '/history/calendar',
    );
  }
  assert.equal(
    authReturnPath('//evil.test/history/calendar?month=2026-10'),
    '/dashboard',
  );
  assert.equal(authReturnPath('/history/calendar/extra'), '/dashboard');
  // A refreshed/deep-linked URL is the same state used by back/forward.
  for (const month of ['2026-09', '2026-10', '2026-11', '2099-02'])
    assert.equal(
      calendarMonthFromUrl(
        new URL(calendarUrl(month), 'https://app.test').searchParams,
      ),
      month,
    );
});
for (const zone of ['Europe/Madrid', 'UTC', 'America/New_York'])
  void test(
    'DATE-only months/days and DST-adjacent dates are independent of process timezone: ' +
      zone,
    () => {
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `const m=require(${JSON.stringify(require.resolve('../src/features/history/calendar-month'))});const c=require(${JSON.stringify(require.resolve('../src/features/dashboard/calendar'))});process.stdout.write(JSON.stringify({range:m.monthBoundaries('2026-10'),days:m.calendarDates('2026-10-01','2026-10-31'),spring:m.calendarDates('2026-03-28','2026-03-30'),autumn:m.calendarDates('2026-10-24','2026-10-26'),labels:['2026-10-01','2026-10-31'].map(d=>m.formatCalendarDate(d,'en-GB')),local:c.getLocalDate(new Date('2026-11-01T00:30:00Z'),${JSON.stringify(zone)})}));`,
        ],
        { env: { ...process.env, TZ: zone }, encoding: 'utf8' },
      );
      assert.equal(child.status, 0, child.stderr);
      const result: unknown = JSON.parse(child.stdout);
      assert.deepEqual(result, {
        range: monthBoundaries('2026-10'),
        days: calendarDates('2026-10-01', '2026-10-31'),
        spring: ['2026-03-28', '2026-03-29', '2026-03-30'],
        autumn: ['2026-10-24', '2026-10-25', '2026-10-26'],
        labels: ['1 October 2026', '31 October 2026'],
        local: zone === 'America/New_York' ? '2026-10-31' : '2026-11-01',
      });
    },
  );
