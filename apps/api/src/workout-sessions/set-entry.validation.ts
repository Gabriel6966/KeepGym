import { InvalidSetEntryError } from './errors/invalid-set-entry.error';
import type {
  CreateSetEntryInput,
  UpdateSetEntryInput,
} from './workout-sessions.types';

export function validateSetEntryChanges(
  input: UpdateSetEntryInput,
): UpdateSetEntryInput {
  const changes: UpdateSetEntryInput = {};
  if (input.loadKg !== undefined) {
    if (
      typeof input.loadKg !== 'number' ||
      !Number.isFinite(input.loadKg) ||
      input.loadKg < 0 ||
      input.loadKg > 10000 ||
      Number(input.loadKg.toFixed(2)) !== input.loadKg
    )
      throw new InvalidSetEntryError(
        'loadKg must be a number between 0 and 10000 with at most two decimal places.',
      );
    changes.loadKg = input.loadKg;
  }
  if (input.reps !== undefined) {
    if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > 1000)
      throw new InvalidSetEntryError(
        'reps must be an integer between 1 and 1000.',
      );
    changes.reps = input.reps;
  }
  if (input.rpe !== undefined) {
    if (
      input.rpe !== null &&
      (typeof input.rpe !== 'number' ||
        !Number.isFinite(input.rpe) ||
        input.rpe < 1 ||
        input.rpe > 10 ||
        !Number.isInteger(input.rpe * 2))
    )
      throw new InvalidSetEntryError(
        'rpe must be null or a number from 1 to 10 in increments of 0.5.',
      );
    changes.rpe = input.rpe;
  }
  if (input.rir !== undefined) {
    if (
      input.rir !== null &&
      (!Number.isInteger(input.rir) || input.rir < 0 || input.rir > 10)
    )
      throw new InvalidSetEntryError(
        'rir must be null or an integer between 0 and 10.',
      );
    changes.rir = input.rir;
  }
  if (Object.keys(changes).length === 0)
    throw new InvalidSetEntryError('At least one set field must be provided.');
  return changes;
}

export function validateCreateSetEntry(
  input: CreateSetEntryInput,
): CreateSetEntryInput {
  const changes = validateSetEntryChanges(input);
  if (changes.loadKg === undefined || changes.reps === undefined)
    throw new InvalidSetEntryError('loadKg and reps are required.');
  return {
    loadKg: changes.loadKg,
    reps: changes.reps,
    rpe: changes.rpe,
    rir: changes.rir,
  };
}
