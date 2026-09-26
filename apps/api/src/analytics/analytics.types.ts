import type { Prisma } from '../generated/prisma/client';
import type {
  PublicSetEntry,
  PublicWorkoutSessionExercise,
} from '../workout-sessions/workout-sessions.types';

export interface AnalyticsRangeInput {
  from?: string;
  to?: string;
}
export interface ExerciseAnalyticsInput extends AnalyticsRangeInput {
  page?: number;
  limit?: number;
}
export interface AnalyticsRange {
  from?: Date;
  to?: Date;
}
export interface ExerciseAnalyticsQuery extends AnalyticsRange {
  page: number;
  limit: number;
}

export const analyticsSetSelect = {
  id: true,
  position: true,
  loadKg: true,
  reps: true,
  rpe: true,
  rir: true,
  completedAt: true,
} satisfies Prisma.SetEntrySelect;
export const analyticsMetadataSelect = {
  sourceExerciseId: true,
  exerciseName: true,
  exerciseSlug: true,
} satisfies Prisma.WorkoutSessionExerciseSelect;
export const analyticsPerformanceSelect = {
  ...analyticsMetadataSelect,
  id: true,
  primaryMuscle: true,
  secondaryMuscles: true,
  equipment: true,
  movementPattern: true,
  workoutSession: {
    select: { id: true, name: true, startedAt: true, endedAt: true },
  },
  sets: { select: analyticsSetSelect, orderBy: { position: 'asc' } },
} satisfies Prisma.WorkoutSessionExerciseSelect;
export type AnalyticsMetadataRecord = Prisma.WorkoutSessionExerciseGetPayload<{
  select: typeof analyticsMetadataSelect;
}>;
export type AnalyticsPerformanceRecord =
  Prisma.WorkoutSessionExerciseGetPayload<{
    select: typeof analyticsPerformanceSelect;
  }>;
export type AnalyticsSetRecord = Prisma.SetEntryGetPayload<{
  select: typeof analyticsSetSelect;
}>;

// SQL aggregates are returned as decimal text, avoiding bigint JSON and premature
// float conversion. Only bounded, explicitly selected candidate rows are loaded.
export interface OverviewRecord {
  completedWorkouts: string;
  completedSets: string;
  totalReps: string;
  totalVolumeKg: string;
}
export interface ExerciseSummaryRecord {
  sessions: string;
  sets: string;
  reps: string;
  totalVolumeKg: string;
}
export interface AnalyticsCandidateRecord {
  sessionId: string;
  sessionName: string;
  sessionStartedAt: Date;
  sessionExerciseId: string;
  setId: string;
  position: number;
  loadKg: string;
  reps: number;
  rpe: string | null;
  rir: number | null;
  completedAt: Date;
}
export interface ExerciseAnalyticsRecord {
  summary: ExerciseSummaryRecord;
  exercise: AnalyticsMetadataRecord | null;
  heaviestSet: AnalyticsCandidateRecord | null;
  estimatedCandidates: AnalyticsCandidateRecord[];
  performances: AnalyticsPerformanceRecord[];
}

export interface AnalyticsOverview {
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}
export interface ExerciseAnalyticsSummary {
  sessions: number;
  sets: number;
  reps: number;
  totalVolumeKg: number;
  maxLoadKg: number | null;
  maxEstimated1RMKg: number | null;
}
export interface PublicAnalyticsSet extends PublicSetEntry {
  estimated1RMKg: number | null;
}
export interface PublicAnalyticsCandidate extends Omit<
  AnalyticsCandidateRecord,
  'loadKg' | 'rpe'
> {
  loadKg: number;
  rpe: number | null;
}
export interface Estimated1RMCandidate extends PublicAnalyticsCandidate {
  estimated1RMKg: number;
}
export interface ExercisePerformance {
  sessionId: string;
  sessionName: string;
  startedAt: Date;
  endedAt: Date | null;
  sessionExerciseId: string;
  exercise: PublicWorkoutSessionExercise['exercise'];
  setCount: number;
  repCount: number;
  volumeKg: number;
  maxLoadKg: number | null;
  maxEstimated1RMKg: number | null;
  sets: PublicAnalyticsSet[];
}
export interface ExerciseAnalytics {
  exercise: {
    sourceExerciseId: string | null;
    name: string;
    slug: string;
  } | null;
  summary: ExerciseAnalyticsSummary;
  heaviestSet: PublicAnalyticsCandidate | null;
  bestEstimated1RMSet: Estimated1RMCandidate | null;
  performances: ExercisePerformance[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
