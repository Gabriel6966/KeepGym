import { isUUID } from 'class-validator';
import { historyTimestamp } from '../history/history.validation';
import { InvalidBodyAnalyticsQueryError } from './errors/invalid-body-analytics-query.error';
import {
  bodyMetrics,
  type BodyMetric,
  type BodyAnalyticsRange,
  type BodyAnalyticsRangeInput,
  type BodyAnalyticsTimelineInput,
  type BodyAnalyticsTimelineQuery,
} from './body-analytics.types';

export function validateBodyAnalyticsUser(userId: string): void {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidBodyAnalyticsQueryError('User identifier must be a UUID.');
}
export function isBodyMetric(value: unknown): value is BodyMetric {
  return (
    typeof value === 'string' && bodyMetrics.some((metric) => metric === value)
  );
}
export function normalizeBodyAnalyticsRange(
  input: BodyAnalyticsRangeInput,
): BodyAnalyticsRange {
  const from =
    input.from === undefined ? undefined : historyTimestamp(input.from);
  const to = input.to === undefined ? undefined : historyTimestamp(input.to);
  if (from === null || to === null)
    throw new InvalidBodyAnalyticsQueryError(
      'Dates must be real RFC3339 timestamps with timezone and at most millisecond precision.',
    );
  if (from && to && from > to)
    throw new InvalidBodyAnalyticsQueryError('from must not be later than to.');
  return { from, to };
}
export function normalizeBodyAnalyticsTimeline(
  input: BodyAnalyticsTimelineInput,
): BodyAnalyticsTimelineQuery {
  if (!isBodyMetric(input.metric))
    throw new InvalidBodyAnalyticsQueryError(
      'metric must be a supported body measurement metric.',
    );
  const page = input.page === undefined ? 1 : input.page;
  const limit = input.limit === undefined ? 50 : input.limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger((page - 1) * limit) ||
    (page - 1) * limit > 2147483647
  )
    throw new InvalidBodyAnalyticsQueryError('Invalid pagination range.');
  return {
    ...normalizeBodyAnalyticsRange(input),
    metric: input.metric,
    page,
    limit,
  };
}
