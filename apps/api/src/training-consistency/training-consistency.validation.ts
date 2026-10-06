import { isUUID } from 'class-validator';
import {
  canonicalIanaTimezone,
  parseLocalMonday,
  shiftLocalMonday,
} from '../common/calendar-week';
import { InvalidTrainingConsistencyQueryError } from './errors/invalid-training-consistency-query.error';
import { calculateTotalWeeks } from './training-consistency.math';
import type {
  WeeklyConsistencyInput,
  WeeklyConsistencyQuery,
} from './training-consistency.types';

export const MAX_CONSISTENCY_WEEKS = 104;

export function normalizeWeeklyConsistency(
  userId: string,
  input: WeeklyConsistencyInput,
): WeeklyConsistencyQuery {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidTrainingConsistencyQueryError(
      'User identifier must be a UUID.',
    );
  if (
    !parseLocalMonday(input.fromWeekStart) ||
    !parseLocalMonday(input.toWeekStart)
  )
    throw new InvalidTrainingConsistencyQueryError(
      'Week boundaries must be real Monday dates in YYYY-MM-DD format.',
    );
  if (input.fromWeekStart > input.toWeekStart)
    throw new InvalidTrainingConsistencyQueryError(
      'fromWeekStart must not be later than toWeekStart.',
    );
  const totalWeeks = calculateTotalWeeks(
    input.fromWeekStart,
    input.toWeekStart,
  );
  if (totalWeeks > MAX_CONSISTENCY_WEEKS)
    throw new InvalidTrainingConsistencyQueryError(
      'The inclusive range must not exceed 104 calendar weeks.',
    );
  try {
    shiftLocalMonday(input.toWeekStart, 1);
  } catch {
    throw new InvalidTrainingConsistencyQueryError(
      'The exclusive end boundary must remain within years 0001 through 9999.',
    );
  }
  const timezone = canonicalIanaTimezone(input.timezone);
  if (timezone === null)
    throw new InvalidTrainingConsistencyQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  return {
    fromWeekStart: input.fromWeekStart,
    toWeekStart: input.toWeekStart,
    timezone,
    totalWeeks,
  };
}
