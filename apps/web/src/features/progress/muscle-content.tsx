import Link from 'next/link';
import { EmptyState, buttonClass } from '../dashboard/dashboard.ui';
import { DecorativeBar } from '../dashboard/dashboard-bars';
import { normalizeNonNegativeBars } from '../dashboard/visual-scale';
import { formatKg, formatNumber } from '../dashboard/format';
import {
  trainingMetrics,
  type TrainingMetric,
  type TrainingWeekRange,
} from './training.types';
import type { MuscleFilter, WeeklyMuscleGroups } from './muscle.types';
import { muscleProgressUrl, visibleMuscleWeeks } from './muscle-query';

export function MuscleProgressLink({
  range,
  metric,
}: {
  range?: TrainingWeekRange;
  metric?: TrainingMetric;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">Muscle group progress</h2>
      <p className="mt-2 text-sm text-slate-500">
        Explore weekly primary-muscle activity across this range, with exact
        backend values.
      </p>
      <Link
        href={muscleProgressUrl({ range, metric })}
        className={buttonClass + ' mt-4'}
      >
        View muscle group progress
      </Link>
    </div>
  );
}
export function MuscleWeeksContent({
  data,
  metric,
  muscleGroup,
  locale,
}: {
  data: WeeklyMuscleGroups;
  metric: TrainingMetric;
  muscleGroup: MuscleFilter;
  locale?: string;
}) {
  if (data.buckets.length === 0)
    return <EmptyState>No muscle-group activity in this range.</EmptyState>;
  const weeks = visibleMuscleWeeks(data.buckets, muscleGroup),
    option = trainingMetrics.find((m) => m.key === metric)!;
  if (weeks.length === 0)
    return (
      <EmptyState>No activity for this muscle group in this range.</EmptyState>
    );
  return (
    <ol className="space-y-5">
      {weeks.map((week) => {
        const widths = normalizeNonNegativeBars(
          week.muscleGroups.map((row) => row[metric]),
        );
        return (
          <li
            key={week.weekStart}
            data-muscle-week={week.weekStart}
            className="min-w-0 rounded-lg border border-slate-200 p-4 sm:p-5"
          >
            <h3 className="mb-4 font-semibold">
              Week of <time dateTime={week.weekStart}>{week.weekStart}</time>
            </h3>
            <ul className="space-y-5">
              {week.muscleGroups.map((row, index) => (
                <li
                  key={row.muscleGroup}
                  data-progress-muscle={row.muscleGroup}
                >
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <h4 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                      {row.muscleGroup.replaceAll('_', ' ')}
                    </h4>
                    <p className="min-w-0 text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {option.label}:{' '}
                      {option.unit === 'kg'
                        ? formatKg(row[metric], locale)
                        : `${formatNumber(row[metric], locale)} ${option.unit}`}
                    </p>
                  </div>
                  <DecorativeBar width={widths[index]!} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
