import type {
  MuscleGroup,
  MuscleGroupActivity,
} from '../dashboard/dashboard.types';
import type { WeeklyQuery } from './progress.types';

export type MuscleFilter = 'ALL' | MuscleGroup;
export interface MuscleWeek {
  weekStart: string;
  muscleGroups: MuscleGroupActivity[];
}
// Existing public TrainingTrends contract: already grouped by local week.
export interface WeeklyMuscleGroups extends WeeklyQuery {
  buckets: MuscleWeek[];
}
