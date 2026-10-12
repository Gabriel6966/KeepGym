import { parseDateOnly } from '../dashboard/calendar';
import { historyTimestamp } from '../history/history-query';

const pad = (value: number, digits = 2) => String(value).padStart(digits, '0');
export function instantToLocalInput(instant: string): string {
  const date = historyTimestamp(instant);
  if (!date) throw new RangeError('Invalid measurement timestamp.');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
// Native Date delegates local wall-clock resolution to the browser's IANA
// timezone. Gaps are rejected by round-trip, never silently shifted. Repeated
// hours choose the earlier offset; an exact RFC3339 input can choose the other.
// This does not read the clock or interpret a local input as UTC.
export function localInputToRFC3339(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match || !parseDateOnly(value.slice(0, 10))) return null;
  const year = Number(match[1]),
    month = Number(match[2]) - 1,
    day = Number(match[3]),
    hour = Number(match[4]),
    minute = Number(match[5]),
    second = Number(match[6] ?? 0),
    milliseconds = Number((match[7] ?? '').padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(hour, minute, second, milliseconds);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getMilliseconds() !== milliseconds
  )
    return null;
  const offset = -date.getTimezoneOffset(),
    magnitude = Math.abs(offset);
  const result = `${value.slice(0, 16)}:${pad(second)}.${pad(milliseconds, 3)}${offset >= 0 ? '+' : '-'}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
  const parsed = historyTimestamp(result);
  // Old local-mean-time offsets can have sub-minute precision. Never invent a
  // minute offset for them: use an exact timestamp instead.
  return parsed?.getTime() === date.getTime() ? result : null;
}
