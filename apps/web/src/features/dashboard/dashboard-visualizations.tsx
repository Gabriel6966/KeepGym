import type {
  BodyMetric,
  ComparisonKey,
  DashboardSummary,
  MuscleGroupActivity,
} from './dashboard.types';
import { bodyMetricKeys } from './dashboard.types';
import {
  formatDate,
  formatKg,
  formatNumber,
  formatPercentage,
  formatSignedNumber,
} from './format';
import { EmptyState, Metric } from './dashboard.ui';
import { ComparisonBars, DecorativeBar } from './dashboard-bars';
import { normalizeNonNegativeBars } from './visual-scale';

const comparisonLabels: Record<ComparisonKey, string> = {
  completedWorkouts: 'Workouts',
  completedSets: 'Sets',
  totalReps: 'Reps',
  totalVolumeKg: 'Volume (kg)',
};
const comparisonKeys = [
  'completedWorkouts',
  'completedSets',
  'totalReps',
  'totalVolumeKg',
] as const;
const bodyLabels: Record<BodyMetric, { label: string; unit: string }> = {
  weightKg: { label: 'Weight', unit: 'kg' },
  bodyFatPercent: { label: 'Body fat', unit: '%' },
  waistCm: { label: 'Waist', unit: 'cm' },
  chestCm: { label: 'Chest', unit: 'cm' },
  hipsCm: { label: 'Hips', unit: 'cm' },
};

export function WeeklyComparisonVisualization({
  week,
  comparison,
  locale,
}: {
  week: DashboardSummary['week'];
  comparison: DashboardSummary['comparison'];
  locale?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {comparisonKeys.map((key) => (
        <article
          key={key}
          data-comparison-metric={key}
          className="min-w-0 rounded-lg border border-slate-200 p-4"
        >
          <h3 className="mb-4 font-semibold text-slate-800 [overflow-wrap:anywhere]">
            {comparisonLabels[key]}
          </h3>
          <ComparisonBars
            previous={comparison[key].previous}
            current={week[key]}
            formatValue={(value) =>
              key === 'totalVolumeKg'
                ? formatKg(value, locale)
                : formatNumber(value, locale)
            }
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            <Metric
              label="Change"
              value={
                formatSignedNumber(comparison[key].delta, locale) +
                (key === 'totalVolumeKg' ? ' kg' : '')
              }
            />
            <Metric
              label="% change"
              value={formatPercentage(comparison[key].percentageChange, locale)}
            />
          </dl>
        </article>
      ))}
    </div>
  );
}

export function MuscleGroupVisualization({
  groups,
  locale,
}: {
  groups: readonly MuscleGroupActivity[];
  locale?: string;
}) {
  if (groups.length === 0)
    return <EmptyState>No muscle-group activity this week.</EmptyState>;
  const widths = normalizeNonNegativeBars(
    groups.map((group) => group.completedSets),
  );
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group, index) => (
        <li
          key={group.muscleGroup}
          data-muscle-group={group.muscleGroup}
          className="min-w-0 rounded-lg border border-slate-200 p-4"
        >
          <h3 className="mb-4 font-semibold text-slate-800 [overflow-wrap:anywhere]">
            {group.muscleGroup[0] + group.muscleGroup.slice(1).toLowerCase()}
          </h3>
          <dl className="grid grid-cols-2 gap-3">
            <Metric
              label="Workouts"
              value={formatNumber(group.completedWorkouts, locale)}
            />
            <Metric
              label="Sets"
              value={formatNumber(group.completedSets, locale)}
            />
            <Metric
              label="Reps"
              value={formatNumber(group.totalReps, locale)}
            />
            <Metric
              label="Volume"
              value={formatKg(group.totalVolumeKg, locale)}
            />
          </dl>
          <div aria-hidden="true" className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">Completed sets</p>
            <DecorativeBar width={widths[index] ?? 0} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BodyProgressVisualization({
  progress,
  timezone,
  locale,
}: {
  progress: DashboardSummary['bodyProgress'];
  timezone: string;
  locale?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {bodyMetricKeys.map((key) => {
        const metric = progress[key],
          { label, unit } = bodyLabels[key];
        const value = (n: number | null) =>
          n === null
            ? '—'
            : `${formatNumber(n, locale)}${unit === '%' ? '' : ' '}${unit}`;
        return (
          <article
            key={key}
            data-body-metric={key}
            className="min-w-0 rounded-lg border border-slate-200 p-4"
          >
            <h3 className="mb-4 font-semibold text-slate-800">{label}</h3>
            <ComparisonBars
              previous={metric.previous?.value ?? null}
              current={metric.latest?.value ?? null}
              currentLabel="Latest"
              formatValue={value}
            />
            <dl className="mt-4 border-t border-slate-100 pt-3">
              <Metric
                label="Change"
                value={
                  metric.change === null
                    ? '—'
                    : `${formatSignedNumber(metric.change, locale)} ${unit === '%' ? 'pp' : unit}`
                }
              />
            </dl>
            {metric.latest ? (
              <time
                dateTime={metric.latest.measuredAt}
                className="mt-3 block text-xs text-slate-500"
              >
                Latest measured{' '}
                {formatDate(metric.latest.measuredAt, timezone, locale)}
              </time>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No observations</p>
            )}
            {metric.previous && (
              <time
                dateTime={metric.previous.measuredAt}
                className="mt-2 block text-xs text-slate-500"
              >
                Previous measured{' '}
                {formatDate(metric.previous.measuredAt, timezone, locale)}
              </time>
            )}
          </article>
        );
      })}
    </div>
  );
}
