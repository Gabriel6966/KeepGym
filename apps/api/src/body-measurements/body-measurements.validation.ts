import { isUUID } from 'class-validator';
import { historyTimestamp } from '../history/history.validation';
import { InvalidBodyMeasurementError } from './errors/invalid-body-measurement.error';
import type {
  BodyMeasurementChanges,
  BodyMeasurementInput,
  BodyMeasurementQuery,
  BodyMeasurementQueryInput,
} from './body-measurements.types';

export const metricLimits = {
  weightKg: 1000,
  bodyFatPercent: 100,
  waistCm: 500,
  chestCm: 500,
  hipsCm: 500,
} as const;
export const metricFields = Object.keys(
  metricLimits,
) as (keyof typeof metricLimits)[];
export const measurementClockSkewMs = 60_000;

export function assertMeasurementIds(...ids: string[]): void {
  if (ids.some((id) => typeof id !== 'string' || !isUUID(id)))
    throw new InvalidBodyMeasurementError('Identifiers must be UUIDs.');
}

export function assertMeasurementHasMetric(
  input: Partial<Record<keyof typeof metricLimits, unknown>>,
): void {
  if (
    !metricFields.some(
      (field) => input[field] !== null && input[field] !== undefined,
    )
  )
    throw new InvalidBodyMeasurementError(
      'At least one measurement metric is required.',
    );
}

export function normalizeMeasurementChanges(
  input: BodyMeasurementInput,
  now = new Date(),
): BodyMeasurementChanges {
  const changes: BodyMeasurementChanges = {};
  for (const field of metricFields) {
    const value = input[field];
    if (value === undefined) continue;
    if (
      value !== null &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > metricLimits[field] ||
        Number(value.toFixed(2)) !== value)
    )
      throw new InvalidBodyMeasurementError(
        `${field} must be null or a positive number no greater than ${metricLimits[field]} with at most two decimal places.`,
      );
    changes[field] = value;
  }
  if (input.measuredAt !== undefined) {
    const date = historyTimestamp(input.measuredAt);
    if (!date)
      throw new InvalidBodyMeasurementError(
        'measuredAt must be a real RFC3339 timestamp with timezone and at most millisecond precision.',
      );
    if (date.getTime() > now.getTime() + measurementClockSkewMs)
      throw new InvalidBodyMeasurementError(
        'measuredAt must not be in the future (60 seconds clock tolerance).',
      );
    changes.measuredAt = date;
  }
  if (input.notes !== undefined) {
    if (
      input.notes !== null &&
      (typeof input.notes !== 'string' || [...input.notes.trim()].length > 1000)
    )
      throw new InvalidBodyMeasurementError(
        'notes must be null or a string of at most 1000 characters.',
      );
    changes.notes = input.notes === null ? null : input.notes.trim();
  }
  return changes;
}

export function normalizeMeasurementQuery(
  input: BodyMeasurementQueryInput,
): BodyMeasurementQuery {
  const page = input.page === undefined ? 1 : input.page;
  const limit = input.limit === undefined ? 20 : input.limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger((page - 1) * limit) ||
    (page - 1) * limit > 2147483647
  )
    throw new InvalidBodyMeasurementError('Invalid pagination range.');
  const from =
    input.from === undefined ? undefined : historyTimestamp(input.from);
  const to = input.to === undefined ? undefined : historyTimestamp(input.to);
  if (from === null || to === null)
    throw new InvalidBodyMeasurementError(
      'Dates must be real RFC3339 timestamps with timezone and at most millisecond precision.',
    );
  if (from && to && from > to)
    throw new InvalidBodyMeasurementError('from must not be later than to.');
  return { from, to, page, limit };
}
