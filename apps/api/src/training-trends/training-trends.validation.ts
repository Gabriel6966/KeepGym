import { isUUID } from 'class-validator';
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
  const date = new Date(`${value}T00:00:00Z`);
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    date.getUTCFullYear() < 1 ||
    date.getUTCDay() !== 1
  )
    throw new InvalidTrainingTrendsQueryError(
      'weekStart must be a real Monday date in YYYY-MM-DD format.',
    );
  // UTC is only a calendar arithmetic carrier, NOT the requested week instant.
  // PostgreSQL converts each local midnight independently using the IANA zone.
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 7);
  if (previous.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999)
    throw new InvalidTrainingTrendsQueryError(
      'Adjacent week boundaries must remain within years 0001 through 9999.',
    );
  return {
    weekStart: value,
    previousWeekStart: previous.toISOString().slice(0, 10),
    timezone: normalizeTrainingTimezone(input.timezone),
  };
}

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
