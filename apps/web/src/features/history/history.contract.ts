import { isWorkoutSession } from '../workout/workout.contract';
import { historyTimestamp } from './history-query';
import {
  historyStatuses,
  type WorkoutHistoryDetail,
  type WorkoutHistoryPage,
  type WorkoutHistorySummary,
} from './history.types';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function isHistorySummary(
  value: unknown,
): value is WorkoutHistorySummary {
  return (
    object(value) &&
    text(value.id) &&
    text(value.name) &&
    historyStatuses.some((status) => status === value.status) &&
    historyTimestamp(value.startedAt) !== null &&
    (value.endedAt === null || historyTimestamp(value.endedAt) !== null) &&
    count(value.exerciseCount) &&
    count(value.setCount)
  );
}
export function isHistoryPage(value: unknown): value is WorkoutHistoryPage {
  return (
    object(value) &&
    Array.isArray(value.items) &&
    value.items.every(isHistorySummary) &&
    count(value.page) &&
    value.page > 0 &&
    count(value.limit) &&
    value.limit > 0 &&
    count(value.total) &&
    count(value.totalPages)
  );
}
export function isHistoryDetail(value: unknown): value is WorkoutHistoryDetail {
  return (
    isWorkoutSession(value) &&
    (value.status === 'COMPLETED' || value.status === 'CANCELLED')
  );
}
