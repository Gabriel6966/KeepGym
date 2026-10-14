import type { WeeklyMuscleGroups } from '../../src/features/progress/muscle.types';
export const muscleRange = {
  fromWeekStart: '2026-09-21',
  toWeekStart: '2026-10-05',
};
export function muscleWeeks(): WeeklyMuscleGroups {
  return {
    timezone: 'Europe/Madrid',
    from: '2026-09-20T22:00:00.000Z',
    to: '2026-10-11T21:59:59.999Z',
    buckets: [
      {
        weekStart: '2026-09-21',
        muscleGroups: [
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 1,
            completedSets: 4,
            totalReps: 32,
            totalVolumeKg: 2400.5,
          },
          {
            muscleGroup: 'TRICEPS',
            completedWorkouts: 1,
            completedSets: 8,
            totalReps: 80,
            totalVolumeKg: 2000,
          },
        ],
      },
      {
        weekStart: '2026-10-05',
        muscleGroups: [
          {
            muscleGroup: 'BACK',
            completedWorkouts: 1,
            completedSets: 2,
            totalReps: 16,
            totalVolumeKg: 0,
          },
          {
            muscleGroup: 'CHEST',
            completedWorkouts: 2,
            completedSets: 3,
            totalReps: 21,
            totalVolumeKg: 1727.25,
          },
        ],
      },
    ],
  };
}
