'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { apiClient, ApiError } from '../../lib/api-client';
import {
  addCalendarDaysToDateOnly,
  canonicalBrowserTimezone,
  getLocalDate,
  getLocalMondayDate,
  resolveWeekStart,
  isDashboardWeek,
} from './calendar';
import { formatWeekRange } from './format';
import type { DashboardSummary } from './dashboard.types';
import { DashboardContent } from './dashboard-content';
import { buttonClass, DashboardError, DashboardSkeleton } from './dashboard.ui';
import { AppHeader } from '../navigation/app-header';

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
type LoadState =
  | { key: string; kind: 'success'; data: DashboardSummary }
  | { key: string; kind: 'error' }
  | null;

export function DashboardClient() {
  const router = useRouter(),
    params = useSearchParams();
  // Server HTML and the initial hydration both show the same skeleton. Browser
  // calendar context is a small external snapshot, not a server timezone guess.
  const calendar = useSyncExternalStore<string | null>(
    subscribeCalendar,
    browserCalendar,
    serverCalendar,
  );
  const [localDate, timezone] = calendar?.split('|') ?? [];
  const weekStart = localDate
    ? resolveWeekStart(params.get('weekStart'), localDate)
    : null;
  const currentWeek = localDate ? getLocalMondayDate(localDate) : null;
  const locale = calendar ? navigator.language : undefined;
  const [result, setResult] = useState<LoadState>(null),
    [retry, setRetry] = useState(0);
  const key = `${weekStart}|${timezone}|${retry}`;
  useEffect(() => {
    if (!weekStart || !timezone) return;
    const controller = new AbortController();
    void apiClient
      .getDashboard(weekStart, timezone, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ key, kind: 'success', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized') {
          const returnTo = '/dashboard?' + new URLSearchParams({ weekStart });
          router.replace('/login?' + new URLSearchParams({ returnTo }));
        } else setResult({ key, kind: 'error' });
      });
    return () => controller.abort();
  }, [weekStart, timezone, key, router]);
  function navigate(value: string) {
    router.push('/dashboard?' + new URLSearchParams({ weekStart: value }), {
      scroll: false,
    });
  }
  const previous = weekStart ? addCalendarDaysToDateOnly(weekStart, -7) : null;
  const next = weekStart ? addCalendarDaysToDateOnly(weekStart, 7) : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="dashboard" />
      <main
        id="main-content"
        className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
      >
        <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
              Training overview
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Your training, described by the data.
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">
              Selected week{timezone ? ' · ' + timezone : ''}
            </p>
            <p className="mt-1 min-h-6 font-medium" aria-live="polite">
              {weekStart
                ? formatWeekRange(weekStart, locale)
                : 'Preparing your local week...'}
            </p>
            <div
              className="mt-3 flex flex-wrap gap-2"
              aria-label="Week navigation"
            >
              <button
                type="button"
                className={buttonClass}
                disabled={!previous || !isDashboardWeek(previous)}
                onClick={() => previous && navigate(previous)}
              >
                Previous week
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!currentWeek}
                onClick={() => currentWeek && navigate(currentWeek)}
              >
                Current week
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!next || !isDashboardWeek(next)}
                onClick={() => next && navigate(next)}
              >
                Next week
              </button>
            </div>
          </div>
        </div>
        {result?.key === key ? (
          result.kind === 'success' ? (
            <DashboardContent summary={result.data} locale={locale} />
          ) : (
            <DashboardError onRetry={() => setRetry((value) => value + 1)} />
          )
        ) : (
          <DashboardSkeleton />
        )}
      </main>
    </div>
  );
}
