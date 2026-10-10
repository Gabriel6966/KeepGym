import { randomUUID } from 'node:crypto';
import { addCalendarDays } from '../../src/common/calendar-date';
import { shiftLocalMonday } from '../../src/common/calendar-week';
import type {
  PublicTrainingCalendar,
  TrainingCalendarInput,
} from '../../src/training-calendar/training-calendar.types';
import type {
  PublicWeeklyComparison,
  WeeklyComparisonInput,
} from '../../src/training-trends/training-trends.types';
import type {
  PublicWeeklyConsistency,
  WeeklyConsistencyInput,
} from '../../src/training-consistency/training-consistency.types';
import type { PublicDashboardSummary } from '../../src/dashboard/dashboard.types';

export const dashboardInput = {
  weekStart: '2026-10-05',
  timezone: 'Europe/Madrid',
};
export const expectedDashboardWeek = {
  completedWorkouts: 4,
  completedSets: 4,
  totalReps: 33,
  totalVolumeKg: 1855.75,
  activeDays: 3,
  totalDurationSeconds: 9300.5,
  averageDurationSeconds: 2325.125,
};
export function emptyCalendar(
  query: TrainingCalendarInput,
): PublicTrainingCalendar {
  return {
    ...query,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: addCalendarDays(query.fromDate, index),
      completedWorkouts: 0,
      completedSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
      totalDurationSeconds: 0,
    })),
  };
}
export function emptyComparison(
  input: WeeklyComparisonInput,
): PublicWeeklyComparison {
  const zero = {
    completedWorkouts: 0,
    completedSets: 0,
    totalReps: 0,
    totalVolumeKg: 0,
  };
  return {
    timezone: input.timezone,
    previous: { weekStart: shiftLocalMonday(input.weekStart, -1), ...zero },
    current: { weekStart: input.weekStart, ...zero },
    changes: {
      completedWorkouts: { delta: 0, percentageChange: null },
      completedSets: { delta: 0, percentageChange: null },
      totalReps: { delta: 0, percentageChange: null },
      totalVolumeKg: { delta: 0, percentageChange: null },
    },
  };
}
export function emptyConsistency(
  input: WeeklyConsistencyInput,
): PublicWeeklyConsistency {
  return {
    ...input,
    totalWeeks: 12,
    completedWorkouts: 0,
    activeDays: 0,
    activeWeeks: 0,
    longestWeeklyStreak: 0,
    endingWeeklyStreak: 0,
  };
}
export function emptyDashboard(input = dashboardInput): PublicDashboardSummary {
  const metric = () => ({ previous: 0, delta: 0, percentageChange: null });
  return {
    ...input,
    week: {
      completedWorkouts: 0,
      completedSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
      activeDays: 0,
      totalDurationSeconds: 0,
      averageDurationSeconds: null,
    },
    comparison: {
      previousWeekStart: shiftLocalMonday(input.weekStart, -1),
      completedWorkouts: metric(),
      completedSets: metric(),
      totalReps: metric(),
      totalVolumeKg: metric(),
    },
    consistency: {
      windowWeeks: 12,
      fromWeekStart: shiftLocalMonday(input.weekStart, -11),
      toWeekStart: input.weekStart,
      activeWeeks: 0,
      longestWeeklyStreak: 0,
      endingWeeklyStreak: 0,
    },
  };
}
export function dashboardServices() {
  const owner = randomUUID();
  const calendarData = emptyCalendar({
    fromDate: dashboardInput.weekStart,
    toDate: '2026-10-11',
    timezone: dashboardInput.timezone,
  });
  Object.assign(calendarData.days[0]!, {
    completedWorkouts: 2,
    completedSets: 2,
    totalReps: 16,
    totalVolumeKg: 1280,
    totalDurationSeconds: 4500,
  });
  Object.assign(calendarData.days[2]!, {
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 7,
    totalVolumeKg: 575.75,
    totalDurationSeconds: 3600.5,
  });
  Object.assign(calendarData.days[5]!, {
    completedWorkouts: 1,
    completedSets: 1,
    totalReps: 10,
    totalVolumeKg: 0,
    totalDurationSeconds: 1200,
  });
  const comparisonData = emptyComparison(dashboardInput);
  Object.assign(comparisonData.previous, {
    completedWorkouts: 3,
    completedSets: 3,
    totalReps: 30,
    totalVolumeKg: 1500,
  });
  Object.assign(comparisonData.current, {
    completedWorkouts: 4,
    completedSets: 4,
    totalReps: 33,
    totalVolumeKg: 1855.75,
  });
  comparisonData.changes = {
    completedWorkouts: { delta: 1, percentageChange: 33.33 },
    completedSets: { delta: 1, percentageChange: 33.33 },
    totalReps: { delta: 3, percentageChange: 10 },
    totalVolumeKg: { delta: 355.75, percentageChange: 23.72 },
  };
  const consistencyData = {
    ...emptyConsistency({
      fromWeekStart: '2026-07-20',
      toWeekStart: dashboardInput.weekStart,
      timezone: dashboardInput.timezone,
    }),
    activeWeeks: 10,
    longestWeeklyStreak: 5,
    endingWeeklyStreak: 5,
  };
  const active = (userId: string, week: string) =>
    userId === owner && week === dashboardInput.weekStart;
  return {
    owner,
    calendarData,
    comparisonData,
    consistencyData,
    calendar: {
      async getDays(
        userId: string,
        query: TrainingCalendarInput,
      ): Promise<PublicTrainingCalendar> {
        return structuredClone(
          active(userId, query.fromDate) ? calendarData : emptyCalendar(query),
        );
      },
    },
    trends: {
      async getWeeklyComparison(
        userId: string,
        query: WeeklyComparisonInput,
      ): Promise<PublicWeeklyComparison> {
        return structuredClone(
          active(userId, query.weekStart)
            ? comparisonData
            : emptyComparison(query),
        );
      },
    },
    consistency: {
      async getWeeklyConsistency(
        userId: string,
        query: WeeklyConsistencyInput,
      ): Promise<PublicWeeklyConsistency> {
        return structuredClone(
          active(userId, query.toWeekStart)
            ? consistencyData
            : emptyConsistency(query),
        );
      },
    },
  };
}
