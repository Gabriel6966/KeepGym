import type { Prisma, WorkoutSession } from '../generated/prisma/client';
import type {
  Equipment,
  MovementPattern,
  MuscleGroup,
  WorkoutSessionStatus,
} from '../generated/prisma/enums';

// Historical reads never join a mutable source template or catalog exercise.
export const sessionInclude = {
  exercises: {
    orderBy: { position: 'asc' },
    include: { sets: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.WorkoutSessionInclude;

export type WorkoutSessionRecord = Prisma.WorkoutSessionGetPayload<{
  include: typeof sessionInclude;
}>;
export type TerminalWorkoutSessionStatus = Exclude<
  WorkoutSessionStatus,
  'IN_PROGRESS'
>;
export interface StartWorkoutSessionInput {
  workoutTemplateId: string;
}
export interface ListWorkoutSessionsInput {
  status?: WorkoutSessionStatus;
  page?: number;
  limit?: number;
}
export interface WorkoutSessionListQuery {
  status?: WorkoutSessionStatus;
  page: number;
  limit: number;
}

export interface PublicWorkoutSessionSummary {
  id: string;
  name: string;
  status: WorkoutSessionStatus;
  notes: string | null;
  startedAt: Date;
  endedAt: Date | null;
}
export interface PublicWorkoutSessionExercise {
  id: string;
  position: number;
  exercise: {
    sourceExerciseId: string | null;
    name: string;
    slug: string;
    primaryMuscle: MuscleGroup;
    secondaryMuscles: MuscleGroup[];
    equipment: Equipment;
    movementPattern: MovementPattern;
  };
  plannedSets: number;
  plannedRepsMin: number;
  plannedRepsMax: number;
  plannedRestSeconds: number;
  plannedNotes: string | null;
  sets: PublicSetEntry[];
}
export interface PublicWorkoutSession extends PublicWorkoutSessionSummary {
  exercises: PublicWorkoutSessionExercise[];
}
export interface WorkoutSessionPage {
  items: PublicWorkoutSessionSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export type WorkoutSessionListRecord = WorkoutSession;

export interface CreateSetEntryInput {
  loadKg: number;
  reps: number;
  rpe?: number | null;
  rir?: number | null;
}
export type UpdateSetEntryInput = Partial<CreateSetEntryInput>;
export interface PublicSetEntry {
  id: string;
  position: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  completedAt: Date;
}
