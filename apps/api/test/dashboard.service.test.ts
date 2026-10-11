import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { BodyAnalyticsService } from '../src/body-analytics/body-analytics.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { HistoryService } from '../src/history/history.service';
import { RecordsService } from '../src/records/records.service';
import { DashboardReadError } from '../src/dashboard/errors/dashboard-read.error';
import { InvalidDashboardQueryError } from '../src/dashboard/errors/invalid-dashboard-query.error';
import { TrainingCalendarService } from '../src/training-calendar/training-calendar.service';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { TrainingConsistencyService } from '../src/training-consistency/training-consistency.service';
import { addCalendarDays } from '../src/common/calendar-date';
import { shiftLocalMonday } from '../src/common/calendar-week';
import { MuscleGroup } from '../src/generated/prisma/enums';
import {
  dashboardServices,
  dashboardInput as input,
  emptyDashboard,
  emptyBodyOverview,
  expectedDashboardWeek,
} from './support/dashboard-services';

async function setup(context: TestContext) {
  const f = dashboardServices();
  const calendar = context.mock.method(f.calendar, 'getDays'),
    trends = context.mock.method(f.trends, 'getWeeklyComparison'),
    muscles = context.mock.method(f.trends, 'getMuscleGroupWeek'),
    consistency = context.mock.method(f.consistency, 'getWeeklyConsistency'),
    history = context.mock.method(f.history, 'getRecentCompletedWorkouts'),
    records = context.mock.method(f.records, 'getCurrentRecords'),
    bodyAnalytics = context.mock.method(f.bodyAnalytics, 'getOverview'),
    analytics = context.mock.method(f.analytics, 'getExerciseHighlights');
  const module = await Test.createTestingModule({
    providers: [
      DashboardService,
      { provide: AnalyticsService, useValue: f.analytics },
      { provide: BodyAnalyticsService, useValue: f.bodyAnalytics },
      { provide: HistoryService, useValue: f.history },
      { provide: RecordsService, useValue: f.records },
      { provide: TrainingCalendarService, useValue: f.calendar },
      { provide: TrainingTrendsService, useValue: f.trends },
      { provide: TrainingConsistencyService, useValue: f.consistency },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    ...f,
    service: module.get(DashboardService),
    calls: {
      calendar,
      trends,
      muscles,
      consistency,
      history,
      records,
      bodyAnalytics,
      analytics,
    },
  };
}
void test('dashboard zero activity retains null average/percentages and twelve calendar weeks', async (context) => {
  const f = await setup(context);
  assert.deepEqual(
    await f.service.getSummary(randomUUID(), input),
    emptyDashboard(),
  );
});
void test('dashboard sums seven dense days: 4 workouts, 4 sets, 33 reps, 1855.75, 3 days, 9300.5 / 4 = 2325.125', async (context) => {
  const f = await setup(context),
    before = structuredClone(f.calendarData);
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.week, expectedDashboardWeek);
  assert.deepEqual(f.calendarData, before);
  assert.deepEqual(Object.keys(result).sort(), [
    'bodyProgress',
    'comparison',
    'consistency',
    'exerciseHighlights',
    'muscleGroups',
    'personalRecords',
    'recentWorkouts',
    'timezone',
    'week',
    'weekStart',
  ]);
});
void test('dashboard exact sums preserve decimal volumes and millisecond durations, averaging per workout not active day', async (context) => {
  const f = await setup(context);
  f.calendarData.days.forEach((day) => {
    day.totalVolumeKg = 0;
    day.totalDurationSeconds = 0;
  });
  f.calendarData.days[0]!.totalVolumeKg = 0.1;
  f.calendarData.days[2]!.totalVolumeKg = 0.2;
  f.calendarData.days[0]!.totalDurationSeconds = 100.001;
  f.calendarData.days[2]!.totalDurationSeconds = 200.003;
  const { week } = await f.service.getSummary(f.owner, input);
  assert.equal(week.totalVolumeKg, 0.3);
  assert.equal(week.totalDurationSeconds, 300.004);
  assert.equal(week.averageDurationSeconds, 75.001);
});
void test('dashboard forwards comparison signed deltas/percentages verbatim including zero baseline null; no second formula', async (context) => {
  const f = await setup(context);
  f.comparisonData.previous.completedSets = 0;
  f.comparisonData.changes.completedSets = { delta: 4, percentageChange: null };
  f.comparisonData.changes.totalReps = { delta: -3, percentageChange: -9.09 };
  // Independent domain reads can differ under concurrent writes: do not force equality.
  f.comparisonData.current.completedWorkouts = 5;
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.comparison.completedSets, {
    previous: 0,
    delta: 4,
    percentageChange: null,
  });
  assert.deepEqual(result.comparison.totalReps, {
    previous: 30,
    delta: -3,
    percentageChange: -9.09,
  });
  assert.equal(result.week.completedWorkouts, 4);
  assert.equal(result.comparison.previousWeekStart, '2026-09-28');
  assert.equal('current' in result.comparison, false);
});
void test('dashboard derives exact Monday 2026-07-20 from 2026-10-05 minus 77 calendar days; ownership passed to all services once', async (context) => {
  const f = await setup(context);
  assert.equal(addCalendarDays(input.weekStart, -77), '2026-07-20');
  assert.equal(shiftLocalMonday(input.weekStart, -11), '2026-07-20');
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(f.calls.calendar.mock.calls[0]!.arguments, [
    f.owner,
    {
      fromDate: input.weekStart,
      toDate: '2026-10-11',
      timezone: input.timezone,
    },
  ]);
  assert.deepEqual(f.calls.trends.mock.calls[0]!.arguments, [f.owner, input]);
  assert.deepEqual(f.calls.muscles.mock.calls[0]!.arguments, [f.owner, input]);
  assert.deepEqual(result.muscleGroups, f.muscleGroupsData);
  assert.deepEqual(f.calls.history.mock.calls[0]!.arguments, [
    f.owner,
    { limit: 5 },
  ]);
  assert.deepEqual(result.recentWorkouts, f.recentData.items);
  assert.deepEqual(f.calls.records.mock.calls[0]!.arguments, [f.owner, 5]);
  assert.deepEqual(result.personalRecords, f.recordsData.items);
  assert.deepEqual(f.calls.bodyAnalytics.mock.calls[0]!.arguments, [f.owner]);
  assert.deepEqual(result.bodyProgress, f.bodyOverviewData);
  assert.deepEqual(f.calls.analytics.mock.calls[0]!.arguments, [f.owner, 5]);
  assert.deepEqual(result.exerciseHighlights, f.highlightsData.items);
  assert.deepEqual(f.calls.consistency.mock.calls[0]!.arguments, [
    f.owner,
    {
      fromWeekStart: '2026-07-20',
      toWeekStart: input.weekStart,
      timezone: input.timezone,
    },
  ]);
  for (const call of Object.values(f.calls))
    assert.equal(call.mock.calls.length, 1);
  assert.deepEqual(result.consistency, {
    windowWeeks: 12,
    fromWeekStart: '2026-07-20',
    toWeekStart: input.weekStart,
    activeWeeks: 10,
    longestWeeklyStreak: 5,
    endingWeeklyStreak: 5,
  });
});
void test('dashboard accepts future weeks and canonical timezone without reading the clock', async (context) => {
  const f = await setup(context);
  const future = { weekStart: '2099-01-05', timezone: 'UTC' };
  assert.deepEqual(await f.service.getSummary(f.owner, future), {
    ...emptyDashboard(future),
    recentWorkouts: f.recentData.items,
    personalRecords: f.recordsData.items,
    bodyProgress: f.bodyOverviewData,
    exerciseHighlights: f.highlightsData.items,
  });
});

