import { Injectable } from '@nestjs/common';
import { roundMetric } from '../analytics/analytics.math';
import { TrainingTrendsPersistenceError } from './errors/training-trends-persistence.error';
import { TrainingTrendsRepository } from './training-trends.repository';
import { normalizeWeeklyTrainingTrends } from './training-trends.validation';
import type {
  PublicWeeklyTrainingTrends,
  WeeklyTrainingTrendsInput,
} from './training-trends.types';

function count(value: string): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result))
    throw new TrainingTrendsPersistenceError();
  return result;
}

@Injectable()
export class TrainingTrendsService {
  constructor(private readonly repository: TrainingTrendsRepository) {}

  async getWeeklyTrends(
    userId: string,
    input: WeeklyTrainingTrendsInput,
  ): Promise<PublicWeeklyTrainingTrends> {
    const query = normalizeWeeklyTrainingTrends(userId, input);
    const rows = await this.repository.findWeeklyTrends(userId, query);
    try {
      return {
        timezone: query.timezone,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        buckets: rows.map((row) => ({
          weekStart: row.weekStart,
          completedWorkouts: count(row.completedWorkouts),
          completedSets: count(row.completedSets),
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
        })),
      };
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }
}
