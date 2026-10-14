'use client';
import { useState, type FormEvent } from 'react';
import { DecorativeBar } from '../dashboard/dashboard-bars';
import { normalizeNonNegativeBars } from '../dashboard/visual-scale';
import { EmptyState, Metric, buttonClass } from '../dashboard/dashboard.ui';
import { formatDuration, formatKg, formatNumber } from '../dashboard/format';
import {
  inputClass,
  WorkoutLoading,
  WorkoutError,
} from '../workout/workout.ui';
import { trainingRangeQueries } from './training-query';
import type { ProgressRead } from './progress-read';
import {
  durationMetrics,
  trainingMetrics,
  type TrainingWeekRange,
  type TrainingMetric,
  type DurationMetric,
  type WeeklyTraining,
  type WeeklyConsistency,
  type WeeklyDuration,
} from './training.types';

export function TrainingReadState<T>({
  resource,
  title,
  children,
}: {
  resource: ProgressRead<T>;
  title: string;
  children: (data: T) => React.ReactNode;
}) {
  return resource.data ? (
    children(resource.data)
  ) : resource.failed ? (
    <WorkoutError title={title + ' unavailable'} onRetry={resource.retry} />
  ) : (
    <WorkoutLoading label={'Loading ' + title.toLowerCase() + '...'} />
  );
}
export function TrainingWeekForm({
  range,
  timezone,
  onApply,
  validateRange = (value, zone) => trainingRangeQueries(value, zone) !== null,
  helpText = 'Both Mondays are included. The range applies to all three training sections below.',
  errorText = 'Choose real Mondays in order, up to 104 inclusive weeks, with representable local midnight boundaries.',
}: {
  range: TrainingWeekRange;
  timezone: string;
  onApply: (value: TrainingWeekRange) => void;
  validateRange?: (value: TrainingWeekRange, timezone: string) => boolean;
  helpText?: string;
  errorText?: string;
}) {
  const [draft, setDraft] = useState(range),
    [error, setError] = useState(false);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateRange(draft, timezone)) {
      setError(true);
      return;
    }
    setError(false);
    onApply(draft);
  }
  return (
    <form
      noValidate
      onSubmit={apply}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
    >
      {(
        [
          { key: 'fromWeekStart', label: 'From week (Monday)' },
          { key: 'toWeekStart', label: 'To week (Monday)' },
        ] as const
      ).map((field) => (
        <div key={field.key} className="min-w-0">
          <label
            htmlFor={'training-' + field.key}
            className="text-sm font-medium"
          >
            {field.label}
          </label>
          <input
            id={'training-' + field.key}
            name={field.key}
            type="date"
            className={inputClass}
            value={draft[field.key]}
            onChange={(event) =>
              setDraft({ ...draft, [field.key]: event.target.value })
            }
            aria-invalid={error}
            aria-describedby={
              error ? 'training-range-error' : 'training-range-help'
            }
          />
        </div>
      ))}
      <button type="submit" className={buttonClass + ' self-end'}>
        Apply weeks
      </button>
      <p
        id="training-range-help"
        className="text-xs text-slate-500 sm:col-span-3"
      >
        {helpText}
      </p>
      {error && (
        <p
          id="training-range-error"
          role="alert"
          className="text-sm text-red-800 sm:col-span-3"
        >
          {errorText}
        </p>
      )}
    </form>
  );
}
function WeeklyBars({
  rows,
  label,
  formatValue,
  empty,
}: {
  rows: readonly { weekStart: string; value: number | null }[];
  label: string;
  formatValue: (value: number | null) => string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  const widths = normalizeNonNegativeBars(
    rows.flatMap((row) => (row.value === null ? [] : [row.value])),
  );
  let index = 0;
  return (
    <ol className="space-y-4">
      {rows.map((row) => {
        const width = row.value === null ? undefined : widths[index++];
        return (
          <li
            key={row.weekStart}
            data-training-week={row.weekStart}
            className="min-w-0 rounded-lg border border-slate-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                Week of <time dateTime={row.weekStart}>{row.weekStart}</time>
              </h3>
              <p className="min-w-0 text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                {label}: {formatValue(row.value)}
              </p>
            </div>
            {width !== undefined && (
              <div className="mt-3">
                <DecorativeBar width={width} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
export function TrainingTrendsContent({
  data,
  metric,
  locale,
}: {
  data: WeeklyTraining;
  metric: TrainingMetric;
  locale?: string;
}) {
  const option = trainingMetrics.find((m) => m.key === metric)!;
  return (
    <WeeklyBars
      rows={data.buckets.map((bucket) => ({
        weekStart: bucket.weekStart,
        value: bucket[metric],
      }))}
      label={option.label}
      formatValue={(value) =>
        option.unit === 'kg'
          ? formatKg(value, locale)
          : `${formatNumber(value, locale)} ${option.unit}`
      }
      empty="No training activity in this range."
    />
  );
}
export function TrainingConsistencyContent({
  data,
  locale,
}: {
  data: WeeklyConsistency;
  locale?: string;
}) {
  return (
    <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
      {(
        [
          ['totalWeeks', 'Total weeks'],
          ['completedWorkouts', 'Completed workouts'],
          ['activeDays', 'Active days'],
          ['activeWeeks', 'Active weeks'],
          ['longestWeeklyStreak', 'Longest weekly streak'],
          ['endingWeeklyStreak', 'Ending weekly streak'],
        ] as const
      ).map(([key, label]) => (
        <Metric
          key={key}
          label={label}
          value={formatNumber(data[key], locale)}
        />
      ))}
    </dl>
  );
}
function DurationValue({
  seconds,
  locale,
}: {
  seconds: number | null;
  locale?: string;
}) {
  return seconds === null ? (
    <>—</>
  ) : (
    <>
      <span>{formatDuration(seconds, locale)}</span>
      <span className="ml-2 text-xs font-normal text-slate-500">
        ({formatNumber(seconds, locale, 3)} s)
      </span>
    </>
  );
}
export function TrainingDurationSummary({
  data,
  locale,
}: {
  data: WeeklyDuration;
  locale?: string;
}) {
  return (
    <dl className="mb-6 grid grid-cols-2 gap-5 sm:grid-cols-3">
      <Metric
        label="Completed workouts"
        value={formatNumber(data.summary.completedWorkouts, locale)}
      />
      <Metric
        label="Total training time"
        value={
          <DurationValue
            seconds={data.summary.totalDurationSeconds}
            locale={locale}
          />
        }
      />
      <Metric
        label="Average workout duration"
        value={
          <DurationValue
            seconds={data.summary.averageDurationSeconds}
            locale={locale}
          />
        }
      />
    </dl>
  );
}
export function TrainingDurationBars({
  data,
  metric,
  locale,
}: {
  data: WeeklyDuration;
  metric: DurationMetric;
  locale?: string;
}) {
  const option = durationMetrics.find((m) => m.key === metric)!;
  return (
    <WeeklyBars
      rows={data.buckets.map((bucket) => ({
        weekStart: bucket.weekStart,
        value: bucket[metric],
      }))}
      label={option.label}
      formatValue={(value) =>
        value === null
          ? '—'
          : `${formatDuration(value, locale)} (${formatNumber(value, locale, 3)} s)`
      }
      empty="No completed workout durations in this range."
    />
  );
}
