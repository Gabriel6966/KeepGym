import {
  addCalendarDaysToDateOnly,
  canonicalBrowserTimezone,
  getLocalMondayDate,
  parseDateOnly,
} from '../dashboard/calendar';
import { localInputToRFC3339 } from '../body/body-time';
import {
  validHistoryPagination,
  historyTimestamp,
} from '../history/history-query';
import type { CatalogQuery } from '../templates/templates.types';
import {
  trendMetrics,
  type DateRange,
  type TrendMetric,
  type WeeklyQuery,
} from './progress.types';

export const performancePageSize = 20;
const one = (params: URLSearchParams, key: string) =>
  params.getAll(key).length === 1 ? params.get(key) : null;
export function progressPage(value: string | null, limit = 20): number {
  return value &&
    /^[1-9]\d*$/.test(value) &&
    validHistoryPagination(Number(value), limit)
    ? Number(value)
    : 1;
}
export function selectorQuery(params: URLSearchParams): CatalogQuery {
  const q = one(params, 'q')?.trim();
  return {
    q: q && [...q].length <= 100 ? q : undefined,
    page: progressPage(one(params, 'page'), 10),
    limit: 10,
  };
}
export function selectorUrl(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if ((query.page ?? 1) > 1) params.set('page', String(query.page));
  return '/progress' + (params.size ? '?' + params : '');
}
export function defaultProgressRange(localDate: string): DateRange {
  const monday = getLocalMondayDate(localDate);
  return {
    fromDate: addCalendarDaysToDateOnly(monday, -77),
    toDate: addCalendarDaysToDateOnly(monday, 6),
  };
}
export function validDatePair(range: DateRange): boolean {
  return (
    parseDateOnly(range.fromDate) !== null &&
    parseDateOnly(range.toDate) !== null &&
    range.fromDate <= range.toDate
  );
}
// The API uses inclusive instants. Derive the next LOCAL calendar midnight and
// subtract a single millisecond, never 24 hours, to include the final local date.
// Native wall-clock conversion uses the same browser IANA timezone as the query.
export function trendRange(
  range: DateRange,
  timezone: string,
): WeeklyQuery | null {
  if (
    !validDatePair(range) ||
    canonicalBrowserTimezone(timezone) !== timezone ||
    canonicalBrowserTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ) !== timezone
  )
    return null;
  try {
    const from = localInputToRFC3339(range.fromDate + 'T00:00'),
      next = localInputToRFC3339(
        addCalendarDaysToDateOnly(range.toDate, 1) + 'T00:00',
      );
    if (!from || !next) return null;
    const to = new Date(Date.parse(next) - 1).toISOString();
    if (
      !historyTimestamp(to) ||
      Date.parse(to) - Date.parse(from) > 63_072_000_000
    )
      return null; // Backend's 730 elapsed-day limit, not boundary arithmetic.
    return { from, to, timezone };
  } catch {
    return null;
  }
}
export function normalizeProgressRange(
  params: URLSearchParams,
  localDate: string,
  timezone: string,
): DateRange {
  const range = {
    fromDate: one(params, 'fromDate') ?? '',
    toDate: one(params, 'toDate') ?? '',
  };
  return trendRange(range, timezone) ? range : defaultProgressRange(localDate);
}
export function selectedTrendMetric(params: URLSearchParams): TrendMetric {
  return (
    trendMetrics.find((metric) => metric.key === one(params, 'metric'))?.key ??
    'totalVolumeKg'
  );
}
export function exerciseProgressUrl(
  exerciseId: string,
  range?: DateRange,
  page = 1,
  metric: TrendMetric = 'totalVolumeKg',
): string {
  const params = new URLSearchParams();
  if (range) {
    params.set('fromDate', range.fromDate);
    params.set('toDate', range.toDate);
  }
  if (page > 1) params.set('performancePage', String(page));
  if (metric !== 'totalVolumeKg') params.set('metric', metric);
  return (
    '/progress/exercises/' +
    encodeURIComponent(exerciseId) +
    (params.size ? '?' + params : '')
  );
}
export function safeProgressReturn(url: URL): string | null {
  if (url.pathname === '/progress')
    return selectorUrl(selectorQuery(url.searchParams));
  const match = /^\/progress\/exercises\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    if (!id || id === '.' || id === '..') return null;
    const range = {
      fromDate: one(url.searchParams, 'fromDate') ?? '',
      toDate: one(url.searchParams, 'toDate') ?? '',
    };
    return exerciseProgressUrl(
      id,
      validDatePair(range) ? range : undefined,
      progressPage(one(url.searchParams, 'performancePage')),
      selectedTrendMetric(url.searchParams),
    );
  } catch {
    return null;
  }
}
