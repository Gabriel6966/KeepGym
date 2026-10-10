import { Injectable } from '@nestjs/common';
import { sumMetrics } from '../analytics/analytics.math';
import { iterateCalendarDays } from '../common/calendar-date';
import { TrainingCalendarService } from '../training-calendar/training-calendar.service';
import { TrainingTrendsService } from '../training-trends/training-trends.service';
import { TrainingConsistencyService } from '../training-consistency/training-consistency.service';
import {
  calculateAverageDuration,
  roundDurationSeconds,
  sumDurationSeconds,
} from '../training-duration/training-duration.math';
import { DashboardReadError } from './errors/dashboard-read.error';
import { normalizeDashboardSummary } from './dashboard.validation';
import type {
  DashboardSummaryInput,
  PublicDashboardSummary,
} from './dashboard.types';

function sumCounts(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new DashboardReadError();
    total += value;
    if (!Number.isSafeInteger(total)) throw new DashboardReadError();
  }
  return total;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly calendar: TrainingCalendarService,
    private readonly trends: TrainingTrendsService,
    private readonly consistency: TrainingConsistencyService,
  ) {}

  async getSummary(
    userId: string,
    input: DashboardSummaryInput,
  ): Promise<PublicDashboardSummary> {
    const query = normalizeDashboardSummary(userId, input);
    try {
      // Independent domain reads, not a cross-domain transactional snapshot.
      // Concurrent writes may become visible at slightly different instants.
      const [calendar, comparison, consistency] = await Promise.all([
        this.calendar.getDays(userId, {
          fromDate: query.weekStart,
          toDate: query.toDate,
          timezone: query.timezone,
        }),
        this.trends.getWeeklyComparison(userId, {
          weekStart: query.weekStart,
          timezone: query.timezone,
        }),
        this.consistency.getWeeklyConsistency(userId, {
          fromWeekStart: query.fromWeekStart,
          toWeekStart: query.weekStart,
          timezone: query.timezone,
        }),
      ]);
      const dates = [...iterateCalendarDays(query.weekStart, query.toDate)];
      if (
        calendar.days.length !== 7 ||
        calendar.days.some((day, index) => day.date !== dates[index]) ||
        consistency.totalWeeks !== 12 ||
        consistency.fromWeekStart !== query.fromWeekStart ||
        consistency.toWeekStart !== query.weekStart
      )
        throw new DashboardReadError();
      const completedWorkouts = sumCounts(
        calendar.days.map((day) => day.completedWorkouts),
      );
      const duration = sumDurationSeconds(
        calendar.days.map((day) => String(day.totalDurationSeconds)),
      );
      const metric = (
        key:
          'completedWorkouts' | 'completedSets' | 'totalReps' | 'totalVolumeKg',
      ) => ({
        previous: comparison.previous[key],
        delta: comparison.changes[key].delta,
        percentageChange: comparison.changes[key].percentageChange,
      });
      return {
        timezone: query.timezone,
        weekStart: query.weekStart,
        week: {
          completedWorkouts,
          completedSets: sumCounts(
            calendar.days.map((day) => day.completedSets),
          ),
          totalReps: sumCounts(calendar.days.map((day) => day.totalReps)),
          totalVolumeKg: sumMetrics(
            calendar.days.map((day) => day.totalVolumeKg),
          ),
          activeDays: calendar.days.filter((day) => day.completedWorkouts > 0)
            .length,
          totalDurationSeconds: roundDurationSeconds(duration),
          averageDurationSeconds: calculateAverageDuration(
            duration,
            completedWorkouts,
          ),
        },
        comparison: {
          previousWeekStart: comparison.previous.weekStart,
          completedWorkouts: metric('completedWorkouts'),
          completedSets: metric('completedSets'),
          totalReps: metric('totalReps'),
          totalVolumeKg: metric('totalVolumeKg'),
        },
        consistency: {
          windowWeeks: 12,
          fromWeekStart: consistency.fromWeekStart,
          toWeekStart: consistency.toWeekStart,
          activeWeeks: consistency.activeWeeks,
          longestWeeklyStreak: consistency.longestWeeklyStreak,
          endingWeeklyStreak: consistency.endingWeeklyStreak,
        },
      };
    } catch {
      // No partial/zero success and no leaking subservice exception details.
      throw new DashboardReadError();
    }
  }
}
