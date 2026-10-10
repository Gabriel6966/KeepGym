import type { PublicRecentWorkout } from '../history/history.types';

export interface DashboardSummaryInput {
  weekStart: string;
  timezone: string;
}

export interface DashboardSummaryQuery extends DashboardSummaryInput {
  toDate: string;
  fromWeekStart: string;
}

export interface DashboardComparisonMetric {
  previous: number;
  delta: number;
  percentageChange: number | null;
}

export interface PublicDashboardSummary extends DashboardSummaryInput {
  recentWorkouts: PublicRecentWorkout[];
  week: {
    completedWorkouts: number;
    completedSets: number;
    totalReps: number;
    totalVolumeKg: number;
    activeDays: number;
    totalDurationSeconds: number;
    averageDurationSeconds: number | null;
  };
  comparison: {
    previousWeekStart: string;
    completedWorkouts: DashboardComparisonMetric;
    completedSets: DashboardComparisonMetric;
    totalReps: DashboardComparisonMetric;
    totalVolumeKg: DashboardComparisonMetric;
  };
  consistency: {
    windowWeeks: 12;
    fromWeekStart: string;
    toWeekStart: string;
    activeWeeks: number;
    longestWeeklyStreak: number;
    endingWeeklyStreak: number;
  };
}
