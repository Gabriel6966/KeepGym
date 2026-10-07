// UTC is ONLY a carrier for DATE-only calendar arithmetic, never a local
// midnight instant. PostgreSQL resolves local boundaries using the IANA zone.
export function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 1
    ? date
    : null;
}
export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  if (!date || !Number.isSafeInteger(days))
    throw new RangeError('Invalid calendar date or offset.');
  date.setUTCDate(date.getUTCDate() + days);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    throw new RangeError('Calendar date exceeds years 0001 through 9999.');
  return date.toISOString().slice(0, 10);
}
export function countInclusiveCalendarDays(from: string, to: string): number {
  const start = parseCalendarDate(from),
    end = parseCalendarDate(to);
  if (!start || !end || start > end)
    throw new RangeError('Invalid calendar date range.');
  // Date-only coordinates have no DST; this is NOT a difference of local instants.
  return (end.getTime() - start.getTime()) / 86400000 + 1;
}
export function* iterateCalendarDays(
  from: string,
  to: string,
): Generator<string> {
  const count = countInclusiveCalendarDays(from, to);
  for (let index = 0; index < count; index++)
    yield addCalendarDays(from, index);
}
