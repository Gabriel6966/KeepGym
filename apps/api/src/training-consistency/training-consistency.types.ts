export interface WeeklyConsistencyInput {
  fromWeekStart: string;
  toWeekStart: string;
  timezone: string;
}

export interface WeeklyConsistencyQuery extends WeeklyConsistencyInput {
  totalWeeks: number;
}

// Preserve PostgreSQL bigint aggregates until explicitly checked for JSON safety.
export interface WeeklyActivityRecord {
  weekStart: string;
  completedWorkouts: string;
  activeDays: string;
}

export interface PublicWeeklyConsistency extends WeeklyConsistencyInput {
  totalWeeks: number;
  completedWorkouts: number;
  activeDays: number;
  activeWeeks: number;
  longestWeeklyStreak: number;
  endingWeeklyStreak: number;
}
