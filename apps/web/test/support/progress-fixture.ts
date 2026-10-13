import type {
  ExerciseAnalytics,
  ExerciseRecords,
  ExerciseWeeklyTrends,
  HistoricalExercise,
} from '../../src/features/progress/progress.types';
export const exerciseId = '11111111-1111-4111-8111-111111111111',
  occurrenceId = '22222222-2222-4222-8222-222222222222',
  templateEntryId = '33333333-3333-4333-8333-333333333333',
  setId = '44444444-4444-4444-8444-444444444444',
  sessionId = '55555555-5555-4555-8555-555555555555';
export const snapshot = (): HistoricalExercise => ({
  sourceExerciseId: exerciseId,
  name: 'Historical Bench',
  slug: 'historical-bench',
  primaryMuscle: 'CHEST',
  secondaryMuscles: ['TRICEPS'],
  equipment: 'BARBELL',
  movementPattern: 'HORIZONTAL_PUSH',
});
export const fixtureSet = () => ({
  id: setId,
  position: 1,
  loadKg: 100,
  reps: 5,
  rpe: null,
  rir: null,
  completedAt: '2026-09-01T08:00:00Z',
});
export function exerciseAnalytics(): ExerciseAnalytics {
  const candidate = {
    sessionId,
    sessionName: 'Push Original',
    sessionStartedAt: '2026-09-01T08:00:00Z',
    sessionExerciseId: occurrenceId,
    setId,
    position: 1,
    loadKg: 100,
    reps: 5,
    rpe: null,
    rir: null,
    completedAt: '2026-09-01T08:00:00Z',
  };
  return {
    exercise: snapshot(),
    summary: {
      sessions: 1,
      sets: 1,
      reps: 5,
      totalVolumeKg: 500,
      maxLoadKg: 100,
      maxEstimated1RMKg: 116.67,
    },
    heaviestSet: candidate,
    bestEstimated1RMSet: { ...candidate, estimated1RMKg: 116.67 },
    performances: [
      {
        sessionId,
        sessionName: 'Push Original',
        startedAt: '2026-09-01T08:00:00Z',
        endedAt: '2026-09-01T09:00:00Z',
        sessionExerciseId: occurrenceId,
        exercise: snapshot(),
        setCount: 1,
        repCount: 5,
        volumeKg: 500,
        maxLoadKg: 100,
        maxEstimated1RMKg: 116.67,
        sets: [{ ...fixtureSet(), estimated1RMKg: 116.67 }],
      },
    ],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };
}
export function exerciseRecords(): ExerciseRecords {
  const record = {
    valueKg: 100,
    achievedAt: '2026-09-01T08:00:00Z',
    session: {
      id: sessionId,
      name: 'First achievement workout',
      startedAt: '2026-09-01T08:00:00Z',
    },
    set: fixtureSet(),
  };
  return {
    exercise: snapshot(),
    maxLoadRecord: { ...record, type: 'MAX_LOAD' },
    estimated1RMRecord: { ...record, type: 'ESTIMATED_1RM', valueKg: 116.67 },
  };
}
export function exerciseTrends(): ExerciseWeeklyTrends {
  return {
    exercise: snapshot(),
    timezone: 'Europe/Madrid',
    from: '2026-09-01T00:00:00+02:00',
    to: '2026-10-12T23:59:59.999+02:00',
    buckets: [
      {
        weekStart: '2026-08-31',
        completedWorkouts: 1,
        completedSets: 2,
        totalReps: 16,
        totalVolumeKg: 1280,
        maxLoadKg: 80,
        maxEstimated1RMKg: 101.33,
      },
      {
        weekStart: '2026-09-14',
        completedWorkouts: 1,
        completedSets: 1,
        totalReps: 10,
        totalVolumeKg: 0,
        maxLoadKg: 0,
        maxEstimated1RMKg: null,
      },
      {
        weekStart: '2026-10-05',
        completedWorkouts: 1,
        completedSets: 1,
        totalReps: 25,
        totalVolumeKg: 1250,
        maxLoadKg: 50,
        maxEstimated1RMKg: null,
      },
    ],
  };
}
