import { isUUID } from 'class-validator';
import { historyTimestamp } from '../history/history.validation';
import { InvalidAnalyticsQueryError } from './errors/invalid-analytics-query.error';
import type {
  AnalyticsRange,
  AnalyticsRangeInput,
  ExerciseAnalyticsInput,
  ExerciseAnalyticsQuery,
} from './analytics.types';

export function validateAnalyticsIds(...ids: string[]): void {
  if (ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    throw new InvalidAnalyticsQueryError('Identifiers must be UUIDs.');
}
export function normalizeAnalyticsRange(
  input: AnalyticsRangeInput,
): AnalyticsRange {
  const from =
    input.from === undefined ? undefined : historyTimestamp(input.from);
  const to = input.to === undefined ? undefined : historyTimestamp(input.to);
  if (from === null || to === null)
    throw new InvalidAnalyticsQueryError(
      'Dates must be real RFC3339 timestamps with timezone and at most millisecond precision.',
    );
  if (from && to && from > to)
    throw new InvalidAnalyticsQueryError('from must not be later than to.');
  return { from, to };
}
export function normalizeExerciseAnalyticsQuery(
  input: ExerciseAnalyticsInput,
): ExerciseAnalyticsQuery {
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
    throw new InvalidAnalyticsQueryError('Invalid pagination range.');
  return { ...normalizeAnalyticsRange(input), page, limit };
}
