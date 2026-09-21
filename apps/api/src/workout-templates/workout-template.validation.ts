import { isUUID } from 'class-validator';
import { InvalidWorkoutTemplateInputError } from './errors/invalid-workout-template-input.error';
import type {
  ExerciseTargets,
  TemplateChanges,
  TemplateExerciseChanges,
  TemplateListInput,
  TemplateListQuery,
} from './workout-templates.types';

function invalid(message: string): never {
  throw new InvalidWorkoutTemplateInputError(message);
}

export function validateIds(...ids: string[]): void {
  if (ids.some((id) => !isUUID(id))) invalid('Identifiers must be UUIDs.');
}

export function normalizeTemplate(
  input: TemplateChanges,
  create = false,
): TemplateChanges {
  const result: TemplateChanges = {};
  if (create || input.name !== undefined) {
    if (typeof input.name !== 'string') invalid('name is required.');
    const name = input.name.trim();
    if ([...name].length < 1 || [...name].length > 120)
      invalid('name must contain 1 to 120 characters.');
    result.name = name;
  }
  if (input.description !== undefined) {
    if (
      input.description !== null &&
      (typeof input.description !== 'string' ||
        [...input.description].length > 1000)
    )
      invalid(
        'description must be a string of at most 1000 characters or null.',
      );
    result.description = input.description;
  }
  if (!create && Object.keys(result).length === 0)
    invalid('At least one field must be provided.');
  return result;
}

export function validateTargetChanges(
  input: TemplateExerciseChanges,
): TemplateExerciseChanges {
  const result: TemplateExerciseChanges = {};
  const ranges = {
    targetSets: [1, 20],
    targetRepsMin: [1, 100],
    targetRepsMax: [1, 100],
    restSeconds: [0, 1800],
  } as const;
  for (const field of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = input[field];
    if (value === undefined) continue;
    const [min, max] = ranges[field];
    if (!Number.isInteger(value) || value < min || value > max)
      invalid(field + ' is outside the supported integer range.');
    result[field] = value;
  }
  if (input.notes !== undefined) {
    if (
      input.notes !== null &&
      (typeof input.notes !== 'string' || [...input.notes].length > 500)
    )
      invalid('notes must be a string of at most 500 characters or null.');
    result.notes = input.notes;
  }
  if (Object.keys(result).length === 0)
    invalid('At least one field must be provided.');
  if (
    result.targetRepsMin !== undefined &&
    result.targetRepsMax !== undefined &&
    result.targetRepsMin > result.targetRepsMax
  )
    invalid('targetRepsMin must not exceed targetRepsMax.');
  return result;
}

// Also applied to the merged row inside the transaction: concurrent partial
// updates must not bypass the same domain invariant.
export function validateTargets(input: ExerciseTargets): void {
  validateTargetChanges(input);
  for (const key of ['targetSets', 'targetRepsMin', 'targetRepsMax'] as const)
    if (input[key] === undefined) invalid(key + ' is required.');
  if (input.targetRepsMin > input.targetRepsMax)
    invalid('targetRepsMin must not exceed targetRepsMax.');
}

export function validateOrder(ids: string[], current?: string[]): void {
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !isUUID(id)) ||
    new Set(ids).size !== ids.length
  )
    invalid('The order must contain unique template exercise UUIDs.');
  if (
    current &&
    (ids.length !== current.length || ids.some((id) => !current.includes(id)))
  )
    invalid(
      'The order must contain exactly the current template exercise IDs.',
    );
}

export function normalizeList(input: TemplateListInput): TemplateListQuery {
  const page = input.page === undefined ? 1 : input.page;
  const limit = input.limit === undefined ? 20 : input.limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger((page - 1) * limit) ||
    (page - 1) * limit > 2147483647
  )
    invalid('Invalid pagination range.');
  let q: string | undefined;
  if (input.q !== undefined) {
    if (typeof input.q !== 'string') invalid('q must be a string.');
    q = input.q.trim();
    if ([...q].length < 1 || [...q].length > 100)
      invalid('q must contain 1 to 100 characters.');
  }
  return { q, page, limit };
}
