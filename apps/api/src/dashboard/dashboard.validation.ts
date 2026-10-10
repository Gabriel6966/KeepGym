import { isUUID } from 'class-validator';
import { addCalendarDays } from '../common/calendar-date';
import {
  canonicalIanaTimezone,
  parseLocalMonday,
  shiftLocalMonday,
} from '../common/calendar-week';
import { InvalidDashboardQueryError } from './errors/invalid-dashboard-query.error';
import type {
  DashboardSummaryInput,
  DashboardSummaryQuery,
} from './dashboard.types';

export function normalizeDashboardSummary(
  userId: string,
  input: DashboardSummaryInput,
): DashboardSummaryQuery {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidDashboardQueryError('User identifier must be a UUID.');
  if (!parseLocalMonday(input.weekStart))
    throw new InvalidDashboardQueryError(
      'weekStart must be a real Monday date in YYYY-MM-DD format.',
    );
  const timezone = canonicalIanaTimezone(input.timezone);
  if (timezone === null)
    throw new InvalidDashboardQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  try {
    // DATE-only arithmetic: neither elapsed UTC hours nor the current clock.
    // Validate the exclusive boundary required by the downstream domains too.
    shiftLocalMonday(input.weekStart, 1);
    return {
      weekStart: input.weekStart,
      timezone,
      toDate: addCalendarDays(input.weekStart, 6),
      fromWeekStart: shiftLocalMonday(input.weekStart, -11),
    };
  } catch {
    throw new InvalidDashboardQueryError(
      'Dashboard calendar boundaries must remain within years 0001 through 9999.',
    );
  }
}
