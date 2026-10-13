'use client';
import { useState, type FormEvent } from 'react';
import { DecorativeBar } from '../dashboard/dashboard-bars';
import { normalizeNonNegativeBars } from '../dashboard/visual-scale';
import { EmptyState, buttonClass } from '../dashboard/dashboard.ui';
import { formatKg, formatNumber } from '../dashboard/format';
import { parseDateOnly } from '../dashboard/calendar';
import { inputClass } from '../workout/workout.ui';
import { trendRange } from './progress-query';
import {
  trendMetrics,
  type DateRange,
  type ExerciseWeeklyTrends,
  type TrendMetric,
} from './progress.types';

export function ProgressRangeForm({
  range,
  timezone,
  onApply,
}: {
  range: DateRange;
  timezone: string;
  onApply: (range: DateRange) => void;
}) {
  const [draft, setDraft] = useState(range),
    [error, setError] = useState(false);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trendRange(draft, timezone)) {
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
      className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
    >
      <div className="min-w-0">
        <label htmlFor="progress-from" className="text-sm font-medium">
          From date
        </label>
        <input
          id="progress-from"
          name="fromDate"
          type="date"
          value={draft.fromDate}
          onChange={(event) =>
            setDraft({ ...draft, fromDate: event.target.value })
          }
          className={inputClass}
          aria-invalid={error}
          aria-describedby={error ? 'progress-range-error' : undefined}
        />
      </div>
      <div className="min-w-0">
        <label htmlFor="progress-to" className="text-sm font-medium">
          To date
        </label>
        <input
          id="progress-to"
          name="toDate"
          type="date"
          value={draft.toDate}
          onChange={(event) =>
            setDraft({ ...draft, toDate: event.target.value })
          }
          className={inputClass}
          aria-invalid={error}
          aria-describedby={error ? 'progress-range-error' : undefined}
        />
      </div>
      <button type="submit" className={buttonClass + ' self-end'}>
        Apply range
      </button>
      {error && (
        <p
          id="progress-range-error"
          role="alert"
          className="text-sm text-red-800 sm:col-span-3"
        >
          Use real dates in order, with representable local midnights and at
          most 730 elapsed days.
        </p>
      )}
    </form>
  );
}
export function ProgressWeeklyBars({
  trends,
  metric,
  locale,
}: {
  trends: ExerciseWeeklyTrends;
  metric: TrendMetric;
  locale?: string;
}) {
  if (trends.buckets.length === 0)
    return <EmptyState>No exercise activity in this range.</EmptyState>;
  const option = trendMetrics.find((option) => option.key === metric)!;
  const values = trends.buckets.flatMap((bucket) =>
      bucket[metric] === null ? [] : [bucket[metric]],
    ),
    widths = normalizeNonNegativeBars(values);
  let index = 0;
  return (
    <ol className="space-y-4">
      {trends.buckets.map((bucket) => {
        const value = bucket[metric],
          width = value === null ? undefined : widths[index++],
          date = parseDateOnly(bucket.weekStart);
        const label = date
          ? new Intl.DateTimeFormat(locale, {
              timeZone: 'UTC',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }).format(date)
          : bucket.weekStart;
        return (
          <li
            key={bucket.weekStart}
            data-progress-week={bucket.weekStart}
            className="min-w-0 rounded-lg border border-slate-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                Week of <time dateTime={bucket.weekStart}>{label}</time>
              </h3>
              <p className="min-w-0 text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">
                {option.label}:{' '}
                {option.unit === 'kg'
                  ? formatKg(value, locale)
                  : formatNumber(value, locale)}
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
