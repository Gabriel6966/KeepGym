import { parseDateOnly } from '../dashboard/calendar';
import { historyStatuses, type WorkoutHistoryQuery } from './history.types';

export const historyPageSize = 20;
export type HistoryFilterDraft = {
  q: string;
  status: string;
  from: string;
  to: string;
};
export function historyTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (
    !match ||
    !parseDateOnly(match[1]) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    Number(match[5] ?? 0) > 23 ||
    Number(match[6] ?? 0) > 59
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.getUTCFullYear() <= 9999
    ? date
    : null;
}
export function validHistoryPagination(page: number, limit: number): boolean {
  return (
    Number.isSafeInteger(page) &&
    page >= 1 &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 100 &&
    (page - 1) * limit <= 2147483647
  );
}
export function filterDraft(query: WorkoutHistoryQuery): HistoryFilterDraft {
  return {
    q: query.q ?? '',
    status: query.status ?? '',
    from: query.from ?? '',
    to: query.to ?? '',
  };
}
export function validateHistoryFilters(draft: HistoryFilterDraft):
  | { query: WorkoutHistoryQuery; errors?: never }
  | {
      query?: never;
      errors: Partial<Record<keyof HistoryFilterDraft, string>>;
    } {
  const errors: Partial<Record<keyof HistoryFilterDraft, string>> = {};
  const q = draft.q.trim(),
    status = historyStatuses.find((value) => value === draft.status);
  const from = draft.from.trim(),
    to = draft.to.trim();
  if ([...q].length > 100) errors.q = 'Use at most 100 search characters.';
  if (draft.status && !status)
    errors.status = 'Choose Completed, Cancelled or All.';
  if (from && !historyTimestamp(from))
    errors.from =
      'Use a real RFC3339 timestamp with timezone, up to 3 fractional digits.';
  if (to && !historyTimestamp(to))
    errors.to =
      'Use a real RFC3339 timestamp with timezone, up to 3 fractional digits.';
  if (
    from &&
    to &&
    !errors.from &&
    !errors.to &&
    Date.parse(from) > Date.parse(to)
  )
    errors.to = 'To must not be earlier than From.';
  return Object.keys(errors).length
    ? { errors }
    : {
        query: {
          page: 1,
          limit: historyPageSize,
          q: q || undefined,
          status,
          from: from || undefined,
          to: to || undefined,
        },
      };
}
export function normalizeHistoryUrl(
  params: URLSearchParams,
): WorkoutHistoryQuery {
  const one = (key: string) =>
    params.getAll(key).length === 1 ? params.get(key) : null;
  const query: WorkoutHistoryQuery = { page: 1, limit: historyPageSize };
  const page = one('page');
  if (
    page &&
    /^[1-9]\d*$/.test(page) &&
    validHistoryPagination(Number(page), historyPageSize)
  )
    query.page = Number(page);
  const q = one('q')?.trim();
  if (q && [...q].length <= 100) query.q = q;
  query.status = historyStatuses.find((value) => value === one('status'));
  const from = one('from'),
    to = one('to');
  if (historyTimestamp(from)) query.from = from ?? undefined;
  if (historyTimestamp(to)) query.to = to ?? undefined;
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    query.from = undefined;
    query.to = undefined;
  }
  return query;
}
export function historyUrl(query: WorkoutHistoryQuery): string {
  const params = new URLSearchParams();
  if ((query.page ?? 1) > 1) params.set('page', String(query.page));
  for (const key of ['status', 'q', 'from', 'to'] as const)
    if (query[key]) params.set(key, query[key]);
  return '/history' + (params.size ? '?' + params.toString() : '');
}
export function hasHistoryFilters(query: WorkoutHistoryQuery): boolean {
  return !!(query.status || query.q || query.from || query.to);
}
