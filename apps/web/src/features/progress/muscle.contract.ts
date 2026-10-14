import { muscleGroupValues } from '../dashboard/dashboard.types';
import { isLocalMondayDate } from '../dashboard/calendar';
import { historyTimestamp } from '../history/history-query';
import type { WeeklyMuscleGroups } from './muscle.types';

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const numeric = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => numeric(v) && Number.isSafeInteger(v);
export function isWeeklyMuscleGroups(v: unknown): v is WeeklyMuscleGroups {
  return (
    object(v) &&
    typeof v.timezone === 'string' &&
    historyTimestamp(v.from) !== null &&
    historyTimestamp(v.to) !== null &&
    Array.isArray(v.buckets) &&
    v.buckets.every(
      (b) =>
        object(b) &&
        isLocalMondayDate(b.weekStart) &&
        Array.isArray(b.muscleGroups) &&
        b.muscleGroups.every(
          (row) =>
            object(row) &&
            muscleGroupValues.some((group) => group === row.muscleGroup) &&
            count(row.completedWorkouts) &&
            count(row.completedSets) &&
            count(row.totalReps) &&
            numeric(row.totalVolumeKg),
        ),
    )
  );
}
