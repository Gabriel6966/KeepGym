import type {
  WeeklyTrainingTrendsInput,
  WeeklyTrainingTrendsQuery,
} from '../training-trends/training-trends.types';

export type WeeklyTrainingDurationInput = WeeklyTrainingTrendsInput;
export type WeeklyTrainingDurationQuery = WeeklyTrainingTrendsQuery;

// NUMERIC/count text preserves exact database precision until presentation.
export interface WeeklyDurationRecord {
  weekStart: string;
  completedWorkouts: string;
  totalDurationSeconds: string | null;
  invalidDurationCount: string;
}
export interface PublicDurationSummary {
  completedWorkouts: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number | null;
}
export interface PublicDurationBucket extends PublicDurationSummary {
  weekStart: string;
  averageDurationSeconds: number;
}
export interface PublicWeeklyTrainingDuration {
  timezone: string;
  from: string;
  to: string;
  summary: PublicDurationSummary;
  buckets: PublicDurationBucket[];
}
