import type {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../generated/prisma/enums';

export interface WeeklyTrainingTrendsInput {
  from: string;
  to: string;
  timezone: string;
}

export interface WeeklyTrainingTrendsQuery {
  from: Date;
  to: Date;
  timezone: string;
}

// PostgreSQL aggregates stay exact as text until the public boundary.
export interface WeeklyTrainingTrendsRecord {
  weekStart: string;
  completedWorkouts: string;
  completedSets: string;
  totalReps: string;
  totalVolumeKg: string;
}

export interface PublicWeeklyTrainingBucket {
  weekStart: string;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}

export interface PublicWeeklyTrainingTrends {
  timezone: string;
  from: string;
  to: string;
  buckets: PublicWeeklyTrainingBucket[];
}

export interface ExerciseTrendSnapshot {
  sourceExerciseId: string;
  name: string;
  slug: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  movementPattern: MovementPattern;
}

export interface ExerciseWeeklyTrendsRecord extends WeeklyTrainingTrendsRecord {
  maxLoadKg: string;
}

export interface WeeklyEstimated1RMCandidate {
  weekStart: string;
  reps: number;
  loadKg: string;
}

export interface ExerciseWeeklyTrendsData {
  exercise: ExerciseTrendSnapshot | null;
  buckets: ExerciseWeeklyTrendsRecord[];
  estimatedCandidates: WeeklyEstimated1RMCandidate[];
}

export interface PublicExerciseWeeklyBucket extends PublicWeeklyTrainingBucket {
  maxLoadKg: number;
  maxEstimated1RMKg: number | null;
}

export interface PublicExerciseWeeklyTrends extends PublicWeeklyTrainingTrends {
  exercise: ExerciseTrendSnapshot | null;
  buckets: PublicExerciseWeeklyBucket[];
}
