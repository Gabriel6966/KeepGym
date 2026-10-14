import {
  addCalendarDaysToDateOnly,
  isLocalMondayDate,
} from '../dashboard/calendar';
import { muscleGroupValues } from '../dashboard/dashboard.types';
import { trendRange } from './progress-query';
import { defaultTrainingRange } from './training-query';
import {
  trainingMetrics,
  type TrainingMetric,
  type TrainingWeekRange,
} from './training.types';
import type { WeeklyQuery } from './progress.types';
import type { MuscleFilter, MuscleWeek } from './muscle.types';

const one = (params: URLSearchParams, key: string) =>
  params.getAll(key).length === 1 ? params.get(key) : null;
function calendarWeeks(range: TrainingWeekRange): boolean {
  if (
    !isLocalMondayDate(range.fromWeekStart) ||
    !isLocalMondayDate(range.toWeekStart) ||
    range.fromWeekStart > range.toWeekStart
  )
    return false;
  try {
    addCalendarDaysToDateOnly(range.toWeekStart, 7);
    return true;
  } catch {
    return false;
  }
}
export function muscleWeekQuery(
  range: TrainingWeekRange,
  timezone: string,
): WeeklyQuery | null {
  if (!calendarWeeks(range)) return null;
  return trendRange(
    {
      fromDate: range.fromWeekStart,
      toDate: addCalendarDaysToDateOnly(range.toWeekStart, 6),
    },
    timezone,
  );
}
export function muscleUrlState(params: URLSearchParams): {
  range?: TrainingWeekRange;
  metric: TrainingMetric;
  muscleGroup: MuscleFilter;
} {
  const range = {
    fromWeekStart: one(params, 'fromWeekStart') ?? '',
    toWeekStart: one(params, 'toWeekStart') ?? '',
  };
  return {
    range: calendarWeeks(range) ? range : undefined,
    metric:
      trainingMetrics.find((m) => m.key === one(params, 'metric'))?.key ??
      'completedSets',
    muscleGroup:
      muscleGroupValues.find((group) => group === one(params, 'muscleGroup')) ??
      'ALL',
  };
}
export function normalizeMuscleRange(
  params: URLSearchParams,
  localDate: string,
  timezone: string,
): TrainingWeekRange {
  const range = muscleUrlState(params).range;
  return range && muscleWeekQuery(range, timezone)
    ? range
    : defaultTrainingRange(localDate);
}
export function muscleProgressUrl({
  range,
  metric = 'completedSets',
  muscleGroup = 'ALL',
}: {
  range?: TrainingWeekRange;
  metric?: TrainingMetric;
  muscleGroup?: MuscleFilter;
} = {}): string {
  const params = new URLSearchParams();
  if (range) {
    params.set('fromWeekStart', range.fromWeekStart);
    params.set('toWeekStart', range.toWeekStart);
  }
  if (range || metric !== 'completedSets') params.set('metric', metric);
  if (range || muscleGroup !== 'ALL') params.set('muscleGroup', muscleGroup);
  return '/progress/muscle-groups' + (params.size ? '?' + params : '');
}
// Presentation filter only: retain rows/values/order; omit empty visible weeks.
export function visibleMuscleWeeks(
  buckets: readonly MuscleWeek[],
  filter: MuscleFilter,
): readonly MuscleWeek[] {
  if (filter === 'ALL') return buckets;
  return buckets
    .map((bucket) => ({
      ...bucket,
      muscleGroups: bucket.muscleGroups.filter(
        (row) => row.muscleGroup === filter,
      ),
    }))
    .filter((bucket) => bucket.muscleGroups.length > 0);
}
