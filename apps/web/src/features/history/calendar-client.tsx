'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { canonicalBrowserTimezone, getLocalDate } from '../dashboard/calendar';
import { buttonClass } from '../dashboard/dashboard.ui';
import { AppHeader } from '../navigation/app-header';
import { useProgressRead } from '../progress/progress-read';
import { WorkoutError } from '../workout/workout.ui';
import {
  CalendarDays,
  CalendarLoading,
  CalendarMonthControls,
  SelectedCalendarDay,
} from './calendar-content';
import {
  calendarMonthFromUrl,
  calendarUrl,
  monthBoundaries,
} from './calendar-month';
import type { TrainingCalendar } from './calendar.types';

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
function LoadedCalendar({
  data,
  today,
  locale,
}: {
  data: TrainingCalendar;
  today: string;
  locale?: string;
}) {
  const [selected, select] = useState(
    data.days.find((day) => day.date === today)?.date ?? data.fromDate,
  );
  const day = data.days.find((day) => day.date === selected);
  return (
    <>
      <CalendarDays
        data={data}
        today={today}
        selected={selected}
        onSelect={select}
        locale={locale}
      />
      {day && <SelectedCalendarDay day={day} locale={locale} />}
    </>
  );
}
export function HistoryCalendar() {
  const router = useRouter(),
    params = useSearchParams();
  const context = useSyncExternalStore<string | null>(
      subscribeCalendar,
      browserCalendar,
      serverCalendar,
    ),
    [today, timezone] = context?.split('|') ?? [],
    month = today
      ? (calendarMonthFromUrl(new URLSearchParams(params.toString())) ??
        today.slice(0, 7))
      : null,
    query = month && timezone ? { ...monthBoundaries(month), timezone } : null,
    destination = month ? calendarUrl(month) : null;
  const resource = useProgressRead(
    query ? JSON.stringify(query) : null,
    (signal) =>
      query
        ? apiClient.getTrainingCalendar(query, signal)
        : Promise.reject(new ApiError('configuration')),
    (error) => {
      if (error instanceof ApiError && error.kind === 'unauthorized')
        router.replace(
          '/login?' +
            new URLSearchParams({
              returnTo: calendarUrl(
                calendarMonthFromUrl(
                  new URLSearchParams(window.location.search),
                ),
              ),
            }),
        );
    },
  );
  useEffect(() => {
    if (
      destination &&
      '/history/calendar' + (params.size ? '?' + params : '') !== destination
    )
      router.replace(destination, { scroll: false });
  }, [destination, params, router]);
  const locale = context ? navigator.language : undefined;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="history" />
      <main
        id="main-content"
        className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Training calendar
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Completed workouts by their local start date, including workouts
              without sets. Sessions that cross midnight stay on their start
              date.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Timezone: {timezone ?? 'preparing browser timezone'}
            </p>
          </div>
          <Link href="/history" className={buttonClass}>
            List view
          </Link>
        </div>
        {month && today && (
          <CalendarMonthControls
            month={month}
            currentMonth={today.slice(0, 7)}
            locale={locale}
            onMonth={(value) =>
              router.push(calendarUrl(value), { scroll: false })
            }
          />
        )}
        {resource.failed ? (
          <WorkoutError
            title="Training calendar unavailable"
            onRetry={resource.retry}
          />
        ) : resource.data && today ? (
          <LoadedCalendar
            key={JSON.stringify(query)}
            data={resource.data}
            today={today}
            locale={locale}
          />
        ) : (
          <CalendarLoading />
        )}
      </main>
    </div>
  );
}
