import { Injectable } from '@nestjs/common';
import { parseLocalMonday } from '../common/calendar-week';
import { TrainingDurationPersistenceError } from './errors/training-duration-persistence.error';
import {
  calculateAverageDuration,
  roundDurationSeconds,
  sumDurationSeconds,
} from './training-duration.math';
import { TrainingDurationRepository } from './training-duration.repository';
import { normalizeWeeklyTrainingDuration } from './training-duration.validation';
import type {
  PublicDurationBucket,
  PublicWeeklyTrainingDuration,
  WeeklyTrainingDurationInput,
} from './training-duration.types';

@Injectable()
export class TrainingDurationService {
  constructor(private readonly repository: TrainingDurationRepository) {}

  async getWeeklyDuration(
    userId: string,
    input: WeeklyTrainingDurationInput,
  ): Promise<PublicWeeklyTrainingDuration> {
    const query = normalizeWeeklyTrainingDuration(userId, input);
    try {
      const rows = await this.repository.findWeeklyDurations(userId, query);
      const seen = new Set<string>();
      const totals: string[] = [];
      let completedWorkouts = 0;
      const buckets: PublicDurationBucket[] = rows.map((row) => {
        const count = Number(row.completedWorkouts);
        if (
          !parseLocalMonday(row.weekStart) ||
          seen.has(row.weekStart) ||
          !/^\d+$/.test(row.completedWorkouts) ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          row.invalidDurationCount !== '0' ||
          row.totalDurationSeconds === null
        )
          throw new TrainingDurationPersistenceError();
        seen.add(row.weekStart);
        totals.push(row.totalDurationSeconds);
        completedWorkouts += count;
        const average = calculateAverageDuration(
          row.totalDurationSeconds,
          count,
        );
        if (average === null) throw new TrainingDurationPersistenceError();
        return {
          weekStart: row.weekStart,
          completedWorkouts: count,
          totalDurationSeconds: roundDurationSeconds(row.totalDurationSeconds),
          averageDurationSeconds: average,
        };
      });
      if (!Number.isSafeInteger(completedWorkouts))
        throw new TrainingDurationPersistenceError();
      // Sum exact millisecond totals, never rounded bucket averages.
      const total = sumDurationSeconds(totals);
      return {
        timezone: query.timezone,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        summary: {
          completedWorkouts,
          totalDurationSeconds: roundDurationSeconds(total),
          averageDurationSeconds: calculateAverageDuration(
            total,
            completedWorkouts,
          ),
        },
        buckets: buckets.sort((a, b) =>
          a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0,
        ),
      };
    } catch {
      throw new TrainingDurationPersistenceError();
    }
  }
}
