import { canonicalBrowserTimezone } from '../dashboard/calendar';
import { calendarDates } from './calendar-month';
import type { CalendarQuery, TrainingCalendar } from './calendar.types';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown) => numeric(value) && Number.isSafeInteger(value);
export function validCalendarQuery(query: CalendarQuery): boolean {
  return (
    canonicalBrowserTimezone(query.timezone) === query.timezone &&
    calendarDates(query.fromDate, query.toDate) !== null
  );
}
export function isTrainingCalendar(value: unknown): value is TrainingCalendar {
  if (
    !object(value) ||
    typeof value.fromDate !== 'string' ||
    typeof value.toDate !== 'string' ||
    typeof value.timezone !== 'string' ||
    canonicalBrowserTimezone(value.timezone) !== value.timezone ||
    !Array.isArray(value.days)
  )
    return false;
  const dates = calendarDates(value.fromDate, value.toDate);
  return (
    dates !== null &&
    value.days.length === dates.length &&
    value.days.every(
      (day, index) =>
        object(day) &&
        day.date === dates[index] &&
        count(day.completedWorkouts) &&
        count(day.completedSets) &&
        count(day.totalReps) &&
        numeric(day.totalVolumeKg) &&
        numeric(day.totalDurationSeconds),
    )
  );
}
