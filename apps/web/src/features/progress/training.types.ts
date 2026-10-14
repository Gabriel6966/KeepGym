import type { WeeklyQuery } from './progress.types';

export interface TrainingWeekRange {
  fromWeekStart: string;
  toWeekStart: string;
}
export interface ConsistencyQuery extends TrainingWeekRange {
  timezone: string;
}
export interface TrainingBucket {
  weekStart: string;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}
export interface WeeklyTraining extends WeeklyQuery {
  buckets: TrainingBucket[];
}
export interface WeeklyConsistency extends ConsistencyQuery {
  totalWeeks: number;
  completedWorkouts: number;
  activeDays: number;
  activeWeeks: number;
  longestWeeklyStreak: number;
  endingWeeklyStreak: number;
}
export interface DurationSummary {
  completedWorkouts: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number | null;
}
export interface DurationBucket extends DurationSummary {
  weekStart: string;
  averageDurationSeconds: number;
}
export interface WeeklyDuration extends WeeklyQuery {
  summary: DurationSummary;
  buckets: DurationBucket[];
}
export const trainingMetrics = [
  { key: 'completedWorkouts', label: 'Completed workouts', unit: 'workouts' },
  { key: 'completedSets', label: 'Completed sets', unit: 'sets' },
  { key: 'totalReps', label: 'Total reps', unit: 'reps' },
  { key: 'totalVolumeKg', label: 'Total volume', unit: 'kg' },
] as const;
export type TrainingMetric = (typeof trainingMetrics)[number]['key'];
export const durationMetrics = [
  { key: 'totalDurationSeconds', label: 'Total duration' },
  { key: 'averageDurationSeconds', label: 'Average workout duration' },
] as const;
export type DurationMetric = (typeof durationMetrics)[number]['key'];
