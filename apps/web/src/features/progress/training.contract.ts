import { isLocalMondayDate } from '../dashboard/calendar';
import { historyTimestamp } from '../history/history-query';
import type {
  WeeklyConsistency,
  WeeklyDuration,
  WeeklyTraining,
} from './training.types';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const numeric = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => numeric(v) && Number.isSafeInteger(v);
const optionalMetric = (v: unknown) => v === null || numeric(v);
function period(v: Record<string, unknown>) {
  return (
    typeof v.timezone === 'string' &&
    historyTimestamp(v.from) !== null &&
    historyTimestamp(v.to) !== null
  );
}
export function isWeeklyTraining(v: unknown): v is WeeklyTraining {
  return (
    object(v) &&
    period(v) &&
    Array.isArray(v.buckets) &&
    v.buckets.every(
      (b) =>
        object(b) &&
        isLocalMondayDate(b.weekStart) &&
        count(b.completedWorkouts) &&
        count(b.completedSets) &&
        count(b.totalReps) &&
        numeric(b.totalVolumeKg),
    )
  );
}
export function isWeeklyConsistency(v: unknown): v is WeeklyConsistency {
  return (
    object(v) &&
    typeof v.timezone === 'string' &&
    isLocalMondayDate(v.fromWeekStart) &&
    isLocalMondayDate(v.toWeekStart) &&
    count(v.totalWeeks) &&
    count(v.completedWorkouts) &&
    count(v.activeDays) &&
    count(v.activeWeeks) &&
    count(v.longestWeeklyStreak) &&
    count(v.endingWeeklyStreak)
  );
}
function duration(v: unknown) {
  return (
    object(v) &&
    count(v.completedWorkouts) &&
    numeric(v.totalDurationSeconds) &&
    optionalMetric(v.averageDurationSeconds)
  );
}
export function isWeeklyDuration(v: unknown): v is WeeklyDuration {
  return (
    object(v) &&
    period(v) &&
    duration(v.summary) &&
    Array.isArray(v.buckets) &&
    v.buckets.every(
      (b) =>
        object(b) &&
        isLocalMondayDate(b.weekStart) &&
        duration(b) &&
        numeric(b.averageDurationSeconds),
    )
  );
}
