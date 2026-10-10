import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { DashboardReadError } from '../src/dashboard/errors/dashboard-read.error';
import { InvalidDashboardQueryError } from '../src/dashboard/errors/invalid-dashboard-query.error';
import { TrainingCalendarService } from '../src/training-calendar/training-calendar.service';
import { TrainingTrendsService } from '../src/training-trends/training-trends.service';
import { TrainingConsistencyService } from '../src/training-consistency/training-consistency.service';
import { addCalendarDays } from '../src/common/calendar-date';
import { shiftLocalMonday } from '../src/common/calendar-week';
import {
  dashboardServices,
  dashboardInput as input,
  emptyDashboard,
  expectedDashboardWeek,
} from './support/dashboard-services';

async function setup(context: TestContext) {
  const f = dashboardServices();
  const calendar = context.mock.method(f.calendar, 'getDays'),
    trends = context.mock.method(f.trends, 'getWeeklyComparison'),
    consistency = context.mock.method(f.consistency, 'getWeeklyConsistency');
  const module = await Test.createTestingModule({
    providers: [
      DashboardService,
      { provide: TrainingCalendarService, useValue: f.calendar },
      { provide: TrainingTrendsService, useValue: f.trends },
      { provide: TrainingConsistencyService, useValue: f.consistency },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    ...f,
    service: module.get(DashboardService),
    calls: { calendar, trends, consistency },
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
    'comparison',
    'consistency',
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
  assert.deepEqual(
    await f.service.getSummary(f.owner, future),
    emptyDashboard(future),
  );
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
void test('dashboard launches all three independent reads before awaiting results', async (context) => {
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
  f.calls.consistency.mock.mockImplementation(async () => {
    await gate;
    return f.consistencyData;
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
