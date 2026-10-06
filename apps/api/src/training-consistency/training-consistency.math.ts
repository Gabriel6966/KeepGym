import { parseLocalMonday } from '../common/calendar-week';

// These are DATE-ONLY calendar coordinates, never timezone-resolved instants.
// Their exact difference counts calendar weeks even across DST transitions.
const CALENDAR_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function mondayCoordinate(value: string): number {
  const date = parseLocalMonday(value);
  if (!date) throw new RangeError('Expected a real Monday date.');
  return date.getTime();
}

export function calculateTotalWeeks(
  fromWeekStart: string,
  toWeekStart: string,
): number {
  const difference =
    mondayCoordinate(toWeekStart) - mondayCoordinate(fromWeekStart);
  if (difference < 0) throw new RangeError('Week range is reversed.');
  return difference / CALENDAR_WEEK_MS + 1;
}

function activeOffsets(
  from: string,
  to: string,
  activeWeekStarts: readonly string[],
): number[] {
  const total = calculateTotalWeeks(from, to);
  const first = mondayCoordinate(from);
  return [
    ...new Set(
      activeWeekStarts.map(
        (week) => (mondayCoordinate(week) - first) / CALENDAR_WEEK_MS,
      ),
    ),
  ]
    .filter((index) => index >= 0 && index < total)
    .sort((a, b) => a - b);
}

export function calculateLongestWeeklyStreak(
  from: string,
  to: string,
  activeWeekStarts: readonly string[],
): number {
  let longest = 0;
  let streak = 0;
  let previous: number | undefined;
  for (const index of activeOffsets(from, to, activeWeekStarts)) {
    streak = previous !== undefined && index === previous + 1 ? streak + 1 : 1;
    longest = Math.max(longest, streak);
    previous = index;
  }
  return longest;
}

export function calculateEndingWeeklyStreak(
  from: string,
  to: string,
  activeWeekStarts: readonly string[],
): number {
  const active = new Set(activeOffsets(from, to, activeWeekStarts));
  let streak = 0;
  for (
    let index = calculateTotalWeeks(from, to) - 1;
    index >= 0 && active.has(index);
    index--
  )
    streak++;
  return streak;
}
