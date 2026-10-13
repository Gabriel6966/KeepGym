import type { SessionExercise, SetEntry } from '../workout/workout.types';

export type HistoricalExercise = SessionExercise['exercise'];
export type ExerciseMetadata = Pick<
  HistoricalExercise,
  'sourceExerciseId' | 'name' | 'slug'
>;
export interface AnalyticsSet extends SetEntry {
  estimated1RMKg: number | null;
}
export interface AnalyticsCandidate {
  sessionId: string;
  sessionName: string;
  sessionStartedAt: string;
  sessionExerciseId: string;
  setId: string;
  position: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  completedAt: string;
}
export interface EstimatedCandidate extends AnalyticsCandidate {
  estimated1RMKg: number;
}
export interface ExercisePerformance {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  endedAt: string | null;
  sessionExerciseId: string;
  exercise: HistoricalExercise;
  setCount: number;
  repCount: number;
  volumeKg: number;
  maxLoadKg: number | null;
  maxEstimated1RMKg: number | null;
  sets: AnalyticsSet[];
}
export interface ExerciseAnalytics {
  exercise: ExerciseMetadata | null;
  summary: {
    sessions: number;
    sets: number;
    reps: number;
    totalVolumeKg: number;
    maxLoadKg: number | null;
    maxEstimated1RMKg: number | null;
  };
  heaviestSet: AnalyticsCandidate | null;
  bestEstimated1RMSet: EstimatedCandidate | null;
  performances: ExercisePerformance[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface ExerciseRecord {
  type: 'MAX_LOAD' | 'ESTIMATED_1RM';
  valueKg: number;
  achievedAt: string;
  session: { id: string; name: string; startedAt: string };
  set: SetEntry;
}
export interface ExerciseRecords {
  exercise: HistoricalExercise | null;
  maxLoadRecord: ExerciseRecord | null;
  estimated1RMRecord: ExerciseRecord | null;
}
export interface ExerciseWeeklyBucket {
  weekStart: string;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
  maxLoadKg: number;
  maxEstimated1RMKg: number | null;
}
export interface ExerciseWeeklyTrends {
  exercise: HistoricalExercise | null;
  timezone: string;
  from: string;
  to: string;
  buckets: ExerciseWeeklyBucket[];
}
export interface WeeklyQuery {
  from: string;
  to: string;
  timezone: string;
}
export interface DateRange {
  fromDate: string;
  toDate: string;
}
export const trendMetrics = [
  { key: 'completedWorkouts', label: 'Completed workouts', unit: 'count' },
  { key: 'completedSets', label: 'Completed sets', unit: 'count' },
  { key: 'totalReps', label: 'Total reps', unit: 'count' },
  { key: 'totalVolumeKg', label: 'Total volume', unit: 'kg' },
  { key: 'maxLoadKg', label: 'Max load', unit: 'kg' },
  { key: 'maxEstimated1RMKg', label: 'Max estimated 1RM', unit: 'kg' },
] as const;
export type TrendMetric = (typeof trendMetrics)[number]['key'];
