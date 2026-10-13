import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  defaultProgressRange,
  exerciseProgressUrl,
  normalizeProgressRange,
  progressPage,
  selectorQuery,
  selectorUrl,
  selectedTrendMetric,
  validDatePair,
} from '../src/features/progress/progress-query';
import { authReturnPath } from '../src/features/auth/return-path';
import { exerciseId } from './support/progress-fixture';

void test('default is 12 calendar weeks Monday to Sunday including current week', () =>
  assert.deepEqual(defaultProgressRange('2026-10-13'), {
    fromDate: '2026-07-27',
    toDate: '2026-10-18',
  }));
for (const [fromDate, toDate, valid] of [
  ['2024-02-29', '2024-03-01', true],
  ['2026-02-30', '2026-03-01', false],
  ['2026-10-13', '2026-10-12', false],
  ['2026-10-12T00:00:00Z', '2026-10-13', false],
] as const)
  void test('strict DATE-only pair ' + fromDate, () =>
    assert.equal(validDatePair({ fromDate, toDate }), valid),
  );
const nativeCases = [
  {
    tz: 'Europe/Madrid',
    date: '2026-03-29',
    from: '2026-03-29T00:00:00.000+01:00',
    to: '2026-03-29T21:59:59.999Z',
    hours: 23,
  },
  {
    tz: 'Europe/Madrid',
    date: '2026-10-25',
    from: '2026-10-25T00:00:00.000+02:00',
    to: '2026-10-25T22:59:59.999Z',
    hours: 25,
  },
  {
    tz: 'UTC',
    date: '2026-03-29',
    from: '2026-03-29T00:00:00.000+00:00',
    to: '2026-03-29T23:59:59.999Z',
    hours: 24,
  },
  {
    tz: 'America/New_York',
    date: '2026-03-08',
    from: '2026-03-08T00:00:00.000-05:00',
    to: '2026-03-09T03:59:59.999Z',
    hours: 23,
  },
];
for (const example of nativeCases)
  void test(
    'local inclusive boundaries preserve real DST ' +
      example.tz +
      ' ' +
      example.date,
    () => {
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `const {trendRange}=require(${JSON.stringify(require.resolve('../src/features/progress/progress-query'))});process.stdout.write(JSON.stringify(trendRange({fromDate:${JSON.stringify(example.date)},toDate:${JSON.stringify(example.date)}},${JSON.stringify(example.tz)})));`,
        ],
        { env: { ...process.env, TZ: example.tz }, encoding: 'utf8' },
      );
      assert.equal(child.status, 0);
      const result: unknown = JSON.parse(child.stdout);
      assert.deepEqual(result, {
        from: example.from,
        to: example.to,
        timezone: example.tz,
      });
      assert.equal(
        (Date.parse(example.to) + 1 - Date.parse(example.from)) / 3600000,
        example.hours,
      );
    },
  );
void test('native midnight gaps, 730-day maximum and invalid pairs normalize without sending garbage', () => {
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const {trendRange,normalizeProgressRange}=require(${JSON.stringify(require.resolve('../src/features/progress/progress-query'))});const ranges=[{fromDate:'2025-01-01',toDate:'2026-12-31'},{fromDate:'2025-01-01',toDate:'2027-01-01'},{fromDate:'2026-02-30',toDate:'2026-03-01'}];process.stdout.write(JSON.stringify(ranges.map(r=>trendRange(r,'UTC'))));`,
    ],
    { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' },
  );
  assert.equal(child.status, 0);
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(Array.isArray(result));
  assert.ok(result[0]);
  assert.equal(result[1], null);
  assert.equal(result[2], null);
  const gap = spawnSync(
    process.execPath,
    [
      '-e',
      `const {trendRange}=require(${JSON.stringify(require.resolve('../src/features/progress/progress-query'))});process.stdout.write(JSON.stringify(trendRange({fromDate:'2011-12-30',toDate:'2011-12-30'},'Pacific/Apia')));`,
    ],
    { env: { ...process.env, TZ: 'Pacific/Apia' }, encoding: 'utf8' },
  );
  assert.equal(gap.status, 0);
  assert.equal(gap.stdout, 'null');
  assert.deepEqual(
    normalizeProgressRange(
      new URLSearchParams('fromDate=bad&toDate=bad'),
      '2026-10-13',
      'UTC',
    ),
    defaultProgressRange('2026-10-13'),
  );
});
void test('URL keeps DATE-only range, performance page and independent visual metric', () => {
  assert.equal(
    exerciseProgressUrl(
      exerciseId,
      { fromDate: '2026-09-01', toDate: '2026-10-13' },
      2,
      'maxLoadKg',
    ),
    '/progress/exercises/' +
      exerciseId +
      '?fromDate=2026-09-01&toDate=2026-10-13&performancePage=2&metric=maxLoadKg',
  );
  assert.equal(
    selectedTrendMetric(new URLSearchParams('metric=invalid')),
    'totalVolumeKg',
  );
  assert.equal(
    selectedTrendMetric(
      new URLSearchParams('metric=maxLoadKg&metric=totalReps'),
    ),
    'totalVolumeKg',
  );
  for (const page of ['0', '-1', 'abc', '1.5', '1e2', '01', '2147483648'])
    assert.equal(progressPage(page), 1);
});
void test('selector query is backend search/pagination only and drops unsupported identity/filter params', () => {
  assert.deepEqual(
    selectorQuery(
      new URLSearchParams('q=+bench+&page=2&isActive=false&userId=other'),
    ),
    { q: 'bench', page: 2, limit: 10 },
  );
  assert.equal(
    selectorUrl({ q: 'bench', page: 2 }),
    '/progress?q=bench&page=2',
  );
  assert.equal(
    selectorQuery(new URLSearchParams('q=' + 'x'.repeat(101) + '&page=abc')).q,
    undefined,
  );
});
void test('safe login/onboarding return accepts Progress and rejects open redirects, unknown queries and entry IDs as routes', () => {
  const url = exerciseProgressUrl(
    exerciseId,
    { fromDate: '2026-09-01', toDate: '2026-10-13' },
    2,
    'maxLoadKg',
  );
  assert.equal(authReturnPath(url + '&userId=other'), url);
  assert.equal(
    authReturnPath('/progress?q=bench&page=2'),
    '/progress?q=bench&page=2',
  );
  for (const invalid of [
    'https://evil.test/progress',
    '//evil.test/progress',
    '/progress/other',
    '/progress/exercises/..',
    '/progress/exercises/a/more',
  ])
    assert.equal(authReturnPath(invalid), '/dashboard');
});
