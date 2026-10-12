import { bodyMetricKeys, type BodyMetric } from '../dashboard/dashboard.types';
import { historyTimestamp } from '../history/history-query';
import { instantToLocalInput, localInputToRFC3339 } from './body-time';
import {
  bodyFields,
  type BodyMeasurement,
  type BodyMeasurementInput,
} from './body.types';

export type BodyTimeMode = 'now' | 'keep' | 'local' | 'exact';
export interface MeasurementDraft extends Record<BodyMetric, string> {
  notes: string;
  timeMode: BodyTimeMode;
  measuredAt: string;
}
export type BodyFormErrors = Partial<
  Record<BodyMetric | 'notes' | 'measuredAt' | 'form', string>
>;
export function measurementDraft(
  measurement?: BodyMeasurement,
): MeasurementDraft {
  return {
    weightKg: measurement?.weightKg == null ? '' : String(measurement.weightKg),
    bodyFatPercent:
      measurement?.bodyFatPercent == null
        ? ''
        : String(measurement.bodyFatPercent),
    waistCm: measurement?.waistCm == null ? '' : String(measurement.waistCm),
    chestCm: measurement?.chestCm == null ? '' : String(measurement.chestCm),
    hipsCm: measurement?.hipsCm == null ? '' : String(measurement.hipsCm),
    notes: measurement?.notes ?? '',
    timeMode: measurement ? 'keep' : 'now',
    measuredAt: '',
  };
}
export function parseBodyDecimal(
  raw: string,
  maximum: number,
): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return undefined;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= maximum
    ? value
    : undefined;
}
export function validateMeasurementDraft(
  draft: MeasurementDraft,
  original?: BodyMeasurement,
):
  | { input: BodyMeasurementInput; errors?: never }
  | { input?: never; errors: BodyFormErrors } {
  const errors: BodyFormErrors = {},
    input: BodyMeasurementInput = {};
  let hasMetric = false;
  for (const field of bodyMetricKeys) {
    const value = parseBodyDecimal(draft[field], bodyFields[field].maximum);
    if (value === undefined)
      errors[field] =
        `Use a positive value up to ${bodyFields[field].maximum}, with at most 2 decimals.`;
    else {
      if (value !== null) hasMetric = true;
      if (original ? value !== original[field] : value !== null)
        input[field] = value;
    }
  }
  if (!hasMetric)
    errors.form =
      'Enter at least one body metric. Notes do not count as a metric.';
  const notes = draft.notes.trim();
  if ([...notes].length > 1000)
    errors.notes = 'Use at most 1000 notes characters.';
  if (original ? notes !== (original.notes ?? '') : notes !== '')
    input.notes = notes === '' ? null : notes;
  if (draft.timeMode === 'local' || draft.timeMode === 'exact') {
    const timestamp =
      draft.timeMode === 'local'
        ? original &&
          draft.measuredAt === instantToLocalInput(original.measuredAt)
          ? original.measuredAt
          : localInputToRFC3339(draft.measuredAt)
        : historyTimestamp(draft.measuredAt)?.toISOString();
    if (!timestamp)
      errors.measuredAt =
        'Choose a real local time (not a DST gap), or an exact RFC3339 timestamp with timezone.';
    else if (
      !original ||
      Date.parse(timestamp) !== Date.parse(original.measuredAt)
    )
      input.measuredAt = timestamp;
  } else if (
    (original && draft.timeMode !== 'keep') ||
    (!original && draft.timeMode !== 'now')
  )
    errors.measuredAt = 'Choose a supported measurement time mode.';
  if (original && !Object.keys(input).length && !Object.keys(errors).length)
    errors.form = 'No changes to save.';
  return Object.keys(errors).length ? { errors } : { input };
}
