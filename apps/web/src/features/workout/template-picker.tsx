'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass, EmptyState } from '../dashboard/dashboard.ui';
import { createSubmissionLock, mutationMessage } from './workout-state';
import type {
  ResourcePage,
  WorkoutSessionSummary,
  WorkoutTemplate,
} from './workout.types';
import { WorkoutError, WorkoutLoading } from './workout.ui';

export function TemplateChoices({
  items,
  pendingId,
  error,
  onStart,
}: {
  items: WorkoutTemplate[];
  pendingId: string | null;
  error: string | null;
  onStart: (template: WorkoutTemplate) => void;
}) {
  const usable = items.filter((item) => item.exercises.length > 0);
  return (
    <>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm"
        >
          {error}
        </p>
      )}
      {usable.length === 0 ? (
        <EmptyState>
          {items.length > 0
            ? 'No usable templates on this page. Empty templates cannot be started.'
            : 'No workout templates yet.'}{' '}
          Template management will be available in its own section.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {usable.map((template) => (
            <li
              key={template.id}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
                {template.name}
              </h2>
              {template.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
                  {template.description}
                </p>
              )}
              <p className="mt-3 text-sm text-slate-500">
                {template.exercises.length} planned exercises
              </p>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={() => onStart(template)}
                className={buttonClass + ' mt-5 w-full'}
                aria-label={'Start ' + template.name}
              >
                {pendingId === template.id ? 'Starting...' : 'Start workout'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
export function TemplatePicker() {
  const router = useRouter();
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<{
    key: string;
    templates: ResourcePage<WorkoutTemplate>;
    active: WorkoutSessionSummary[];
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  const key = `${page}|${retry}`;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void Promise.all([
      apiClient.listWorkoutTemplates(page, controller.signal),
      apiClient.listInProgressWorkouts(controller.signal),
    ])
      .then(([templates, active]) => {
        if (!controller.signal.aborted)
          setResource({ key, templates, active: active.items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/workout' }),
          );
        else setFailure(key);
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [page, key, router]);
  async function start(template: WorkoutTemplate) {
    if (!lock.current.acquire()) return;
    setPendingId(template.id);
    setError(null);
    try {
      const session = await apiClient.startWorkout(template.id);
      if (mounted.current)
        router.push('/workout/' + encodeURIComponent(session.id));
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/workout' }),
          );
        else setError(mutationMessage(error));
      }
    } finally {
      lock.current.release();
      if (mounted.current) setPendingId(null);
    }
  }
  const ready = resource?.key === key ? resource : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="workout" />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Workout</h1>
        <p className="mt-2 mb-7 text-sm leading-6 text-slate-500">
          Choose an existing template to start logging. Planning is copied by
          the backend into a historical session.
        </p>
        {failure === key && !ready ? (
          <WorkoutError
            title="Templates unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : !ready ? (
          <WorkoutLoading label="Loading workout templates..." />
        ) : (
          <>
            {ready.active.length > 0 && (
              <section
                aria-labelledby="resume-workouts"
                className="mb-8 rounded-xl border border-slate-200 bg-white p-5"
              >
                <h2 id="resume-workouts" className="font-semibold">
                  Resume a workout
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Up to 20 recent in-progress sessions. Starting another does
                  not close these.
                </p>
                <ul className="mt-3 space-y-2">
                  {ready.active.map((session) => (
                    <li key={session.id}>
                      <Link
                        className={
                          buttonClass + ' w-full justify-between gap-3'
                        }
                        href={'/workout/' + encodeURIComponent(session.id)}
                      >
                        <span className="min-w-0 text-left [overflow-wrap:anywhere]">
                          {session.name}
                        </span>
                        <span>Resume</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <TemplateChoices
              items={ready.templates.items}
              pendingId={pendingId}
              error={error}
              onStart={(template) => void start(template)}
            />
            {ready.templates.totalPages > 1 && (
              <nav
                aria-label="Template pages"
                className="mt-6 flex flex-wrap items-center justify-between gap-3"
              >
                <button
                  type="button"
                  className={buttonClass}
                  disabled={page === 1 || pendingId !== null}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous templates
                </button>
                <span className="text-sm text-slate-500">
                  Page {ready.templates.page} of {ready.templates.totalPages}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={
                    page >= ready.templates.totalPages || pendingId !== null
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next templates
                </button>
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
}
