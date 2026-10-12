// HTTP contract of GET /dashboard/summary. Dates are serialized ISO strings;
// no NestJS/Prisma internals are imported into the browser bundle.
export const muscleGroupValues = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'FOREARMS',
  'QUADRICEPS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
  'CORE',
] as const;
export type MuscleGroup = (typeof muscleGroupValues)[number];
export const bodyMetricKeys = [
  'weightKg',
  'bodyFatPercent',
  'waistCm',
  'chestCm',
  'hipsCm',
] as const;
export type BodyMetric = (typeof bodyMetricKeys)[number];
export interface ExerciseSnapshot {
  sourceExerciseId: string;
  name: string;
  slug: string;
}
export interface ExercisePerformance {
  workoutSessionId: string;
  startedAt: string;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
  maxLoadKg: number;
  bestEstimated1RMKg: number | null;
}
export interface ExerciseHighlight {
  exercise: ExerciseSnapshot;
  latest: ExercisePerformance;
  previous: ExercisePerformance | null;
}
export interface PersonalRecord {
  type: 'MAX_LOAD' | 'ESTIMATED_1RM';
  exercise: ExerciseSnapshot;
  valueKg: number;
  achievedAt: string;
  workoutSessionId: string;
  setEntryId: string;
  loadKg: number;
  reps: number;
}
export interface RecentWorkout {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}
export interface MuscleGroupActivity {
  muscleGroup: MuscleGroup;
  completedWorkouts: number;
  completedSets: number;
  totalReps: number;
  totalVolumeKg: number;
}
export interface BodyObservation {
  value: number;
  measuredAt: string;
}
export interface BodyMetricProgress {
  latest: BodyObservation | null;
  previous: BodyObservation | null;
  change: number | null;
}
export interface ComparisonMetric {
  previous: number;
  delta: number;
  percentageChange: number | null;
}
export type ComparisonKey =
  'completedWorkouts' | 'completedSets' | 'totalReps' | 'totalVolumeKg';
export interface DashboardSummary {
  timezone: string;
  weekStart: string;
  week: {
    completedWorkouts: number;
    completedSets: number;
    totalReps: number;
    totalVolumeKg: number;
    activeDays: number;
    totalDurationSeconds: number;
    averageDurationSeconds: number | null;
  };
  comparison: { previousWeekStart: string } & Record<
    ComparisonKey,
    ComparisonMetric
  >;
  consistency: {
    windowWeeks: 12;
    fromWeekStart: string;
    toWeekStart: string;
    activeWeeks: number;
    longestWeeklyStreak: number;
    endingWeeklyStreak: number;
  };
  recentWorkouts: RecentWorkout[];
  personalRecords: PersonalRecord[];
  bodyProgress: Record<BodyMetric, BodyMetricProgress>;
  exerciseHighlights: ExerciseHighlight[];
  muscleGroups: MuscleGroupActivity[];
}
