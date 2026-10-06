import type { TrainingTrendsRepository } from '../../src/training-trends/training-trends.repository';
import type {
  WeeklyComparisonQuery,
  WeeklyTrainingTrendsRecord,
} from '../../src/training-trends/training-trends.types';
import {
  InMemoryTrainingTrendsRepository,
  localMonday,
  trainingTrendsFixture,
} from './in-memory-training-trends.repository';

export const comparisonInput = {
  weekStart: '2026-09-28',
  timezone: 'Europe/Madrid',
};
export const expectedComparison = {
  timezone: 'Europe/Madrid',
  previous: {
    weekStart: '2026-09-21',
    completedWorkouts: 2,
    completedSets: 2,
    totalReps: 16,
    totalVolumeKg: 1280,
  },
  current: {
    weekStart: '2026-09-28',
    completedWorkouts: 1,
    completedSets: 2,
    totalReps: 14,
    totalVolumeKg: 1151.5,
  },
  changes: {
    completedWorkouts: { delta: -1, percentageChange: -50 },
    completedSets: { delta: 0, percentageChange: 0 },
    totalReps: { delta: -2, percentageChange: -12.5 },
    totalVolumeKg: { delta: -128.5, percentageChange: -10.04 },
  },
};

export class InMemoryWeeklyComparisonRepository
  extends InMemoryTrainingTrendsRepository
  implements Pick<TrainingTrendsRepository, 'findWeeklyComparison'>
{
  findWeeklyComparison(
    userId: string,
    query: WeeklyComparisonQuery,
  ): Promise<WeeklyTrainingTrendsRecord[]> {
    // Independent Intl calendar oracle: select local week labels, not SQL boundaries.
    const matching = this.sessions.filter((session) =>
      [query.weekStart, query.previousWeekStart].includes(
        localMonday(session.startedAt, query.timezone),
      ),
    );
    return new InMemoryTrainingTrendsRepository(matching).findWeeklyTrends(
      userId,
      {
        from: new Date('2000-01-01T00:00:00Z'),
        to: new Date('2200-01-01T00:00:00Z'),
        timezone: query.timezone,
      },
    );
  }
}
export function weeklyComparisonFixture() {
  const f = trainingTrendsFixture();
  for (const session of f.repository.sessions)
    session.startedAt.setUTCDate(session.startedAt.getUTCDate() + 7);
  f.repository.sessions[2]!.sets.push({ loadKg: '82.25', reps: 7 });
  return {
    owner: f.owner,
    other: f.other,
    repository: new InMemoryWeeklyComparisonRepository(f.repository.sessions),
  };
}
