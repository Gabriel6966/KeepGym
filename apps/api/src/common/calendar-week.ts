import { addCalendarDays, parseCalendarDate } from './calendar-date';

// DATE-ONLY arithmetic uses UTC solely as a calendar carrier. These Date values
// are NOT local-midnight instants; PostgreSQL resolves those using the IANA zone.
export function parseLocalMonday(value: unknown): Date | null {
  const date = parseCalendarDate(value);
  return date?.getUTCDay() === 1 ? date : null;
}

export function shiftLocalMonday(value: string, weeks: number): string {
  const date = parseLocalMonday(value);
  if (!date || !Number.isSafeInteger(weeks))
    throw new RangeError('Invalid calendar week.');
  try {
    return addCalendarDays(value, weeks * 7);
  } catch {
    throw new RangeError(
      'Calendar week boundary exceeds years 0001 through 9999.',
    );
  }
}

export function canonicalIanaTimezone(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > 100 ||
    /^[+-]/.test(value)
  )
    return null;
  try {
    // Intl includes offset identifiers in Node 24; exclude them above. Use its
    // IANA database instead of maintaining an incomplete manual timezone list.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
