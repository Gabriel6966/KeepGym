// UTC is only a DATE-only calendar carrier, never the browser's local midnight.
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}
export function addCalendarDaysToDateOnly(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date || !Number.isSafeInteger(days))
    throw new RangeError('Invalid calendar date.');
  date.setUTCDate(date.getUTCDate() + days);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    throw new RangeError('Invalid calendar boundary.');
  return date.toISOString().slice(0, 10);
}
export function getLocalMondayDate(localDate: string): string {
  const date = parseDateOnly(localDate);
  if (!date) throw new RangeError('Invalid local date.');
  return addCalendarDaysToDateOnly(localDate, -((date.getUTCDay() + 6) % 7));
}
export function isLocalMondayDate(value: unknown): value is string {
  const date = parseDateOnly(value);
  return date !== null && date.getUTCDay() === 1 && typeof value === 'string';
}
export function isDashboardWeek(value: unknown): value is string {
  if (!isLocalMondayDate(value)) return false;
  try {
    // Match the existing dashboard's 12-week window and next-Monday boundary.
    addCalendarDaysToDateOnly(value, -77);
    addCalendarDaysToDateOnly(value, 7);
    return true;
  } catch {
    return false;
  }
}
export function resolveWeekStart(
  value: unknown,
  currentLocalDate: string,
): string {
  return isDashboardWeek(value) ? value : getLocalMondayDate(currentLocalDate);
}
export function canonicalBrowserTimezone(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    /^[+-]/.test(value)
  )
    return 'UTC';
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return 'UTC';
  }
}
export function getLocalDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function dashboardReturnPath(value: string | null): string {
  if (!value?.startsWith('/dashboard') || value.startsWith('//'))
    return '/dashboard';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (
      url.origin !== 'https://return.invalid' ||
      url.pathname !== '/dashboard'
    )
      return '/dashboard';
    const weekStart = url.searchParams.get('weekStart');
    return isDashboardWeek(weekStart)
      ? '/dashboard?' + new URLSearchParams({ weekStart })
      : '/dashboard';
  } catch {
    return '/dashboard';
  }
}
