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
