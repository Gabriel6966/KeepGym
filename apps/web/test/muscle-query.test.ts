import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  muscleProgressUrl,
  muscleUrlState,
  muscleWeekQuery,
  normalizeMuscleRange,
  visibleMuscleWeeks,
} from '../src/features/progress/muscle-query';
import { defaultTrainingRange } from '../src/features/progress/training-query';
import { addCalendarDaysToDateOnly } from '../src/features/dashboard/calendar';
import { authReturnPath } from '../src/features/auth/return-path';
import { muscleRange, muscleWeeks } from './support/muscle-fixture';
void test('presentation filter preserves week/group order and unchanged row identity, never inserts/sums/densifies', () => {
  const data = muscleWeeks(),
    copy = structuredClone(data);
  assert.equal(visibleMuscleWeeks(data.buckets, 'ALL'), data.buckets);
  const chest = visibleMuscleWeeks(data.buckets, 'CHEST');
  assert.deepEqual(
    chest.map((w) => w.weekStart),
    ['2026-09-21', '2026-10-05'],
  );
  assert.equal(chest[0]!.muscleGroups[0], data.buckets[0]!.muscleGroups[0]);
  assert.equal(chest[1]!.muscleGroups[0], data.buckets[1]!.muscleGroups[1]);
  assert.deepEqual(
    visibleMuscleWeeks(data.buckets, 'BACK').map((w) => w.weekStart),
    ['2026-10-05'],
  );
  assert.deepEqual(visibleMuscleWeeks(data.buckets, 'CORE'), []);
  assert.deepEqual(data, copy);
});
void test('URL defaults/custom range/metric/group and safe return preserve only supported values', () => {
  assert.deepEqual(muscleUrlState(new URLSearchParams()), {
    range: undefined,
    metric: 'completedSets',
    muscleGroup: 'ALL',
  });
  const url = muscleProgressUrl({
      range: muscleRange,
      metric: 'totalVolumeKg',
      muscleGroup: 'BACK',
    }),
    params = new URL(url, 'https://web.test').searchParams;
  assert.deepEqual(muscleUrlState(params), {
    range: muscleRange,
    metric: 'totalVolumeKg',
    muscleGroup: 'BACK',
  });
  assert.equal(authReturnPath(url + '&userId=other'), url);
  assert.equal(
    authReturnPath('/progress/muscle-groups'),
    '/progress/muscle-groups',
  );
  assert.equal(
    authReturnPath('//evil.test/progress/muscle-groups'),
    '/dashboard',
  );
  assert.equal(authReturnPath('/progress/muscle-groups/extra'), '/dashboard');
  assert.deepEqual(
    muscleUrlState(new URLSearchParams('metric=bogus&muscleGroup=LEGS')),
    { range: undefined, metric: 'completedSets', muscleGroup: 'ALL' },
  );
  assert.equal(
    muscleUrlState(new URLSearchParams('muscleGroup=CHEST&muscleGroup=BACK'))
      .muscleGroup,
    'ALL',
  );
});
void test('invalid DATE/non-Monday/order/max URL ranges safely fall back to twelve weeks', () => {
  for (const params of [
    'fromWeekStart=bad&toWeekStart=bad',
    'fromWeekStart=2026-10-13&toWeekStart=2026-10-19',
    'fromWeekStart=2026-10-19&toWeekStart=2026-10-12',
    'fromWeekStart=2026-02-30&toWeekStart=2026-03-02',
    'fromWeekStart=2024-01-01&toWeekStart=2026-10-12',
  ])
    assert.deepEqual(
      normalizeMuscleRange(new URLSearchParams(params), '2026-10-14', 'UTC'),
      defaultTrainingRange('2026-10-14'),
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
])
  void test(
    'muscle inclusive local week adapter is DST-safe ' +
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
          `const {muscleWeekQuery}=require(${JSON.stringify(require.resolve('../src/features/progress/muscle-query'))});process.stdout.write(JSON.stringify(muscleWeekQuery(${JSON.stringify(range)},${JSON.stringify(example.tz)})));`,
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
void test('muscle week adapter accepts actual maximum full weeks and calendar boundaries without a shorter limit', () => {
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const {muscleWeekQuery}=require(${JSON.stringify(require.resolve('../src/features/progress/muscle-query'))});const ranges=[{fromWeekStart:'2025-01-06',toWeekStart:'2026-12-28'},{fromWeekStart:'2025-01-06',toWeekStart:'2027-01-04'},{fromWeekStart:'2026-10-13',toWeekStart:'2026-10-19'}];process.stdout.write(JSON.stringify(ranges.map(r=>muscleWeekQuery(r,'UTC'))));`,
    ],
    { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' },
  );
  assert.equal(child.status, 0);
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(Array.isArray(result));
  assert.ok(result[0]);
  assert.equal(result[1], null);
  assert.equal(result[2], null);
  for (const [date, monday] of [
    ['2026-01-01', '2025-12-29'],
    ['2024-02-29', '2024-02-26'],
    ['2026-03-01', '2026-02-23'],
  ] as const)
    assert.deepEqual(normalizeMuscleRange(new URLSearchParams(), date, 'UTC'), {
      fromWeekStart: addCalendarDaysToDateOnly(monday, -77),
      toWeekStart: monday,
    });
  assert.equal(
    muscleWeekQuery(
      { fromWeekStart: '2026-10-13', toWeekStart: '2026-10-19' },
      'UTC',
    ),
    null,
  );
  assert.equal(addCalendarDaysToDateOnly('2025-01-06', 721), '2026-12-28');
});
