'use client';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { Section, buttonClass } from '../dashboard/dashboard.ui';
import {
  inputClass,
  WorkoutError,
  WorkoutLoading,
} from '../workout/workout.ui';
import { canonicalBrowserTimezone, getLocalDate } from '../dashboard/calendar';
import { useProgressRead, type ProgressRead } from './progress-read';
import {
  normalizeProgressRange,
  progressPage,
  performancePageSize,
  exerciseProgressUrl,
  selectedTrendMetric,
  trendRange,
} from './progress-query';
import {
  ProgressSummary,
  ProgressRecords,
  ProgressPerformances,
} from './progress-content';
import { ProgressRangeForm, ProgressWeeklyBars } from './progress-trends';
import { trendMetrics } from './progress.types';

function subscribeCalendar(callback: () => void) {
  window.addEventListener('focus', callback);
  return () => window.removeEventListener('focus', callback);
}
function browserCalendar() {
  const timezone = canonicalBrowserTimezone(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  return getLocalDate(new Date(), timezone) + '|' + timezone;
}
const serverCalendar = () => null;
function ReadState<T>({
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

export function ExerciseProgressDetail({ exerciseId }: { exerciseId: string }) {
  const router = useRouter(),
    params = useSearchParams(),
    context = useSyncExternalStore<string | null>(
      subscribeCalendar,
      browserCalendar,
      serverCalendar,
    ),
    [localDate, timezone] = context?.split('|') ?? [];
  const search = new URLSearchParams(params.toString()),
    range =
      localDate && timezone
        ? normalizeProgressRange(search, localDate, timezone)
        : null,
    query = range && timezone ? trendRange(range, timezone) : null;
  const performancePage = progressPage(
      search.getAll('performancePage').length === 1
        ? search.get('performancePage')
        : null,
    ),
    metric = selectedTrendMetric(search);
  const from = query?.from,
    to = query?.to;
  const loadAnalytics = (signal: AbortSignal) =>
    apiClient.getExerciseAnalytics(
      exerciseId,
      performancePage,
      performancePageSize,
      signal,
    );
  const loadRecords = (signal: AbortSignal) =>
    apiClient.getExerciseRecords(exerciseId, signal);
  const loadTrends = (signal: AbortSignal) => {
    if (!from || !to || !timezone)
      return Promise.reject(new ApiError('configuration'));
    return apiClient.getExerciseWeeklyTrends(
      exerciseId,
      { from, to, timezone },
      signal,
    );
  };
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.kind === 'unauthorized')
      router.replace(
        '/login?' +
          new URLSearchParams({
            returnTo: window.location.pathname + window.location.search,
          }),
      );
  };
  const analytics = useProgressRead(
      context ? JSON.stringify([exerciseId, performancePage]) : null,
      loadAnalytics,
      onError,
    ),
    records = useProgressRead(
      context ? exerciseId : null,
      loadRecords,
      onError,
    ),
    trends = useProgressRead(
      query ? JSON.stringify([exerciseId, from, to, timezone]) : null,
      loadTrends,
      onError,
    );
  const destination = range
    ? exerciseProgressUrl(exerciseId, range, performancePage, metric)
    : null;
  useEffect(() => {
    if (
      destination &&
      '/progress/exercises/' +
        encodeURIComponent(exerciseId) +
        (params.size ? '?' + params : '') !==
        destination
    )
      router.replace(destination, { scroll: false });
  }, [destination, exerciseId, params, router]);
  const metadata =
      analytics.data?.exercise ??
      records.data?.exercise ??
      trends.data?.exercise,
    locale = context ? navigator.language : undefined;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="progress" />
      <main
        id="main-content"
        className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
            Exercise progress · historical data
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {metadata?.name ?? 'Exercise progress'}
          </h1>
          {metadata && (
            <p className="mt-2 text-sm text-slate-500 [overflow-wrap:anywhere]">
              Snapshot: {metadata.slug}
            </p>
          )}
          <Link href="/progress" className={buttonClass + ' mt-4'}>
            Back to Progress
          </Link>
        </div>
        <Section
          id="progress-summary"
          title="Analytics summary"
          description="All time · COMPLETED occurrences, including occurrences without sets. No date filter applies here."
        >
          <ReadState resource={analytics} title="Analytics">
            {(data) =>
              timezone && (
                <ProgressSummary
                  analytics={data}
                  timezone={timezone}
                  locale={locale}
                />
              )
            }
          </ReadState>
        </Section>
        <Section
          id="progress-records"
          title="Current records"
          description="All time · first achievement of each current maximum, not a PR-event timeline."
        >
          <ReadState resource={records} title="Records">
            {(data) =>
              timezone && (
                <ProgressRecords
                  records={data}
                  timezone={timezone}
                  locale={locale}
                />
              )
            }
          </ReadState>
        </Section>
        <Section
          id="progress-weekly"
          title="Weekly exercise trends"
          description={
            'Selected local dates (inclusive) · ' +
            (timezone ?? 'preparing browser timezone') +
            ' · startedAt determines inclusion. Only buckets with recorded sets are returned.'
          }
        >
          {range && timezone ? (
            <>
              <ProgressRangeForm
                key={range.fromDate + range.toDate + timezone}
                range={range}
                timezone={timezone}
                onApply={(value) =>
                  router.push(
                    exerciseProgressUrl(
                      exerciseId,
                      value,
                      performancePage,
                      metric,
                    ),
                    { scroll: false },
                  )
                }
              />
              <div className="mb-5">
                <label
                  htmlFor="progress-metric"
                  className="text-sm font-medium"
                >
                  Weekly metric
                </label>
                <select
                  id="progress-metric"
                  name="metric"
                  className={inputClass}
                  value={metric}
                  onChange={(event) => {
                    const value = trendMetrics.find(
                      (option) => option.key === event.target.value,
                    )?.key;
                    if (value)
                      router.push(
                        exerciseProgressUrl(
                          exerciseId,
                          range,
                          performancePage,
                          value,
                        ),
                        { scroll: false },
                      );
                  }}
                >
                  {trendMetrics.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                      {option.unit === 'kg' ? ' (kg)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mb-4 text-xs text-slate-500">
                Sparse weeks are preserved in backend order. Bar widths are
                presentation only; each metric uses its own scale.
              </p>
              {query ? (
                <ReadState resource={trends} title="Weekly trends">
                  {(data) => (
                    <ProgressWeeklyBars
                      trends={data}
                      metric={metric}
                      locale={locale}
                    />
                  )}
                </ReadState>
              ) : (
                <p role="alert">
                  These local day boundaries cannot be represented. Choose
                  another range.
                </p>
              )}
            </>
          ) : (
            <WorkoutLoading label="Preparing local range..." />
          )}
        </Section>
        <Section
          id="progress-performances"
          title="Performance history"
          description="All time · paginated Analytics occurrences in backend order. Zero-set occurrences remain visible; this list is not filtered by the weekly range."
        >
          <ReadState resource={analytics} title="Performances">
            {(data) =>
              timezone && (
                <>
                  <ProgressPerformances
                    analytics={data}
                    timezone={timezone}
                    locale={locale}
                  />
                  <nav
                    aria-label="Performance pages"
                    className="mt-5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      disabled={performancePage <= 1}
                      className={buttonClass}
                      onClick={() =>
                        range &&
                        router.push(
                          exerciseProgressUrl(
                            exerciseId,
                            range,
                            performancePage - 1,
                            metric,
                          ),
                          { scroll: false },
                        )
                      }
                    >
                      Previous performances
                    </button>
                    <span>
                      Page {data.page} of {Math.max(1, data.totalPages)}
                    </span>
                    <button
                      type="button"
                      disabled={performancePage >= data.totalPages}
                      className={buttonClass}
                      onClick={() =>
                        range &&
                        router.push(
                          exerciseProgressUrl(
                            exerciseId,
                            range,
                            performancePage + 1,
                            metric,
                          ),
                          { scroll: false },
                        )
                      }
                    >
                      Next performances
                    </button>
                  </nav>
                </>
              )
            }
          </ReadState>
        </Section>
      </main>
    </div>
  );
}
