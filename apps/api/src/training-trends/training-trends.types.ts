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

export interface WeeklyComparisonInput {
  weekStart: string;
  timezone: string;
}

export interface WeeklyComparisonQuery extends WeeklyComparisonInput {
  previousWeekStart: string;
}

export interface PublicMetricComparison {
  delta: number;
  percentageChange: number | null;
}

export interface PublicWeeklyComparison {
  timezone: string;
  previous: PublicWeeklyTrainingBucket;
  current: PublicWeeklyTrainingBucket;
  changes: Record<
    'completedWorkouts' | 'completedSets' | 'totalReps' | 'totalVolumeKg',
    PublicMetricComparison
  >;
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

// Raw enum text is checked against MuscleGroup at the public boundary.
export interface MuscleGroupWeeklyTrendsRecord extends WeeklyTrainingTrendsRecord {
  muscleGroup: string;
}

export interface PublicMuscleGroupMetrics extends Omit<
  PublicWeeklyTrainingBucket,
  'weekStart'
> {
  muscleGroup: MuscleGroup;
}

export interface PublicMuscleGroupWeeklyBucket {
  weekStart: string;
  muscleGroups: PublicMuscleGroupMetrics[];
}

export interface PublicMuscleGroupWeeklyTrends extends Omit<
  PublicWeeklyTrainingTrends,
  'buckets'
> {
  buckets: PublicMuscleGroupWeeklyBucket[];
}
