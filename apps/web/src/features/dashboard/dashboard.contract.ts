import { isDashboardWeek, isLocalMondayDate } from './calendar';
import {
  bodyMetricKeys,
  muscleGroupValues,
  type DashboardSummary,
} from './dashboard.types';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const metric = (value: unknown) => number(value) && value >= 0;
const count = (value: unknown) => metric(value) && Number.isSafeInteger(value);
const nullable = (value: unknown, check: (item: unknown) => boolean) =>
  value === null || check(value);
const date = (value: unknown) =>
  text(value) &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const array = (value: unknown, check: (item: unknown) => boolean) =>
  Array.isArray(value) && value.every(check);
function exercise(value: unknown): boolean {
  return (
    object(value) &&
    text(value.sourceExerciseId) &&
    text(value.name) &&
    text(value.slug)
  );
}
function totals(value: unknown): value is Record<string, unknown> {
  return (
    object(value) &&
    count(value.completedSets) &&
    count(value.totalReps) &&
    metric(value.totalVolumeKg)
  );
}
function performance(value: unknown): boolean {
  return (
    totals(value) &&
    text(value.workoutSessionId) &&
    date(value.startedAt) &&
    metric(value.maxLoadKg) &&
    nullable(value.bestEstimated1RMKg, metric)
  );
}
function comparison(value: unknown): boolean {
  return (
    object(value) &&
    metric(value.previous) &&
    number(value.delta) &&
    nullable(value.percentageChange, number)
  );
}
function observation(value: unknown): boolean {
  return object(value) && metric(value.value) && date(value.measuredAt);
}
function bodyMetric(value: unknown): boolean {
  return (
    object(value) &&
    nullable(value.latest, observation) &&
    nullable(value.previous, observation) &&
    nullable(value.change, number)
  );
}
export function isDashboardSummary(value: unknown): value is DashboardSummary {
  if (
    !object(value) ||
    !isDashboardWeek(value.weekStart) ||
    !text(value.timezone)
  )
    return false;
  const week = value.week,
    changes = value.comparison,
    consistency = value.consistency,
    progress = value.bodyProgress;
  return (
    totals(week) &&
    count(week.completedWorkouts) &&
    count(week.activeDays) &&
    metric(week.totalDurationSeconds) &&
    nullable(week.averageDurationSeconds, metric) &&
    object(changes) &&
    isLocalMondayDate(changes.previousWeekStart) &&
    ['completedWorkouts', 'completedSets', 'totalReps', 'totalVolumeKg'].every(
      (key) => comparison(changes[key]),
    ) &&
    object(consistency) &&
    consistency.windowWeeks === 12 &&
    isLocalMondayDate(consistency.fromWeekStart) &&
    isLocalMondayDate(consistency.toWeekStart) &&
    count(consistency.activeWeeks) &&
    count(consistency.longestWeeklyStreak) &&
    count(consistency.endingWeeklyStreak) &&
    array(
      value.recentWorkouts,
      (item) =>
        totals(item) &&
        text(item.id) &&
        text(item.name) &&
        date(item.startedAt) &&
        date(item.endedAt) &&
        metric(item.durationSeconds),
    ) &&
    array(
      value.personalRecords,
      (item) =>
        object(item) &&
        (item.type === 'MAX_LOAD' || item.type === 'ESTIMATED_1RM') &&
        exercise(item.exercise) &&
        metric(item.valueKg) &&
        date(item.achievedAt) &&
        text(item.workoutSessionId) &&
        text(item.setEntryId) &&
        metric(item.loadKg) &&
        count(item.reps),
    ) &&
    array(
      value.exerciseHighlights,
      (item) =>
        object(item) &&
        exercise(item.exercise) &&
        performance(item.latest) &&
        nullable(item.previous, performance),
    ) &&
    array(
      value.muscleGroups,
      (item) =>
        totals(item) &&
        count(item.completedWorkouts) &&
        muscleGroupValues.some((group) => group === item.muscleGroup),
    ) &&
    object(progress) &&
    bodyMetricKeys.every((key) => bodyMetric(progress[key]))
  );
}
