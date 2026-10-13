import { isSetEntry } from '../workout/workout.contract';
import { equipmentValues, movementValues } from '../workout/workout.types';
import { muscleGroupValues } from '../dashboard/dashboard.types';
import { isLocalMondayDate } from '../dashboard/calendar';
import { historyTimestamp } from '../history/history-query';
import type {
  ExerciseAnalytics,
  ExerciseRecords,
  ExerciseWeeklyTrends,
} from './progress.types';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const numeric = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => numeric(v) && Number.isSafeInteger(v);
const optionalMetric = (v: unknown) => v === null || numeric(v);
const date = (v: unknown) => historyTimestamp(v) !== null;
const member = (v: unknown, options: readonly string[]) =>
  options.some((option) => option === v);
function metadata(v: unknown) {
  return (
    object(v) &&
    (v.sourceExerciseId === null || text(v.sourceExerciseId)) &&
    text(v.name) &&
    text(v.slug)
  );
}
function snapshot(v: unknown) {
  return (
    object(v) &&
    metadata(v) &&
    member(v.primaryMuscle, muscleGroupValues) &&
    member(v.equipment, equipmentValues) &&
    member(v.movementPattern, movementValues) &&
    Array.isArray(v.secondaryMuscles) &&
    v.secondaryMuscles.every((m) => member(m, muscleGroupValues))
  );
}
function candidate(v: unknown) {
  return (
    object(v) &&
    text(v.sessionId) &&
    text(v.sessionName) &&
    date(v.sessionStartedAt) &&
    text(v.sessionExerciseId) &&
    text(v.setId) &&
    isSetEntry({ ...v, id: v.setId })
  );
}
function record(v: unknown, type: string) {
  return (
    object(v) &&
    v.type === type &&
    numeric(v.valueKg) &&
    date(v.achievedAt) &&
    object(v.session) &&
    text(v.session.id) &&
    text(v.session.name) &&
    date(v.session.startedAt) &&
    isSetEntry(v.set)
  );
}
function performance(v: unknown) {
  return (
    object(v) &&
    text(v.sessionId) &&
    text(v.sessionName) &&
    text(v.sessionExerciseId) &&
    date(v.startedAt) &&
    (v.endedAt === null || date(v.endedAt)) &&
    snapshot(v.exercise) &&
    count(v.setCount) &&
    count(v.repCount) &&
    numeric(v.volumeKg) &&
    optionalMetric(v.maxLoadKg) &&
    optionalMetric(v.maxEstimated1RMKg) &&
    Array.isArray(v.sets) &&
    v.sets.every(
      (s) => object(s) && isSetEntry(s) && optionalMetric(s.estimated1RMKg),
    )
  );
}
export function isExerciseAnalytics(v: unknown): v is ExerciseAnalytics {
  return (
    object(v) &&
    (v.exercise === null || metadata(v.exercise)) &&
    object(v.summary) &&
    count(v.summary.sessions) &&
    count(v.summary.sets) &&
    count(v.summary.reps) &&
    numeric(v.summary.totalVolumeKg) &&
    optionalMetric(v.summary.maxLoadKg) &&
    optionalMetric(v.summary.maxEstimated1RMKg) &&
    (v.heaviestSet === null || candidate(v.heaviestSet)) &&
    (v.bestEstimated1RMSet === null ||
      (object(v.bestEstimated1RMSet) &&
        candidate(v.bestEstimated1RMSet) &&
        numeric(v.bestEstimated1RMSet.estimated1RMKg))) &&
    Array.isArray(v.performances) &&
    v.performances.every(performance) &&
    count(v.page) &&
    Number(v.page) > 0 &&
    count(v.limit) &&
    Number(v.limit) > 0 &&
    count(v.total) &&
    count(v.totalPages)
  );
}
export function isExerciseRecords(v: unknown): v is ExerciseRecords {
  return (
    object(v) &&
    (v.exercise === null || snapshot(v.exercise)) &&
    (v.maxLoadRecord === null || record(v.maxLoadRecord, 'MAX_LOAD')) &&
    (v.estimated1RMRecord === null ||
      record(v.estimated1RMRecord, 'ESTIMATED_1RM'))
  );
}
export function isExerciseWeeklyTrends(v: unknown): v is ExerciseWeeklyTrends {
  return (
    object(v) &&
    (v.exercise === null || snapshot(v.exercise)) &&
    text(v.timezone) &&
    date(v.from) &&
    date(v.to) &&
    Array.isArray(v.buckets) &&
    v.buckets.every(
      (b) =>
        object(b) &&
        isLocalMondayDate(b.weekStart) &&
        count(b.completedWorkouts) &&
        count(b.completedSets) &&
        count(b.totalReps) &&
        numeric(b.totalVolumeKg) &&
        numeric(b.maxLoadKg) &&
        optionalMetric(b.maxEstimated1RMKg),
    )
  );
}
