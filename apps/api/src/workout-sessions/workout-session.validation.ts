import { isUUID } from 'class-validator';
import { WorkoutSessionStatus } from '../generated/prisma/enums';
import { InvalidWorkoutSessionInputError } from './errors/invalid-workout-session-input.error';
import type {
  ListWorkoutSessionsInput,
  WorkoutSessionListQuery,
} from './workout-sessions.types';

export function validateWorkoutSessionIds(...ids: string[]): void {
  if (ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    throw new InvalidWorkoutSessionInputError('Identifiers must be UUIDs.');
}

export function normalizeWorkoutSessionQuery(
  input: ListWorkoutSessionsInput,
): WorkoutSessionListQuery {
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
    throw new InvalidWorkoutSessionInputError('Invalid pagination range.');
  if (
    input.status !== undefined &&
    !Object.values(WorkoutSessionStatus).includes(input.status)
  )
    throw new InvalidWorkoutSessionInputError(
      'status must be a supported workout session status.',
    );
  return { page, limit, status: input.status };
}
