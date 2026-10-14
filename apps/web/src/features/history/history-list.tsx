'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import {
  WorkoutError,
  WorkoutLoading,
  inputClass,
} from '../workout/workout.ui';
import { HistoryCards } from './history-content';
import { CalendarViewLink } from './calendar-content';
import {
  filterDraft,
  hasHistoryFilters,
  historyPageSize,
  historyUrl,
  normalizeHistoryUrl,
  validateHistoryFilters,
  type HistoryFilterDraft,
} from './history-query';
import type { WorkoutHistoryPage, WorkoutHistoryQuery } from './history.types';

export function HistoryFilters({
  query,
  onApply,
}: {
  query: WorkoutHistoryQuery;
  onApply: (query: WorkoutHistoryQuery) => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState(() => filterDraft(query)),
    [errors, setErrors] = useState<
      Partial<Record<keyof HistoryFilterDraft, string>>
    >({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateHistoryFilters(draft);
    if (result.errors) setErrors(result.errors);
    else {
      setErrors({});
      onApply(result.query);
    }
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="History filters"
      className="mb-7 space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={prefix + '-q'} className="text-sm font-medium">
            Search workout names
          </label>
          <input
            id={prefix + '-q'}
            name="q"
            type="search"
            value={draft.q}
            onChange={(event) =>
              setDraft((current) => ({ ...current, q: event.target.value }))
            }
            className={inputClass}
            aria-invalid={!!errors.q}
            aria-describedby={errors.q ? prefix + '-q-error' : undefined}
          />
          {errors.q && (
            <p id={prefix + '-q-error'} className="mt-1 text-sm text-red-800">
              {errors.q}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <label htmlFor={prefix + '-status'} className="text-sm font-medium">
            Status
          </label>
          <select
            id={prefix + '-status'}
            name="status"
            value={draft.status}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
            className={inputClass}
          >
            <option value="">All terminal workouts</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        {(['from', 'to'] as const).map((field) => (
          <div key={field} className="min-w-0">
            <label
              htmlFor={prefix + '-' + field}
              className="text-sm font-medium"
            >
              {field === 'from'
                ? 'From started at (inclusive)'
                : 'To started at (inclusive)'}
            </label>
            <input
              id={prefix + '-' + field}
              name={field}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="2026-10-01T00:00:00+02:00"
              value={draft[field]}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
              aria-invalid={!!errors[field]}
              aria-describedby={
                prefix +
                '-timestamps' +
                (errors[field] ? ' ' + prefix + '-' + field + '-error' : '')
              }
              className={inputClass}
            />
            {errors[field] && (
              <p
                id={prefix + '-' + field + '-error'}
                className="mt-1 text-sm text-red-800"
              >
                {errors[field]}
              </p>
            )}
          </div>
        ))}
      </div>
      <p
        id={prefix + '-timestamps'}
        className="text-xs leading-5 text-slate-500"
      >
        Optional RFC3339 timestamps with Z or an explicit offset, up to
        millisecond precision. Both boundaries apply to the historical workout
        start, inclusively. Displayed dates use your browser timezone.
      </p>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          Check the highlighted filters.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass}>
          Apply filters
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setDraft(filterDraft({}));
            setErrors({});
            onApply({ page: 1, limit: historyPageSize });
          }}
        >
          Clear filters
        </button>
      </div>
    </form>
  );
}
export function HistoryPagination({
  data,
  onPage,
}: {
  data: WorkoutHistoryPage;
  onPage: (page: number) => void;
}) {
  return data.totalPages > 1 || data.page > 1 ? (
    <nav
      aria-label="Workout history pages"
      className="mt-6 flex flex-wrap items-center justify-between gap-3"
    >
      <button
        type="button"
        className={buttonClass}
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        Previous workouts
      </button>
      <span className="text-sm text-slate-500">
        Page {data.page} · {data.totalPages} total pages
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={data.page >= data.totalPages}
        onClick={() => onPage(data.page + 1)}
      >
        Next workouts
      </button>
    </nav>
  ) : null;
}
export function HistoryList() {
  const router = useRouter(),
    params = useSearchParams();
  const raw = params.toString(),
    query = normalizeHistoryUrl(new URLSearchParams(raw)),
    canonical = historyUrl(query);
  const { page = 1, status, q, from, to } = query;
  const [retry, setRetry] = useState(0),
    [result, setResult] = useState<{
      key: string;
      data: WorkoutHistoryPage;
    } | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const key = canonical + '|' + retry;
  useEffect(() => {
    const canonicalQuery = canonical.split('?')[1] ?? '';
    if (raw !== canonicalQuery) router.replace(canonical, { scroll: false });
  }, [raw, canonical, router]);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .listWorkoutHistory(
        { page, limit: historyPageSize, status, q, from, to },
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: canonical }),
          );
        else setFailure(key);
      });
    return () => controller.abort();
  }, [page, status, q, from, to, key, canonical, router]);
  function navigate(next: WorkoutHistoryQuery) {
    router.push(historyUrl(next), { scroll: false });
  }
  const data = result?.key === key ? result.data : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="history" />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <div className="mt-4">
          <CalendarViewLink />
        </div>
        <p className="mb-6 mt-2 text-sm text-slate-500">
          Completed and cancelled workouts, preserved as historical snapshots.
        </p>
        <HistoryFilters key={canonical} query={query} onApply={navigate} />
        {data ? (
          <>
            <HistoryCards
              items={data.items}
              filtered={hasHistoryFilters(query)}
            />
            <HistoryPagination
              data={data}
              onPage={(page) => navigate({ ...query, page })}
            />
          </>
        ) : failure === key ? (
          <WorkoutError
            title="History unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          <WorkoutLoading label="Loading workout history..." />
        )}
      </main>
    </div>
  );
}