void test('empty current records do not change populated week, history, comparison or consistency', async (context) => {
  const f = await setup(context);
  const before = await f.service.getSummary(f.owner, input);
  f.recordsData.items = [];
  assert.deepEqual(await f.service.getSummary(f.owner, input), {
    ...before,
    personalRecords: [],
  });
});
void test('dashboard body progress preserves independent partial sequences and observation timestamps without mutation', async (context) => {
  const f = await setup(context);
  const before = structuredClone(f.bodyOverviewData);
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.bodyProgress, before);
  assert.deepEqual(result.bodyProgress.weightKg, {
    latest: { value: 79, measuredAt: new Date('2026-09-20T06:00:00Z') },
    previous: { value: 80, measuredAt: new Date('2026-09-01T06:00:00Z') },
    change: -1,
  });
  assert.deepEqual(result.bodyProgress.waistCm, {
    latest: { value: 85, measuredAt: new Date('2026-09-10T06:00:00Z') },
    previous: null,
    change: null,
  });
  for (const metric of ['bodyFatPercent', 'chestCm', 'hipsCm'] as const)
    assert.deepEqual(result.bodyProgress[metric], {
      latest: null,
      previous: null,
      change: null,
    });
  assert.deepEqual(f.bodyOverviewData, before);
});
void test('dashboard passes body changes verbatim, never applying its own difference or rounding formula', async (context) => {
  const f = await setup(context);
  // Deliberately different test-double result proves Dashboard does not recompute.
  f.bodyOverviewData.weightKg.change = -7.77;
  const result = await f.service.getSummary(f.owner, input);
  assert.equal(result.bodyProgress.weightKg.change, -7.77);
  assert.deepEqual(f.calls.bodyAnalytics.mock.calls[0]!.arguments, [f.owner]);
});
void test('empty body overview retains nulls and leaves all other dashboard blocks intact', async (context) => {
  const f = await setup(context);
  const before = await f.service.getSummary(f.owner, input);
  f.calls.bodyAnalytics.mock.mockImplementation(async () =>
    emptyBodyOverview(),
  );
  assert.deepEqual(await f.service.getSummary(f.owner, input), {
    ...before,
    bodyProgress: emptyBodyOverview(),
  });
});
void test('dashboard rejects invalid inputs and unsupported calendar boundaries before domain calls', async (context) => {
  const f = await setup(context);
  for (const override of [
    { weekStart: '2026-02-30' },
    { weekStart: '2026-10-06' },
    { weekStart: '2026-10-05T00:00:00Z' },
    { weekStart: '0001-01-01' },
    { weekStart: '9999-12-27' },
    { timezone: 'GMT+2' },
    { timezone: 'Europe/Foo' },
    { timezone: '+02:00' },
  ])
    await assert.rejects(
      f.service.getSummary(f.owner, { ...input, ...override }),
      InvalidDashboardQueryError,
    );
  await assert.rejects(
    f.service.getSummary('invalid', input),
    InvalidDashboardQueryError,
  );
  for (const call of Object.values(f.calls))
    assert.equal(call.mock.calls.length, 0);
});
void test('dashboard launches all eight independent reads before awaiting results, including both TrainingTrends read models', async (context) => {
  const f = await setup(context);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.calls.calendar.mock.mockImplementation(async () => {
    await gate;
    return f.calendarData;
  });
  f.calls.trends.mock.mockImplementation(async () => {
    await gate;
    return f.comparisonData;
  });
  f.calls.muscles.mock.mockImplementation(async () => {
    await gate;
    return f.muscleGroupsData;
  });
  f.calls.consistency.mock.mockImplementation(async () => {
    await gate;
    return f.consistencyData;
  });
  f.calls.history.mock.mockImplementation(async () => {
    await gate;
    return f.recentData;
  });
  f.calls.records.mock.mockImplementation(async () => {
    await gate;
    return f.recordsData;
  });
  f.calls.bodyAnalytics.mock.mockImplementation(async () => {
    await gate;
    return f.bodyOverviewData;
  });
  f.calls.analytics.mock.mockImplementation(async () => {
    await gate;
    return f.highlightsData;
  });
  const pending = f.service.getSummary(f.owner, input);
  try {
    for (const call of Object.values(f.calls))
      assert.equal(call.mock.calls.length, 1);
  } finally {
    release();
  }
  assert.deepEqual((await pending).week, expectedDashboardWeek);
});
void test('dashboard preserves sparse muscle metrics and ASCII order without ranking, limiting or mutating service output', async (context) => {
  const f = await setup(context);
  f.muscleGroupsData.unshift({
    muscleGroup: 'BACK',
    completedWorkouts: 1,
    completedSets: 2,
    totalReps: 16,
    totalVolumeKg: 0,
  });
  f.muscleGroupsData[2]!.totalVolumeKg = 9999.75;
  const before = structuredClone(f.muscleGroupsData);
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.muscleGroups, before);
  assert.deepEqual(
    result.muscleGroups.map((group) => group.muscleGroup),
    ['BACK', 'CHEST', 'TRICEPS'],
  );
  assert.equal(result.muscleGroups[0]!.totalVolumeKg, 0);
  assert.deepEqual(f.muscleGroupsData, before);
});
void test('muscle snapshot is selected-week scoped while all-time dashboard sections remain available', async (context) => {
  const f = await setup(context);
  const before = await f.service.getSummary(f.owner, input);
  const next = { weekStart: '2026-10-12', timezone: 'America/New_York' };
  f.calls.muscles.mock.mockImplementation(async (userId, query) =>
    userId === f.owner && query.weekStart === next.weekStart
      ? [
          {
            muscleGroup: 'BACK',
            completedWorkouts: 1,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 0,
          },
        ]
      : f.muscleGroupsData,
  );
  const result = await f.service.getSummary(f.owner, next);
  assert.deepEqual(result.muscleGroups, [
    {
      muscleGroup: 'BACK',
      completedWorkouts: 1,
      completedSets: 2,
      totalReps: 16,
      totalVolumeKg: 0,
    },
  ]);
  assert.notDeepEqual(result.muscleGroups, before.muscleGroups);
  assert.deepEqual(f.calls.muscles.mock.calls.at(-1)!.arguments, [
    f.owner,
    next,
  ]);
  for (const key of [
    'recentWorkouts',
    'personalRecords',
    'bodyProgress',
    'exerciseHighlights',
  ] as const)
    assert.deepEqual(result[key], before[key]);
});
void test('empty muscle week remains sparse and leaves all populated dashboard sections intact', async (context) => {
  const f = await setup(context);
  const before = await f.service.getSummary(f.owner, input);
  f.calls.muscles.mock.mockImplementation(async () => []);
  assert.deepEqual(await f.service.getSummary(f.owner, input), {
    ...before,
    muscleGroups: [],
  });
});
void test('dashboard does not apply feed limits to the canonical muscle enum', async (context) => {
  const f = await setup(context);
  const groups = Object.values(MuscleGroup)
    .sort()
    .map((muscleGroup) => ({
      muscleGroup,
      completedWorkouts: 1,
      completedSets: 1,
      totalReps: 8,
      totalVolumeKg: 0,
    }));
  f.calls.muscles.mock.mockImplementation(async () => groups);
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.muscleGroups, groups);
  assert.equal(result.muscleGroups.length, Object.values(MuscleGroup).length);
});
void test('empty exercise highlights preserve the other populated dashboard sections', async (context) => {
  const f = await setup(context);
  f.calls.analytics.mock.mockImplementation(async () => ({ items: [] }));
  const result = await f.service.getSummary(f.owner, input);
  assert.deepEqual(result.exerciseHighlights, []);
  assert.deepEqual(result.week, expectedDashboardWeek);
  assert.deepEqual(result.recentWorkouts, f.recentData.items);
  assert.deepEqual(result.personalRecords, f.recordsData.items);
  assert.deepEqual(result.bodyProgress, f.bodyOverviewData);
});
void test('dashboard sanitizes each failing subservice instead of substituting zeros', async (context) => {
  const f = await setup(context);
  for (const call of Object.values(f.calls)) {
    call.mock.mockImplementationOnce(async () => {
      throw new Error('private SQL stack');
    });
    await assert.rejects(
      f.service.getSummary(f.owner, input),
      (error: unknown) =>
        error instanceof DashboardReadError &&
        error.message === 'Unable to read dashboard summary.' &&
        error.cause === undefined,
    );
  }
});
void test('dashboard treats non-12-week consistency and malformed dense calendar as internal invariant failures', async (context) => {
  const f = await setup(context);
  f.consistencyData.totalWeeks = 11;
  await assert.rejects(
    f.service.getSummary(f.owner, input),
    DashboardReadError,
  );
  f.consistencyData.totalWeeks = 12;
  f.calendarData.days.pop();
  await assert.rejects(
    f.service.getSummary(f.owner, input),
    DashboardReadError,
  );
});
