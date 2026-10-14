'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { Section } from '../dashboard/dashboard.ui';
import { canonicalBrowserTimezone, getLocalDate } from '../dashboard/calendar';
import { inputClass, WorkoutLoading } from '../workout/workout.ui';
import { useProgressRead } from './progress-read';
import { selectorQuery } from './progress-query';
import { ProgressSelector } from './progress-selector';
import { durationMetrics, trainingMetrics } from './training.types';
import {
  normalizeTrainingRange,
  trainingProgressUrl,
  trainingRangeQueries,
  trainingUrlState,
  trainingReturnPath,
} from './training-query';
import {
  TrainingWeekForm,
  TrainingReadState,
  TrainingTrendsContent,
  TrainingConsistencyContent,
  TrainingDurationSummary,
  TrainingDurationBars,
} from './training-content';

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

export function TrainingProgressOverview() {
  const router = useRouter(),
    params = useSearchParams(),
    search = new URLSearchParams(params.toString());
  const context = useSyncExternalStore<string | null>(
      subscribeCalendar,
      browserCalendar,
      serverCalendar,
    ),
    [localDate, timezone] = context?.split('|') ?? [];
  const range =
      localDate && timezone
        ? normalizeTrainingRange(search, localDate, timezone)
        : undefined,
    queries = range && timezone ? trainingRangeQueries(range, timezone) : null,
    state = trainingUrlState(search),
    selector = selectorQuery(search),
    destination = range
      ? trainingProgressUrl({ ...state, range, selector })
      : null,
    key = queries ? JSON.stringify(queries.trends) : null;
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.kind === 'unauthorized')
      router.replace(
        '/login?' +
          new URLSearchParams({
            returnTo: trainingReturnPath(
              new URLSearchParams(window.location.search),
            ),
          }),
      );
  };
  // Independent effects start these reads in parallel. Keys contain only request
  // inputs, never visual metric or catalog search/page state.
  const trends = useProgressRead(
      key,
      (signal) =>
        queries
          ? apiClient.getWeeklyTraining(queries.trends, signal)
          : Promise.reject(new ApiError('configuration')),
      onError,
    ),
    consistency = useProgressRead(
      key,
      (signal) =>
        queries
          ? apiClient.getWeeklyConsistency(queries.consistency, signal)
          : Promise.reject(new ApiError('configuration')),
      onError,
    ),
    duration = useProgressRead(
      key,
      (signal) =>
        queries
          ? apiClient.getWeeklyDuration(queries.duration, signal)
          : Promise.reject(new ApiError('configuration')),
      onError,
    );
  useEffect(() => {
    if (
      destination &&
      '/progress' + (params.size ? '?' + params : '') !== destination
    )
      router.replace(destination, { scroll: false });
  }, [destination, params, router]);
  const locale = context ? navigator.language : undefined;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="progress" />
      <main
        id="main-content"
        className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
            Historical training · canonical units
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Training progress
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Review your training across a shared local-week range, then explore
            an individual exercise.
          </p>
        </div>
        <Section
          id="training-range"
          title="Selected weeks"
          description={
            'Local calendar · ' + (timezone ?? 'preparing browser timezone')
          }
        >
          {range && timezone ? (
            <TrainingWeekForm
              key={range.fromWeekStart + range.toWeekStart + timezone}
              range={range}
              timezone={timezone}
              onApply={(value) =>
                router.push(
                  trainingProgressUrl({ ...state, range: value, selector }),
                  { scroll: false },
                )
              }
            />
          ) : (
            <WorkoutLoading label="Preparing local weeks..." />
          )}
          {range && !queries && (
            <p role="alert" className="mt-4">
              The local midnight boundaries cannot be represented. Choose
              another range.
            </p>
          )}
        </Section>
        <Section
          id="training-trends"
          title="Weekly training trends"
          description="Selected range · COMPLETED workouts, including zero-set sessions. Only weeks returned by the backend are shown."
        >
          <label htmlFor="training-metric" className="text-sm font-medium">
            Training metric
          </label>
          <select
            id="training-metric"
            name="trainingMetric"
            className={inputClass + ' mb-5'}
            value={state.trainingMetric}
            disabled={!range}
            onChange={(event) => {
              const metric = trainingMetrics.find(
                (m) => m.key === event.target.value,
              )?.key;
              if (metric && range)
                router.push(
                  trainingProgressUrl({
                    ...state,
                    range,
                    selector,
                    trainingMetric: metric,
                  }),
                  { scroll: false },
                );
            }}
          >
            {trainingMetrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.unit === 'kg' ? ' (kg)' : ''}
              </option>
            ))}
          </select>
          <TrainingReadState resource={trends} title="Training trends">
            {(data) => (
              <TrainingTrendsContent
                data={data}
                metric={state.trainingMetric}
                locale={locale}
              />
            )}
          </TrainingReadState>
        </Section>
        <Section
          id="training-consistency"
          title="Training consistency"
          description="Selected range · Calendar weeks include inactive weeks. All activity and streak values come from TrainingConsistency."
        >
          <TrainingReadState
            resource={consistency}
            title="Training consistency"
          >
            {(data) => (
              <TrainingConsistencyContent data={data} locale={locale} />
            )}
          </TrainingReadState>
        </Section>
        <Section
          id="training-duration"
          title="Workout duration"
          description="Selected range · Whole sessions are grouped by their local start week; time is not split across days or weeks."
        >
          <TrainingReadState resource={duration} title="Workout duration">
            {(data) => <TrainingDurationSummary data={data} locale={locale} />}
          </TrainingReadState>
          <label htmlFor="duration-metric" className="text-sm font-medium">
            Duration metric
          </label>
          <select
            id="duration-metric"
            name="durationMetric"
            className={inputClass + ' mb-5'}
            value={state.durationMetric}
            disabled={!range}
            onChange={(event) => {
              const metric = durationMetrics.find(
                (m) => m.key === event.target.value,
              )?.key;
              if (metric && range)
                router.push(
                  trainingProgressUrl({
                    ...state,
                    range,
                    selector,
                    durationMetric: metric,
                  }),
                  { scroll: false },
                );
            }}
          >
            {durationMetrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          {duration.data && (
            <TrainingDurationBars
              data={duration.data}
              metric={state.durationMetric}
              locale={locale}
            />
          )}
          <p className="mt-4 text-xs text-slate-500">
            Sparse buckets stay in backend order. Bar scales are presentation
            only; exact seconds and backend averages remain visible.
          </p>
        </Section>
        <Section
          id="training-exercises"
          title="Exercise progress"
          description="Exercise selection is independent of the weekly training range."
        >
          <ProgressSelector />
        </Section>
      </main>
    </div>
  );
}
