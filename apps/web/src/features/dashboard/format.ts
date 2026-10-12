import { addCalendarDaysToDateOnly, parseDateOnly } from './calendar';

export const absentValue = '—';
export function formatNumber(
  value: number | null,
  locale?: string,
  maximumFractionDigits = 2,
): string {
  return value === null
    ? absentValue
    : new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}
export function formatKg(value: number | null, locale?: string): string {
  return value === null ? absentValue : `${formatNumber(value, locale)} kg`;
}
export function formatSignedNumber(
  value: number | null,
  locale?: string,
): string {
  return value === null
    ? absentValue
    : new Intl.NumberFormat(locale, {
        maximumFractionDigits: 2,
        signDisplay: 'exceptZero',
      }).format(value);
}
export function formatPercentage(
  value: number | null,
  locale?: string,
): string {
  return value === null ? absentValue : `${formatSignedNumber(value, locale)}%`;
}
export function formatDuration(
  seconds: number | null,
  locale?: string,
): string {
  if (seconds === null) return absentValue;
  const minutes = Math.floor(seconds / 60),
    hours = Math.floor(minutes / 60);
  if (hours > 0) return `${formatNumber(hours, locale, 0)}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : `${formatNumber(seconds, locale, 3)}s`;
}
export function formatDate(
  instant: string,
  timezone: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(instant));
}
export function formatWeekRange(weekStart: string, locale?: string): string {
  const start = parseDateOnly(weekStart),
    end = parseDateOnly(addCalendarDaysToDateOnly(weekStart, 6));
  if (!start || !end) throw new RangeError('Invalid week.');
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(start, end);
}
