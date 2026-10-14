import type {
  WeeklyTraining,
  WeeklyConsistency,
  WeeklyDuration,
} from '../../src/features/progress/training.types';
export const trainingRange = {
  fromWeekStart: '2026-09-21',
  toWeekStart: '2026-10-12',
};
export const trainingPeriod = {
  from: '2026-09-20T22:00:00.000Z',
  to: '2026-10-18T21:59:59.999Z',
  timezone: 'Europe/Madrid',
};
export function weeklyTraining(): WeeklyTraining {
  return {
    ...trainingPeriod,
    buckets: [
      {
        weekStart: '2026-09-21',
        completedWorkouts: 1,
        completedSets: 2,
        totalReps: 16,
        totalVolumeKg: 1280,
      },
      {
        weekStart: '2026-10-05',
        completedWorkouts: 1,
        completedSets: 2,
        totalReps: 16,
        totalVolumeKg: 0,
      },
      {
        weekStart: '2026-10-12',
        completedWorkouts: 2,
        completedSets: 1,
        totalReps: 7,
        totalVolumeKg: 575.75,
      },
    ],
  };
}
export function weeklyConsistency(): WeeklyConsistency {
  return {
    ...trainingRange,
    timezone: 'Europe/Madrid',
    totalWeeks: 4,
    completedWorkouts: 4,
    activeDays: 4,
    activeWeeks: 3,
    longestWeeklyStreak: 2,
    endingWeeklyStreak: 2,
  };
}
export function weeklyDuration(): WeeklyDuration {
  return {
    ...trainingPeriod,
    summary: {
      completedWorkouts: 4,
      totalDurationSeconds: 9300.5,
      averageDurationSeconds: 2325.125,
    },
    buckets: [
      {
        weekStart: '2026-09-21',
        completedWorkouts: 1,
        totalDurationSeconds: 2700,
        averageDurationSeconds: 2700,
      },
      {
        weekStart: '2026-10-05',
        completedWorkouts: 1,
        totalDurationSeconds: 1200,
        averageDurationSeconds: 1200,
      },
      {
        weekStart: '2026-10-12',
        completedWorkouts: 2,
        totalDurationSeconds: 5400.5,
        averageDurationSeconds: 2700.25,
      },
    ],
  };
}
