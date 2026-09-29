import { isUUID } from 'class-validator';
import { historyTimestamp } from '../history/history.validation';
import { InvalidTrainingTrendsQueryError } from './errors/invalid-training-trends-query.error';
import type {
  WeeklyTrainingTrendsInput,
  WeeklyTrainingTrendsQuery,
} from './training-trends.types';

export const MAX_TRAINING_TRENDS_RANGE_MS = 730 * 24 * 60 * 60 * 1000;

export function normalizeTrainingTimezone(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > 100 ||
    /^[+-]/.test(value)
  )
    throw new InvalidTrainingTrendsQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  try {
    // Intl also supports offset identifiers in Node 24. Exclude those explicitly;
    // use the runtime IANA database, not a manually maintained timezone list.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    throw new InvalidTrainingTrendsQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  }
}

export function normalizeWeeklyTrainingTrends(
  userId: string,
  input: WeeklyTrainingTrendsInput,
): WeeklyTrainingTrendsQuery {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidTrainingTrendsQueryError(
      'User identifier must be a UUID.',
    );
  const from = historyTimestamp(input.from);
  const to = historyTimestamp(input.to);
  if (!from || !to)
    throw new InvalidTrainingTrendsQueryError(
      'from and to must be real RFC3339 timestamps with timezone and at most millisecond precision.',
    );
  if (from > to)
    throw new InvalidTrainingTrendsQueryError(
      'from must not be later than to.',
    );
  if (to.getTime() - from.getTime() > MAX_TRAINING_TRENDS_RANGE_MS)
    throw new InvalidTrainingTrendsQueryError(
      'The range must not exceed 730 days.',
    );
  return { from, to, timezone: normalizeTrainingTimezone(input.timezone) };
}
