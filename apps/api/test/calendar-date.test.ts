import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  addCalendarDays,
  countInclusiveCalendarDays,
  iterateCalendarDays,
  parseCalendarDate,
} from '../src/common/calendar-date';
import {
  parseLocalMonday,
  shiftLocalMonday,
} from '../src/common/calendar-week';

void test('calendar DATE-only rejects timestamps, rollover dates and ambiguous formats; leap years are Gregorian', () => {
  for (const value of [
    '',
    '2026-02-30',
    '2026-02-29',
    '1900-02-29',
    '2026-9-28',
    '2026-09-28T00:00:00Z',
    ' 2026-09-28 ',
    '0000-01-01',
    '2026-13-01',
    null,
    2026,
  ])
    assert.equal(parseCalendarDate(value), null);
  for (const value of [
    '2024-02-29',
    '2000-02-29',
    '0001-01-01',
    '9999-12-31',
    '2026-09-29',
  ])
    assert.equal(parseCalendarDate(value)?.toISOString().slice(0, 10), value);
});
void test('calendar day addition handles leap, month and year boundaries in both directions', () => {
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addCalendarDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addCalendarDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDays('2027-01-01', -1), '2026-12-31');
  for (const [date, offset] of [
    ['0001-01-01', -1],
    ['9999-12-31', 1],
    ['2026-02-30', 1],
    ['2026-01-01', 0.5],
  ] as const)
    assert.throws(() => addCalendarDays(date, offset), RangeError);
});
void test('calendar inclusive counts and iteration retain exactly one of every date including 366-day boundary', () => {
  assert.equal(countInclusiveCalendarDays('2026-09-28', '2026-09-28'), 1);
  assert.equal(countInclusiveCalendarDays('2024-01-01', '2024-12-31'), 366);
  assert.equal(countInclusiveCalendarDays('2024-01-01', '2025-01-01'), 367);
  assert.equal(
    [...iterateCalendarDays('2024-01-01', '2024-12-31')].length,
    366,
  );
  assert.deepEqual(
    [...iterateCalendarDays('2026-12-31', '2027-01-02')],
    ['2026-12-31', '2027-01-01', '2027-01-02'],
  );
  assert.deepEqual(
    [...iterateCalendarDays('9999-12-31', '9999-12-31')],
    ['9999-12-31'],
  );
  assert.throws(
    () => countInclusiveCalendarDays('2026-09-29', '2026-09-28'),
    RangeError,
  );
});
void test('calendar helpers do not depend on Node TZ across spring and autumn DST', () => {
  const path = require.resolve('../src/common/calendar-date');
  const script = `const c = require(${JSON.stringify(path)}); process.stdout.write(JSON.stringify([c.addCalendarDays('2026-03-29', 1), c.countInclusiveCalendarDays('2026-03-28','2026-03-30'), [...c.iterateCalendarDays('2026-10-24','2026-10-26')]]));`;
  for (const TZ of [
    'UTC',
    'Europe/Madrid',
    'America/New_York',
    'Pacific/Honolulu',
  ]) {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), [
      '2026-03-30',
      3,
      ['2026-10-24', '2026-10-25', '2026-10-26'],
    ]);
  }
});
void test('calendar-week consumers retain strict Monday validation and calendar shifts', () => {
  assert.ok(parseLocalMonday('2026-09-28'));
  assert.equal(parseLocalMonday('2026-09-29'), null);
  assert.equal(shiftLocalMonday('2026-03-23', 1), '2026-03-30');
  assert.equal(shiftLocalMonday('2026-10-19', 1), '2026-10-26');
});
