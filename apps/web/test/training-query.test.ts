import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  defaultTrainingRange,
  normalizeTrainingRange,
  trainingProgressUrl,
  trainingRangeQueries,
  trainingReturnPath,
  trainingSelectorUrl,
  trainingUrlState,
  validTrainingWeeks,
} from '../src/features/progress/training-query';
import { addCalendarDaysToDateOnly } from '../src/features/dashboard/calendar';
import { authReturnPath } from '../src/features/auth/return-path';

for (const [date, monday] of [
  ['2026-10-12', '2026-10-12'],
  ['2026-10-18', '2026-10-12'],
  ['2026-03-01', '2026-02-23'],
  ['2026-01-01', '2025-12-29'],
  ['2024-02-29', '2024-02-26'],
] as const)
  void test(
    '12-week local Monday default across calendar boundary ' + date,
    () =>
      assert.deepEqual(defaultTrainingRange(date), {
        fromWeekStart: addCalendarDaysToDateOnly(monday, -77),
        toWeekStart: monday,
      }),
  );
void test('real Monday/order/exclusive-end/104-week validation is not a smaller invented limit', () => {
  const fromWeekStart = '2025-01-06';
  assert.equal(
    validTrainingWeeks({
      fromWeekStart,
      toWeekStart: addCalendarDaysToDateOnly(fromWeekStart, 721),
    }),
    true,
  );
  assert.equal(
    validTrainingWeeks({
      fromWeekStart,
      toWeekStart: addCalendarDaysToDateOnly(fromWeekStart, 728),
    }),
    false,
  );
  for (const range of [
    { fromWeekStart: '2026-02-30', toWeekStart: '2026-03-02' },
    { fromWeekStart: '2026-10-13', toWeekStart: '2026-10-19' },
    { fromWeekStart: '2026-10-12T00:00:00Z', toWeekStart: '2026-10-19' },
    { fromWeekStart: '2026-10-19', toWeekStart: '2026-10-12' },
    { fromWeekStart: '9999-12-27', toWeekStart: '9999-12-27' },
  ])
    assert.equal(validTrainingWeeks(range), false);
  assert.equal(
    validTrainingWeeks({
      fromWeekStart: '9999-12-20',
      toWeekStart: '9999-12-20',
    }),
    true,
  );
});
for (const example of [
  {
    tz: 'Europe/Madrid',
    monday: '2026-03-23',
    from: '2026-03-23T00:00:00.000+01:00',
    to: '2026-03-29T21:59:59.999Z',
    hours: 167,
  },
  {
    tz: 'Europe/Madrid',
    monday: '2026-10-19',
    from: '2026-10-19T00:00:00.000+02:00',
    to: '2026-10-25T22:59:59.999Z',
    hours: 169,
  },
  {
    tz: 'UTC',
    monday: '2026-03-23',
    from: '2026-03-23T00:00:00.000+00:00',
    to: '2026-03-29T23:59:59.999Z',
    hours: 168,
  },
  {
    tz: 'America/New_York',
    monday: '2026-03-02',
    from: '2026-03-02T00:00:00.000-05:00',
    to: '2026-03-09T03:59:59.999Z',
    hours: 167,
  },
])
  void test(
    'endpoint adapters preserve weekly DST boundaries ' +
      example.tz +
      example.monday,
    () => {
      const range = {
        fromWeekStart: example.monday,
        toWeekStart: example.monday,
      };
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `const {trainingRangeQueries}=require(${JSON.stringify(require.resolve('../src/features/progress/training-query'))});process.stdout.write(JSON.stringify(trainingRangeQueries(${JSON.stringify(range)},${JSON.stringify(example.tz)})));`,
        ],
        { env: { ...process.env, TZ: example.tz }, encoding: 'utf8' },
      );
      assert.equal(child.status, 0);
      const instants = {
        from: example.from,
        to: example.to,
        timezone: example.tz,
      };
      const result: unknown = JSON.parse(child.stdout);
      assert.deepEqual(result, {
        trends: instants,
        duration: instants,
        consistency: { ...range, timezone: example.tz },
      });
      assert.equal(
        (Date.parse(example.to) + 1 - Date.parse(example.from)) / 3600000,
        example.hours,
      );
    },
  );
void test('URL parsing falls back invalid dates, Monday, order, duplicates, metrics and preserves selector', () => {
  for (const search of [
    '',
    'fromWeekStart=bad&toWeekStart=bad',
    'fromWeekStart=2026-10-13&toWeekStart=2026-10-19',
    'fromWeekStart=2026-10-19&toWeekStart=2026-10-12',
    'fromWeekStart=2026-10-12&fromWeekStart=2026-10-19&toWeekStart=2026-10-19',
  ]) {
    assert.equal(
      trainingUrlState(new URLSearchParams(search)).range,
      undefined,
    );
    assert.deepEqual(
      normalizeTrainingRange(new URLSearchParams(search), '2026-10-14', 'UTC'),
      defaultTrainingRange('2026-10-14'),
    );
  }
  const params = new URLSearchParams(
    'fromWeekStart=2026-09-21&toWeekStart=2026-10-12&trainingMetric=completedSets&durationMetric=averageDurationSeconds&q=bench&page=2',
  );
  assert.equal(trainingUrlState(params).trainingMetric, 'completedSets');
  assert.equal(
    trainingUrlState(params).durationMetric,
    'averageDurationSeconds',
  );
  const url = trainingReturnPath(params);
  assert.equal(authReturnPath(url + '&userId=other'), url);
  assert.deepEqual(
    trainingUrlState(new URLSearchParams(url.split('?')[1])),
    trainingUrlState(params),
  );
  const searched = new URL(
    trainingSelectorUrl(params, { q: 'row', page: 1 }),
    'https://web.test',
  );
  assert.equal(searched.searchParams.get('fromWeekStart'), '2026-09-21');
  assert.equal(searched.searchParams.get('trainingMetric'), 'completedSets');
  assert.equal(searched.searchParams.get('q'), 'row');
  assert.equal(searched.searchParams.has('page'), false);
  const changed = new URL(
    trainingProgressUrl({
      ...trainingUrlState(params),
      range: { fromWeekStart: '2026-10-12', toWeekStart: '2026-10-12' },
      selector: { q: 'bench', page: 2 },
    }),
    'https://web.test',
  );
  assert.equal(changed.searchParams.get('q'), 'bench');
  assert.equal(changed.searchParams.get('page'), '2');
  assert.equal(
    trainingUrlState(
      new URLSearchParams('trainingMetric=bogus&durationMetric=bogus'),
    ).trainingMetric,
    'totalVolumeKg',
  );
  assert.equal(
    trainingUrlState(new URLSearchParams('durationMetric=bogus'))
      .durationMetric,
    'totalDurationSeconds',
  );
  assert.equal(
    trainingRangeQueries(
      { fromWeekStart: '2026-10-13', toWeekStart: '2026-10-19' },
      'UTC',
    ),
    null,
  );
});
