import { isUUID } from 'class-validator';
import {
  canonicalIanaTimezone,
  parseLocalMonday,
  shiftLocalMonday,
} from '../common/calendar-week';
import { historyTimestamp } from '../history/history.validation';
import { InvalidTrainingTrendsQueryError } from './errors/invalid-training-trends-query.error';
import type {
  WeeklyComparisonInput,
  WeeklyComparisonQuery,
  WeeklyTrainingTrendsInput,
  WeeklyTrainingTrendsQuery,
} from './training-trends.types';

export const MAX_TRAINING_TRENDS_RANGE_MS = 730 * 24 * 60 * 60 * 1000;

export function normalizeWeeklyComparison(
  userId: string,
  input: WeeklyComparisonInput,
): WeeklyComparisonQuery {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidTrainingTrendsQueryError(
      'User identifier must be a UUID.',
    );
  const value = input.weekStart;
  if (!parseLocalMonday(value))
    throw new InvalidTrainingTrendsQueryError(
      'weekStart must be a real Monday date in YYYY-MM-DD format.',
    );
  let previousWeekStart: string;
  try {
    previousWeekStart = shiftLocalMonday(value, -1);
    shiftLocalMonday(value, 1);
  } catch {
    throw new InvalidTrainingTrendsQueryError(
      'Adjacent week boundaries must remain within years 0001 through 9999.',
    );
  }
  return {
    weekStart: value,
    previousWeekStart,
    timezone: normalizeTrainingTimezone(input.timezone),
  };
}

export function normalizeTrainingTimezone(value: unknown): string {
  const timezone = canonicalIanaTimezone(value);
  if (timezone === null)
    throw new InvalidTrainingTrendsQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  return timezone;
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
