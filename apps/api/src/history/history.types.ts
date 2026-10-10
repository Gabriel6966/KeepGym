import type { Prisma } from '../generated/prisma/client';
import type {
  PublicSetEntry,
  PublicWorkoutSessionExercise,
} from '../workout-sessions/workout-sessions.types';

export const historyStatuses = ['COMPLETED', 'CANCELLED'] as const;
export interface RecentWorkoutsQueryInput {
  limit?: number;
}
// NUMERIC/count aggregates remain lossless text until the public boundary.
export interface RecentWorkoutRecord {
  id: string;
  name: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: string | null;
  completedSets: string;
  totalReps: string;
  totalVolumeKg: string;
}
export interface PublicRecentWorkout {
  id: string;
  name: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}
export interface PublicRecentWorkouts {
  items: PublicRecentWorkout[];
}
export type HistoryStatus = (typeof historyStatuses)[number];
export interface HistoryQueryInput {
  status?: HistoryStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
export interface WorkoutHistoryQueryInput extends HistoryQueryInput {
  q?: string;
}
export interface HistoryQuery {
  status?: HistoryStatus;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}
export interface WorkoutHistoryQuery extends HistoryQuery {
  q?: string;
}
export interface ExerciseHistoryQuery extends HistoryQuery {
  status: HistoryStatus;
}
export interface HistoryPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const historySessionSelect = {
  id: true,
  name: true,
  status: true,
  startedAt: true,
  endedAt: true,
} satisfies Prisma.WorkoutSessionSelect;
export const historySetSelect = {
  id: true,
  position: true,
  loadKg: true,
  reps: true,
  rpe: true,
  rir: true,
  completedAt: true,
} satisfies Prisma.SetEntrySelect;
export const historyExerciseSelect = {
  id: true,
  position: true,
  sourceExerciseId: true,
  exerciseName: true,
  exerciseSlug: true,
  primaryMuscle: true,
  secondaryMuscles: true,
  equipment: true,
  movementPattern: true,
  plannedSets: true,
  plannedRepsMin: true,
  plannedRepsMax: true,
  plannedRestSeconds: true,
  plannedNotes: true,
  sets: { orderBy: { position: 'asc' }, select: historySetSelect },
} satisfies Prisma.WorkoutSessionExerciseSelect;
export const workoutHistorySummarySelect = {
  ...historySessionSelect,
  // Prisma batches this relation for the entire page; no SetEntry rows are loaded.
  exercises: { select: { _count: { select: { sets: true } } } },
} satisfies Prisma.WorkoutSessionSelect;
export const workoutHistoryDetailSelect = {
  ...historySessionSelect,
  notes: true,
  exercises: { orderBy: { position: 'asc' }, select: historyExerciseSelect },
} satisfies Prisma.WorkoutSessionSelect;
export const exerciseHistorySelect = {
  ...historyExerciseSelect,
  workoutSession: { select: historySessionSelect },
} satisfies Prisma.WorkoutSessionExerciseSelect;

export type WorkoutHistorySummaryRecord = Prisma.WorkoutSessionGetPayload<{
  select: typeof workoutHistorySummarySelect;
}>;
export type WorkoutHistoryDetailRecord = Prisma.WorkoutSessionGetPayload<{
  select: typeof workoutHistoryDetailSelect;
}>;
export type ExerciseHistoryRecord = Prisma.WorkoutSessionExerciseGetPayload<{
  select: typeof exerciseHistorySelect;
}>;
export type HistoryExerciseRecord = Prisma.WorkoutSessionExerciseGetPayload<{
  select: typeof historyExerciseSelect;
}>;
export type HistorySetRecord = Prisma.SetEntryGetPayload<{
  select: typeof historySetSelect;
}>;

export interface WorkoutHistorySummary {
  id: string;
  name: string;
  status: HistoryStatus;
  startedAt: Date;
  endedAt: Date | null;
  exerciseCount: number;
  setCount: number;
}
export interface WorkoutHistoryDetail extends Omit<
  WorkoutHistorySummary,
  'exerciseCount' | 'setCount'
> {
  notes: string | null;
  exercises: PublicWorkoutSessionExercise[];
}
export interface ExerciseHistoryEntry {
  sessionId: string;
  sessionName: string;
  sessionStatus: HistoryStatus;
  startedAt: Date;
  endedAt: Date | null;
  sessionExerciseId: string;
  exercise: PublicWorkoutSessionExercise['exercise'];
  plannedSets: number;
  plannedRepsMin: number;
  plannedRepsMax: number;
  plannedRestSeconds: number;
  plannedNotes: string | null;
  sets: PublicSetEntry[];
}
