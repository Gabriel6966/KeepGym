import { Injectable } from '@nestjs/common';
import {
  iterateCalendarDays,
  parseCalendarDate,
} from '../common/calendar-date';
import { roundMetric } from '../analytics/analytics.math';
import {
  roundDurationSeconds,
  sumDurationSeconds,
} from '../training-duration/training-duration.math';
import { TrainingCalendarPersistenceError } from './errors/training-calendar-persistence.error';
import { TrainingCalendarRepository } from './training-calendar.repository';
import { normalizeTrainingCalendar } from './training-calendar.validation';
import type {
  PublicActivityDay,
  PublicTrainingCalendar,
  TrainingCalendarInput,
} from './training-calendar.types';

function count(value: string): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result))
    throw new TrainingCalendarPersistenceError();
  return result;
}
@Injectable()
export class TrainingCalendarService {
  constructor(private readonly repository: TrainingCalendarRepository) {}
  async getDays(
    userId: string,
    input: TrainingCalendarInput,
  ): Promise<PublicTrainingCalendar> {
    const query = normalizeTrainingCalendar(userId, input);
    try {
      const rows = await this.repository.findDailyActivity(userId, query);
      const days = new Map<string, PublicActivityDay>();
      for (const date of iterateCalendarDays(query.fromDate, query.toDate))
        days.set(date, {
          date,
          completedWorkouts: 0,
          completedSets: 0,
          totalReps: 0,
          totalVolumeKg: 0,
          totalDurationSeconds: 0,
        });
      const seen = new Set<string>();
      for (const row of rows) {
        if (
          !parseCalendarDate(row.date) ||
          !days.has(row.date) ||
          seen.has(row.date) ||
          row.invalidDurationCount !== '0' ||
          row.totalDurationSeconds === null ||
          !/^\d+(?:\.\d{1,2})?$/.test(row.totalVolumeKg)
        )
          throw new TrainingCalendarPersistenceError();
        const completedWorkouts = count(row.completedWorkouts);
        if (completedWorkouts < 1) throw new TrainingCalendarPersistenceError();
        seen.add(row.date);
        days.set(row.date, {
          date: row.date,
          completedWorkouts,
          completedSets: count(row.completedSets),
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
          totalDurationSeconds: roundDurationSeconds(
            sumDurationSeconds([row.totalDurationSeconds]),
          ),
        });
      }
      return {
        timezone: query.timezone,
        fromDate: query.fromDate,
        toDate: query.toDate,
        days: [...days.values()],
      };
    } catch {
      throw new TrainingCalendarPersistenceError();
    }
  }
}
