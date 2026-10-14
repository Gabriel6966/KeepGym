import {
  addCalendarDaysToDateOnly,
  canonicalBrowserTimezone,
  getLocalMondayDate,
  isLocalMondayDate,
  parseDateOnly,
} from '../dashboard/calendar';
import { selectorQuery, trendRange } from './progress-query';
import type { CatalogQuery } from '../templates/templates.types';
import {
  durationMetrics,
  trainingMetrics,
  type ConsistencyQuery,
  type DurationMetric,
  type TrainingMetric,
  type TrainingWeekRange,
} from './training.types';
import type { WeeklyQuery } from './progress.types';

const one = (params: URLSearchParams, key: string) =>
  params.getAll(key).length === 1 ? params.get(key) : null;
export function defaultTrainingRange(localDate: string): TrainingWeekRange {
  const toWeekStart = getLocalMondayDate(localDate);
  return {
    fromWeekStart: addCalendarDaysToDateOnly(toWeekStart, -77),
    toWeekStart,
  };
}
// Input validation only. Consistency owns totalWeeks and streak calculation.
export function validTrainingWeeks(range: TrainingWeekRange): boolean {
  if (
    !isLocalMondayDate(range.fromWeekStart) ||
    !isLocalMondayDate(range.toWeekStart) ||
    range.fromWeekStart > range.toWeekStart
  )
    return false;
  try {
    addCalendarDaysToDateOnly(range.toWeekStart, 7);
    // 104 inclusive weeks: at most 103 calendar weeks between the Mondays.
    const lastAllowed = parseDateOnly(range.fromWeekStart)!;
    lastAllowed.setUTCDate(lastAllowed.getUTCDate() + 721);
    return parseDateOnly(range.toWeekStart)! <= lastAllowed;
  } catch {
    return false;
  }
}
export function validConsistencyQuery(query: ConsistencyQuery): boolean {
  return (
    validTrainingWeeks(query) &&
    canonicalBrowserTimezone(query.timezone) === query.timezone
  );
}
export function trainingRangeQueries(
  range: TrainingWeekRange,
  timezone: string,
): {
  trends: WeeklyQuery;
  consistency: ConsistencyQuery;
  duration: WeeklyQuery;
} | null {
  if (!validTrainingWeeks(range)) return null;
  try {
    // Trends AND Duration use inclusive instants. Consistency uses local Mondays
    // and [first Monday, Monday after last). Do not change either API contract.
    const instants = trendRange(
      {
        fromDate: range.fromWeekStart,
        toDate: addCalendarDaysToDateOnly(range.toWeekStart, 6),
      },
      timezone,
    );
    return instants
      ? {
          trends: instants,
          consistency: { ...range, timezone },
          duration: instants,
        }
      : null;
  } catch {
    return null;
  }
}
export function trainingUrlState(params: URLSearchParams) {
  const candidate = {
    fromWeekStart: one(params, 'fromWeekStart') ?? '',
    toWeekStart: one(params, 'toWeekStart') ?? '',
  };
  return {
    range: validTrainingWeeks(candidate) ? candidate : undefined,
    trainingMetric:
      trainingMetrics.find((m) => m.key === one(params, 'trainingMetric'))
        ?.key ?? 'totalVolumeKg',
    durationMetric:
      durationMetrics.find((m) => m.key === one(params, 'durationMetric'))
        ?.key ?? 'totalDurationSeconds',
  };
}
export function normalizeTrainingRange(
  params: URLSearchParams,
  localDate: string,
  timezone: string,
): TrainingWeekRange {
  const range = trainingUrlState(params).range;
  return range && trainingRangeQueries(range, timezone)
    ? range
    : defaultTrainingRange(localDate);
}
export function trainingProgressUrl({
  range,
  trainingMetric = 'totalVolumeKg',
  durationMetric = 'totalDurationSeconds',
  selector = {},
}: {
  range?: TrainingWeekRange;
  trainingMetric?: TrainingMetric;
  durationMetric?: DurationMetric;
  selector?: CatalogQuery;
}): string {
  const params = new URLSearchParams();
  if (range) {
    params.set('fromWeekStart', range.fromWeekStart);
    params.set('toWeekStart', range.toWeekStart);
  }
  if (range || trainingMetric !== 'totalVolumeKg')
    params.set('trainingMetric', trainingMetric);
  if (range || durationMetric !== 'totalDurationSeconds')
    params.set('durationMetric', durationMetric);
  if (selector.q?.trim()) params.set('q', selector.q.trim());
  if ((selector.page ?? 1) > 1) params.set('page', String(selector.page));
  return '/progress' + (params.size ? '?' + params : '');
}
export function trainingSelectorUrl(
  params: URLSearchParams,
  selector: CatalogQuery,
): string {
  return trainingProgressUrl({ ...trainingUrlState(params), selector });
}
export function trainingReturnPath(params: URLSearchParams): string {
  return trainingSelectorUrl(params, selectorQuery(params));
}
