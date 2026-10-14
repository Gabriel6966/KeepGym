'use client';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { Section, buttonClass } from '../dashboard/dashboard.ui';
import { canonicalBrowserTimezone, getLocalDate } from '../dashboard/calendar';
import { muscleGroupValues } from '../dashboard/dashboard.types';
import { inputClass, WorkoutLoading } from '../workout/workout.ui';
import { useProgressRead } from './progress-read';
import { TrainingReadState, TrainingWeekForm } from './training-content';
import { trainingMetrics } from './training.types';
import {
  muscleProgressUrl,
  muscleUrlState,
  muscleWeekQuery,
  normalizeMuscleRange,
} from './muscle-query';
import { MuscleWeeksContent } from './muscle-content';

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

export function MuscleGroupProgress() {
  const router = useRouter(),
    params = useSearchParams(),
    search = new URLSearchParams(params.toString());
  const context = useSyncExternalStore<string | null>(
      subscribeCalendar,
      browserCalendar,
      serverCalendar,
    ),
    [localDate, timezone] = context?.split('|') ?? [];
  const state = muscleUrlState(search),
    range =
      localDate && timezone
        ? normalizeMuscleRange(search, localDate, timezone)
        : undefined,
    query = range && timezone ? muscleWeekQuery(range, timezone) : null,
    destination = range ? muscleProgressUrl({ ...state, range }) : null;
  const resource = useProgressRead(
    query ? JSON.stringify(query) : null,
    (signal) =>
      query
        ? apiClient.getMuscleGroupWeeklyTrends(query, signal)
        : Promise.reject(new ApiError('configuration')),
    (error) => {
      if (error instanceof ApiError && error.kind === 'unauthorized')
        router.replace(
          '/login?' +
            new URLSearchParams({
              returnTo: muscleProgressUrl(
                muscleUrlState(new URLSearchParams(window.location.search)),
              ),
            }),
        );
    },
  );
  useEffect(() => {
    if (
      destination &&
      '/progress/muscle-groups' + (params.size ? '?' + params : '') !==
        destination
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
            Historical activity · canonical kg
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Muscle group progress
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            COMPLETED sessions with recorded sets, attributed only to the
            historical primary muscle snapshot. Secondary muscles do not
            contribute.
          </p>
        </div>
        <Section
          id="muscle-range"
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
              validateRange={(value, zone) =>
                muscleWeekQuery(value, zone) !== null
              }
              helpText="Both Mondays are included. The whole final local week is covered."
              errorText="Choose real Mondays in order, with representable local midnights and at most 730 elapsed days."
              onApply={(value) =>
                router.push(muscleProgressUrl({ ...state, range: value }), {
                  scroll: false,
                })
              }
            />
          ) : (
            <WorkoutLoading label="Preparing local weeks..." />
          )}
          {range && !query && (
            <p role="alert" className="mt-4">
              The local midnight boundaries cannot be represented. Choose
              another range.
            </p>
          )}
        </Section>
        <Section
          id="muscle-activity"
          title="Weekly muscle-group activity"
          description="Sparse weeks and groups retain backend order. No range totals or distribution percentages are calculated."
        >
          <div className="mb-5 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="muscle-metric" className="text-sm font-medium">
                Metric
              </label>
              <select
                id="muscle-metric"
                name="metric"
                className={inputClass}
                value={state.metric}
                disabled={!range}
                onChange={(event) => {
                  const metric = trainingMetrics.find(
                    (m) => m.key === event.target.value,
                  )?.key;
                  if (metric && range)
                    router.push(
                      muscleProgressUrl({ ...state, range, metric }),
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
            </div>
            <div className="min-w-0">
              <label htmlFor="muscle-filter" className="text-sm font-medium">
                Muscle group
              </label>
              <select
                id="muscle-filter"
                name="muscleGroup"
                className={inputClass}
                value={state.muscleGroup}
                disabled={!range}
                onChange={(event) => {
                  const muscleGroup =
                    muscleGroupValues.find(
                      (group) => group === event.target.value,
                    ) ?? 'ALL';
                  if (range)
                    router.push(
                      muscleProgressUrl({ ...state, range, muscleGroup }),
                      { scroll: false },
                    );
                }}
              >
                <option value="ALL">All muscle groups</option>
                {muscleGroupValues.map((group) => (
                  <option key={group} value={group}>
                    {group.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mb-5 text-xs text-slate-500">
            Bar widths use a separate scale for the visible groups in each week.
            They are presentation only, not shares of training. Zero volume
            remains recorded activity.
          </p>
          {query ? (
            <TrainingReadState
              resource={resource}
              title="Muscle-group activity"
            >
              {(data) => (
                <MuscleWeeksContent
                  data={data}
                  metric={state.metric}
                  muscleGroup={state.muscleGroup}
                  locale={locale}
                />
              )}
            </TrainingReadState>
          ) : (
            <WorkoutLoading label="Preparing muscle-group activity..." />
          )}
        </Section>
        <Link href="/progress" className={buttonClass}>
          Back to Progress
        </Link>
      </main>
    </div>
  );
}
