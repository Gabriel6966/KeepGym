import { isUUID } from 'class-validator';
import {
  countInclusiveCalendarDays,
  parseCalendarDate,
} from '../common/calendar-date';
import { canonicalIanaTimezone } from '../common/calendar-week';
import { InvalidTrainingCalendarQueryError } from './errors/invalid-training-calendar-query.error';
import type {
  TrainingCalendarInput,
  TrainingCalendarQuery,
} from './training-calendar.types';

export function normalizeTrainingCalendar(
  userId: string,
  input: TrainingCalendarInput,
): TrainingCalendarQuery {
  if (typeof userId !== 'string' || !isUUID(userId))
    throw new InvalidTrainingCalendarQueryError(
      'User identifier must be a UUID.',
    );
  if (!parseCalendarDate(input.fromDate) || !parseCalendarDate(input.toDate))
    throw new InvalidTrainingCalendarQueryError(
      'Dates must be real calendar dates in YYYY-MM-DD format.',
    );
  if (input.fromDate > input.toDate)
    throw new InvalidTrainingCalendarQueryError(
      'fromDate must not be later than toDate.',
    );
  const totalDays = countInclusiveCalendarDays(input.fromDate, input.toDate);
  if (totalDays > 366)
    throw new InvalidTrainingCalendarQueryError(
      'The inclusive range must not exceed 366 calendar days.',
    );
  const timezone = canonicalIanaTimezone(input.timezone);
  if (timezone === null)
    throw new InvalidTrainingCalendarQueryError(
      'timezone must be a valid named IANA timezone.',
    );
  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    timezone,
    totalDays,
  };
}
