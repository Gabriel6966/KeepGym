import { Injectable } from '@nestjs/common';
import { parseLocalMonday } from '../common/calendar-week';
import { TrainingConsistencyPersistenceError } from './errors/training-consistency-persistence.error';
import {
  calculateEndingWeeklyStreak,
  calculateLongestWeeklyStreak,
} from './training-consistency.math';
import { TrainingConsistencyRepository } from './training-consistency.repository';
import { normalizeWeeklyConsistency } from './training-consistency.validation';
import type {
  PublicWeeklyConsistency,
  WeeklyConsistencyInput,
} from './training-consistency.types';

function positiveCount(value: string): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count < 1)
    throw new TrainingConsistencyPersistenceError();
  return count;
}

@Injectable()
export class TrainingConsistencyService {
  constructor(private readonly repository: TrainingConsistencyRepository) {}

  async getWeeklyConsistency(
    userId: string,
    input: WeeklyConsistencyInput,
  ): Promise<PublicWeeklyConsistency> {
    const query = normalizeWeeklyConsistency(userId, input);
    const rows = await this.repository.findWeeklyActivity(userId, query);
    try {
      const weeks = new Map<
        string,
        { completedWorkouts: number; activeDays: number }
      >();
      for (const row of rows) {
        if (
          !parseLocalMonday(row.weekStart) ||
          row.weekStart < query.fromWeekStart ||
          row.weekStart > query.toWeekStart
        )
          throw new TrainingConsistencyPersistenceError();
        const completedWorkouts = positiveCount(row.completedWorkouts);
        const activeDays = positiveCount(row.activeDays);
        if (activeDays > 7 || activeDays > completedWorkouts)
          throw new TrainingConsistencyPersistenceError();
        // Exact duplicates from test doubles cannot inflate totals or streaks.
        // Conflicting duplicates indicate an invalid read, not additive activity.
        const existing = weeks.get(row.weekStart);
        if (
          existing &&
          (existing.completedWorkouts !== completedWorkouts ||
            existing.activeDays !== activeDays)
        )
          throw new TrainingConsistencyPersistenceError();
        weeks.set(row.weekStart, { completedWorkouts, activeDays });
      }
      let completedWorkouts = 0;
      let activeDays = 0;
      for (const row of weeks.values()) {
        completedWorkouts += row.completedWorkouts;
        activeDays += row.activeDays;
      }
      if (!Number.isSafeInteger(completedWorkouts))
        throw new TrainingConsistencyPersistenceError();
      const activeWeeks = [...weeks.keys()];
      return {
        timezone: query.timezone,
        fromWeekStart: query.fromWeekStart,
        toWeekStart: query.toWeekStart,
        totalWeeks: query.totalWeeks,
        completedWorkouts,
        activeDays,
        activeWeeks: weeks.size,
        longestWeeklyStreak: calculateLongestWeeklyStreak(
          query.fromWeekStart,
          query.toWeekStart,
          activeWeeks,
        ),
        endingWeeklyStreak: calculateEndingWeeklyStreak(
          query.fromWeekStart,
          query.toWeekStart,
          activeWeeks,
        ),
      };
    } catch {
      throw new TrainingConsistencyPersistenceError();
    }
  }
}
