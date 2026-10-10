import { isUUID } from 'class-validator';
import { InvalidHistoryQueryError } from './errors/invalid-history-query.error';
import {
  historyStatuses,
  type HistoryQueryInput,
  type HistoryQuery,
  type WorkoutHistoryQueryInput,
  type WorkoutHistoryQuery,
  type RecentWorkoutsQueryInput,
} from './history.types';

export function normalizeRecentWorkoutsLimit(
  input: RecentWorkoutsQueryInput,
): number {
  const limit = input.limit === undefined ? 5 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new InvalidHistoryQueryError(
      'limit must be an integer between 1 and 20.',
    );
  return limit;
}

// Match the database's millisecond precision. Reject rollover dates, local times,
// leap seconds and excess precision rather than silently changing a boundary.
export function historyTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    Number(match[7] ?? 0) > 23 ||
    Number(match[8] ?? 0) > 59
  )
    return null;
  const date = new Date(value);
  // Offsets must not move the UTC boundary outside the supported AD four-digit
  // year range (PostgreSQL does not accept an ISO year zero).
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.getUTCFullYear() <= 9999
    ? date
    : null;
}

export function validateHistoryIds(...ids: string[]): void {
  if (ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    throw new InvalidHistoryQueryError('Identifiers must be UUIDs.');
}
export function normalizeHistoryQuery(input: HistoryQueryInput): HistoryQuery {
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
    throw new InvalidHistoryQueryError('Invalid pagination range.');
  if (input.status !== undefined && !historyStatuses.includes(input.status))
    throw new InvalidHistoryQueryError(
      'status must be COMPLETED or CANCELLED.',
    );
  const from =
    input.from === undefined ? undefined : historyTimestamp(input.from);
  const to = input.to === undefined ? undefined : historyTimestamp(input.to);
  if (from === null || to === null)
    throw new InvalidHistoryQueryError(
      'Dates must be real RFC3339 timestamps with timezone and at most millisecond precision.',
    );
  if (from && to && from > to)
    throw new InvalidHistoryQueryError('from must not be later than to.');
  return { status: input.status, from, to, page, limit };
}
export function normalizeWorkoutHistoryQuery(
  input: WorkoutHistoryQueryInput,
): WorkoutHistoryQuery {
  const query = normalizeHistoryQuery(input);
  if (
    input.q !== undefined &&
    (typeof input.q !== 'string' ||
      !input.q.trim() ||
      [...input.q.trim()].length > 100)
  )
    throw new InvalidHistoryQueryError(
      'q must contain between 1 and 100 characters.',
    );
  return { ...query, q: input.q?.trim() };
}
