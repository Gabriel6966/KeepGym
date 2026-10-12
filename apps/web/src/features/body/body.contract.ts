import { bodyMetricKeys } from '../dashboard/dashboard.types';
import { historyTimestamp } from '../history/history-query';
import {
  bodyFields,
  type BodyMeasurement,
  type BodyMeasurementPage,
} from './body.types';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function isBodyMeasurement(value: unknown): value is BodyMeasurement {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    historyTimestamp(value.measuredAt) !== null &&
    historyTimestamp(value.createdAt) !== null &&
    historyTimestamp(value.updatedAt) !== null &&
    (value.notes === null || typeof value.notes === 'string') &&
    bodyMetricKeys.some(
      (key) => value[key] !== null && value[key] !== undefined,
    ) &&
    bodyMetricKeys.every(
      (key) =>
        value[key] === null ||
        (typeof value[key] === 'number' &&
          Number.isFinite(value[key]) &&
          value[key] > 0 &&
          value[key] <= bodyFields[key].maximum &&
          Number(value[key].toFixed(2)) === value[key]),
    )
  );
}
export function isBodyMeasurementPage(
  value: unknown,
): value is BodyMeasurementPage {
  return (
    object(value) &&
    Array.isArray(value.items) &&
    value.items.every(isBodyMeasurement) &&
    count(value.page) &&
    value.page > 0 &&
    count(value.limit) &&
    value.limit > 0 &&
    count(value.total) &&
    count(value.totalPages)
  );
}
