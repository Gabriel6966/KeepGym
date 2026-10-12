import { muscleGroupValues } from '../dashboard/dashboard.types';
import {
  equipmentValues,
  movementValues,
  sessionStatuses,
  type ResourcePage,
  type SetEntry,
  type WorkoutSession,
  type WorkoutSessionSummary,
  type WorkoutTemplate,
} from './workout.types';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const numeric = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown): v is number =>
  numeric(v) && Number.isSafeInteger(v);
const positive = (v: unknown) => count(v) && v > 0;
const date = (v: unknown) =>
  text(v) &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const enumValue = (v: unknown, values: readonly string[]) =>
  values.some((item) => item === v);
const array = (v: unknown, check: (item: unknown) => boolean) =>
  Array.isArray(v) && v.every(check);
function exercise(v: unknown) {
  return (
    object(v) &&
    text(v.name) &&
    text(v.slug) &&
    enumValue(v.primaryMuscle, muscleGroupValues) &&
    enumValue(v.equipment, equipmentValues) &&
    enumValue(v.movementPattern, movementValues)
  );
}
export function isSetEntry(v: unknown): v is SetEntry {
  return (
    object(v) &&
    text(v.id) &&
    positive(v.position) &&
    numeric(v.loadKg) &&
    positive(v.reps) &&
    (v.rpe === null || numeric(v.rpe)) &&
    (v.rir === null || count(v.rir)) &&
    date(v.completedAt)
  );
}
function sessionSummary(v: unknown): v is WorkoutSessionSummary {
  return (
    object(v) &&
    text(v.id) &&
    text(v.name) &&
    enumValue(v.status, sessionStatuses) &&
    nullableText(v.notes) &&
    date(v.startedAt) &&
    (v.endedAt === null || date(v.endedAt))
  );
}
export function isWorkoutSession(v: unknown): v is WorkoutSession {
  return (
    sessionSummary(v) &&
    'exercises' in v &&
    array(
      v.exercises,
      (item) =>
        object(item) &&
        text(item.id) &&
        positive(item.position) &&
        exercise(item.exercise) &&
        object(item.exercise) &&
        nullableText(item.exercise.sourceExerciseId) &&
        array(item.exercise.secondaryMuscles, (muscle) =>
          enumValue(muscle, muscleGroupValues),
        ) &&
        positive(item.plannedSets) &&
        positive(item.plannedRepsMin) &&
        positive(item.plannedRepsMax) &&
        count(item.plannedRestSeconds) &&
        nullableText(item.plannedNotes) &&
        array(item.sets, isSetEntry),
    )
  );
}
function template(v: unknown): v is WorkoutTemplate {
  return (
    object(v) &&
    text(v.id) &&
    text(v.name) &&
    nullableText(v.description) &&
    date(v.createdAt) &&
    date(v.updatedAt) &&
    array(
      v.exercises,
      (item) =>
        object(item) &&
        text(item.id) &&
        positive(item.position) &&
        positive(item.targetSets) &&
        positive(item.targetRepsMin) &&
        positive(item.targetRepsMax) &&
        count(item.restSeconds) &&
        nullableText(item.notes) &&
        exercise(item.exercise) &&
        object(item.exercise) &&
        text(item.exercise.id) &&
        typeof item.exercise.isAvailable === 'boolean',
    )
  );
}
function page<T>(
  v: unknown,
  check: (item: unknown) => item is T,
): v is ResourcePage<T> {
  return (
    object(v) &&
    array(v.items, check) &&
    positive(v.page) &&
    positive(v.limit) &&
    count(v.total) &&
    count(v.totalPages)
  );
}
export const isTemplatePage = (
  v: unknown,
): v is ResourcePage<WorkoutTemplate> => page(v, template);
export const isSessionPage = (
  v: unknown,
): v is ResourcePage<WorkoutSessionSummary> => page(v, sessionSummary);
