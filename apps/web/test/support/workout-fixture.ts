import type {
  ResourcePage,
  SetEntry,
  WorkoutSession,
  WorkoutTemplate,
} from '../../src/features/workout/workout.types';

export const sessionId = '11111111-1111-4111-8111-111111111111';
export const exerciseId = '22222222-2222-4222-8222-222222222222';
export const templateId = '33333333-3333-4333-8333-333333333333';
export const setId = '44444444-4444-4444-8444-444444444444';
export function setFixture(changes: Partial<SetEntry> = {}): SetEntry {
  return {
    id: setId,
    position: 1,
    loadKg: 82.25,
    reps: 7,
    rpe: 8.5,
    rir: 2,
    completedAt: '2026-10-12T10:00:00.000Z',
    ...changes,
  };
}
export function sessionFixture(): WorkoutSession {
  return {
    id: sessionId,
    name: 'Historical Push',
    status: 'IN_PROGRESS',
    notes: null,
    startedAt: '2026-10-12T09:00:00.000Z',
    endedAt: null,
    exercises: [
      {
        id: exerciseId,
        position: 1,
        exercise: {
          sourceExerciseId: '55555555-5555-4555-8555-555555555555',
          name: 'Historical Bench',
          slug: 'historical-bench',
          primaryMuscle: 'CHEST',
          secondaryMuscles: ['TRICEPS'],
          equipment: 'BARBELL',
          movementPattern: 'HORIZONTAL_PUSH',
        },
        plannedSets: 3,
        plannedRepsMin: 8,
        plannedRepsMax: 10,
        plannedRestSeconds: 90,
        plannedNotes: 'Historical planning only',
        sets: [setFixture()],
      },
    ],
  };
}
export function templateFixture(): WorkoutTemplate {
  return {
    id: templateId,
    name: 'Push template',
    description: 'Existing planning',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    exercises: [
      {
        id: exerciseId,
        position: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
        restSeconds: 90,
        notes: null,
        exercise: {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Current catalog Bench',
          slug: 'catalog-bench',
          primaryMuscle: 'CHEST',
          equipment: 'BARBELL',
          movementPattern: 'HORIZONTAL_PUSH',
          isAvailable: true,
        },
      },
    ],
  };
}
export function templatePage(): ResourcePage<WorkoutTemplate> {
  return {
    items: [templateFixture()],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };
}
