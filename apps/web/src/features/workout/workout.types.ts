import type { MuscleGroup } from '../dashboard/dashboard.types';

export const equipmentValues = [
  'BARBELL',
  'DUMBBELL',
  'MACHINE',
  'CABLE',
  'BODYWEIGHT',
  'KETTLEBELL',
  'SMITH_MACHINE',
  'EZ_BAR',
  'RESISTANCE_BAND',
  'OTHER',
] as const;
export const movementValues = [
  'HORIZONTAL_PUSH',
  'VERTICAL_PUSH',
  'HORIZONTAL_PULL',
  'VERTICAL_PULL',
  'SQUAT',
  'HINGE',
  'LUNGE',
  'ISOLATION',
  'CARRY',
  'OTHER',
] as const;
export const sessionStatuses = [
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];
export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  exercises: {
    id: string;
    position: number;
    targetSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    restSeconds: number;
    notes: string | null;
    exercise: {
      id: string;
      name: string;
      slug: string;
      primaryMuscle: MuscleGroup;
      equipment: (typeof equipmentValues)[number];
      movementPattern: (typeof movementValues)[number];
      isAvailable: boolean;
    };
  }[];
}
export interface ResourcePage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface SetEntry {
  id: string;
  position: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  completedAt: string;
}
export interface SetEntryInput {
  loadKg: number;
  reps: number;
  rpe?: number | null;
  rir?: number | null;
}
export interface SessionExercise {
  id: string;
  position: number;
  exercise: {
    sourceExerciseId: string | null;
    name: string;
    slug: string;
    primaryMuscle: MuscleGroup;
    secondaryMuscles: MuscleGroup[];
    equipment: (typeof equipmentValues)[number];
    movementPattern: (typeof movementValues)[number];
  };
  plannedSets: number;
  plannedRepsMin: number;
  plannedRepsMax: number;
  plannedRestSeconds: number;
  plannedNotes: string | null;
  sets: SetEntry[];
}
export interface WorkoutSessionSummary {
  id: string;
  name: string;
  status: SessionStatus;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
}
export interface WorkoutSession extends WorkoutSessionSummary {
  exercises: SessionExercise[];
}
