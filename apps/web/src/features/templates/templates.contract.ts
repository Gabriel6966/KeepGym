import { muscleGroupValues } from '../dashboard/dashboard.types';
import {
  equipmentValues,
  movementValues,
  type ResourcePage,
} from '../workout/workout.types';
import type { CatalogExercise } from './templates.types';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const member = (value: unknown, options: readonly string[]) =>
  options.some((option) => option === value);
function catalogExercise(value: unknown): value is CatalogExercise {
  return (
    object(value) &&
    text(value.id) &&
    text(value.name) &&
    text(value.slug) &&
    (value.description === null || typeof value.description === 'string') &&
    Array.isArray(value.instructions) &&
    value.instructions.every((item) => typeof item === 'string') &&
    member(value.primaryMuscle, muscleGroupValues) &&
    Array.isArray(value.secondaryMuscles) &&
    value.secondaryMuscles.every((item) => member(item, muscleGroupValues)) &&
    member(value.equipment, equipmentValues) &&
    member(value.movementPattern, movementValues)
  );
}
export function isCatalogPage(
  value: unknown,
): value is ResourcePage<CatalogExercise> {
  return (
    object(value) &&
    Array.isArray(value.items) &&
    value.items.every(catalogExercise) &&
    count(value.page) &&
    value.page > 0 &&
    count(value.limit) &&
    value.limit > 0 &&
    count(value.total) &&
    count(value.totalPages)
  );
}
