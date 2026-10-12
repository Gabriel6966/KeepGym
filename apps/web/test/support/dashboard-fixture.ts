import type { DashboardSummary } from '../../src/features/dashboard/dashboard.types';

export function emptyDashboard(): DashboardSummary {
  const comparison = () => ({ previous: 0, delta: 0, percentageChange: null });
  const body = () => ({ latest: null, previous: null, change: null });
  return {
    weekStart: '2026-10-12',
    timezone: 'Europe/Madrid',
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
      previousWeekStart: '2026-10-05',
      completedWorkouts: comparison(),
      completedSets: comparison(),
      totalReps: comparison(),
      totalVolumeKg: comparison(),
    },
    consistency: {
      windowWeeks: 12,
      fromWeekStart: '2026-07-27',
      toWeekStart: '2026-10-12',
      activeWeeks: 0,
      longestWeeklyStreak: 0,
      endingWeeklyStreak: 0,
    },
    recentWorkouts: [],
    personalRecords: [],
    exerciseHighlights: [],
    muscleGroups: [],
    bodyProgress: {
      weightKg: body(),
      bodyFatPercent: body(),
      waistCm: body(),
      chestCm: body(),
      hipsCm: body(),
    },
  };
}
export function populatedDashboard(): DashboardSummary {
  const data = emptyDashboard();
  data.week = {
    completedWorkouts: 4,
    completedSets: 4,
    totalReps: 33,
    totalVolumeKg: 1855.75,
    activeDays: 3,
    totalDurationSeconds: 9300.5,
    averageDurationSeconds: 2325.125,
  };
  data.comparison.completedWorkouts = {
    previous: 3,
    delta: 1,
    percentageChange: 33.33,
  };
  data.comparison.completedSets = {
    previous: 3,
    delta: 1,
    percentageChange: 33.33,
  };
  data.comparison.totalReps = { previous: 30, delta: 3, percentageChange: 10 };
  data.comparison.totalVolumeKg = {
    previous: 1500,
    delta: 355.75,
    percentageChange: 23.72,
  };
  data.consistency.activeWeeks = 10;
  data.consistency.longestWeeklyStreak = 5;
  data.consistency.endingWeeklyStreak = 5;
  data.recentWorkouts = [
    {
      id: 'session-1',
      name: 'Historical Push Day',
      startedAt: '2026-10-12T08:00:00Z',
      endedAt: '2026-10-12T09:00:00.500Z',
      durationSeconds: 3600.5,
      completedSets: 2,
      totalReps: 16,
      totalVolumeKg: 1280,
    },
  ];
  const exercise = {
    sourceExerciseId: 'bench-1',
    name: 'Bench snapshot',
    slug: 'bench-snapshot',
  };
  data.personalRecords = [
    {
      type: 'MAX_LOAD',
      exercise,
      valueKg: 100,
      achievedAt: '2026-09-01T10:00:00Z',
      workoutSessionId: 'session-pr',
      setEntryId: 'set-pr',
      loadKg: 100,
      reps: 5,
    },
    {
      type: 'ESTIMATED_1RM',
      exercise,
      valueKg: 120,
      achievedAt: '2026-09-10T10:00:00Z',
      workoutSessionId: 'session-pr2',
      setEntryId: 'set-pr2',
      loadKg: 90,
      reps: 10,
    },
  ];
  data.exerciseHighlights = [
    {
      exercise,
      latest: {
        workoutSessionId: 'session-1',
        startedAt: '2026-10-12T08:00:00Z',
        completedSets: 3,
        totalReps: 26,
        totalVolumeKg: 1280,
        maxLoadKg: 80,
        bestEstimated1RMKg: 101.33,
      },
      previous: {
        workoutSessionId: 'session-0',
        startedAt: '2026-10-05T08:00:00Z',
        completedSets: 2,
        totalReps: 16,
        totalVolumeKg: 1200,
        maxLoadKg: 75,
        bestEstimated1RMKg: 95,
      },
    },
  ];
  data.muscleGroups = [
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
      completedSets: 5,
      totalReps: 40,
      totalVolumeKg: 3080,
    },
    {
      muscleGroup: 'TRICEPS',
      completedWorkouts: 1,
      completedSets: 2,
      totalReps: 20,
      totalVolumeKg: 500,
    },
  ];
  data.bodyProgress.weightKg = {
    latest: { value: 79.25, measuredAt: '2026-09-20T06:00:00Z' },
    previous: { value: 80.5, measuredAt: '2026-09-01T06:00:00Z' },
    change: -1.25,
  };
  data.bodyProgress.waistCm = {
    latest: { value: 85, measuredAt: '2026-09-10T06:00:00Z' },
    previous: null,
    change: null,
  };
  return data;
}
