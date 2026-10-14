import {
  addCalendarDaysToDateOnly,
  parseDateOnly,
} from '../dashboard/calendar';

export function isCalendarMonth(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}$/.test(value) &&
    parseDateOnly(value + '-01') !== null
  );
}
export function shiftCalendarMonth(
  month: string,
  offset: number,
): string | null {
  if (!isCalendarMonth(month) || !Number.isSafeInteger(offset)) return null;
  const index =
    (Number(month.slice(0, 4)) - 1) * 12 + Number(month.slice(5)) - 1 + offset;
  if (!Number.isSafeInteger(index) || index < 0 || index >= 9999 * 12)
    return null;
  return (
    String(Math.floor(index / 12) + 1).padStart(4, '0') +
    '-' +
    String((index % 12) + 1).padStart(2, '0')
  );
}
export function monthBoundaries(month: string): {
  fromDate: string;
  toDate: string;
} {
  if (!isCalendarMonth(month)) throw new RangeError('Invalid calendar month.');
  let lastDay = 31;
  while (!parseDateOnly(month + '-' + lastDay)) lastDay--;
  return { fromDate: month + '-01', toDate: month + '-' + lastDay };
}
// Coverage coordinates only, never local instants or synthesized activity rows.
export function calendarDates(
  fromDate: string,
  toDate: string,
): string[] | null {
  if (!parseDateOnly(fromDate) || !parseDateOnly(toDate) || fromDate > toDate)
    return null;
  const dates: string[] = [];
  let date = fromDate;
  while (dates.length < 366) {
    dates.push(date);
    if (date === toDate) return dates;
    date = addCalendarDaysToDateOnly(date, 1);
  }
  return null;
}
export function mondayFirstOffset(date: string): number {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new RangeError('Invalid calendar date.');
  return (parsed.getUTCDay() + 6) % 7;
}
export function calendarMonthFromUrl(params: URLSearchParams): string | null {
  const month =
    params.getAll('month').length === 1 ? params.get('month') : null;
  return isCalendarMonth(month) ? month : null;
}
export function calendarUrl(month: string | null): string {
  return (
    '/history/calendar' +
    (isCalendarMonth(month) ? '?' + new URLSearchParams({ month }) : '')
  );
}
export function formatCalendarDate(date: string, locale?: string): string {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new RangeError('Invalid calendar date.');
  // Explicit UTC formats the DATE-only carrier without applying a local offset.
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parsed);
}
export function formatCalendarMonth(month: string, locale?: string): string {
  const parsed = parseDateOnly(month + '-01');
  if (!parsed) throw new RangeError('Invalid calendar month.');
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}
