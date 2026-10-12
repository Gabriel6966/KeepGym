'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import { ExerciseBlock } from './exercise-block';
import {
  applyServerSet,
  createSubmissionLock,
  mutationMessage,
} from './workout-state';
import type { SetEntryInput, WorkoutSession } from './workout.types';
import { WorkoutError, WorkoutLoading } from './workout.ui';

interface SessionActions {
  add: (exerciseId: string, input: SetEntryInput) => Promise<boolean>;
  update: (
    exerciseId: string,
    setId: string,
    input: SetEntryInput,
  ) => Promise<boolean>;
  remove: (exerciseId: string, setId: string) => Promise<boolean>;
  finish: (status: 'COMPLETED' | 'CANCELLED') => void;
}
export function WorkoutSessionContent({
  session,
  busy,
  blocked = false,
  error,
  actions,
}: {
  session: WorkoutSession;
  busy: string | null;
  blocked?: boolean;
  error: string | null;
  actions: SessionActions;
}) {
  // Keep an in-progress draft mounted after an ambiguous network failure, but
  // disable all writes until a fresh backend read reconciles the session.
  const editable = session.status === 'IN_PROGRESS';
  const started = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(session.startedAt));
  return (
    <>
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Workout session
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {session.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            role="status"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
          >
            {session.status}
          </span>
          <time dateTime={session.startedAt} className="text-sm text-slate-500">
            Started {started}
          </time>
        </div>
        {session.notes && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
            {session.notes}
          </p>
        )}
      </div>
      {!editable && !blocked && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-medium">
            {session.status === 'COMPLETED'
              ? 'Workout completed.'
              : 'Workout cancelled.'}{' '}
            This session is read-only.
          </p>
          <Link href="/dashboard" className={buttonClass + ' mt-4'}>
            Open Dashboard
          </Link>
        </div>
      )}
      {blocked && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-slate-200 bg-white p-4 text-sm"
        >
          Reload the workout before making more changes.
        </p>
      )}
      <section aria-labelledby="session-exercises">
        <h2 id="session-exercises" className="mb-4 text-lg font-semibold">
          Exercises
        </h2>
        <div className="space-y-5">
          {session.exercises.map((exercise) => (
            <ExerciseBlock
              key={exercise.id}
              exercise={exercise}
              editable={editable}
              busy={busy !== null || blocked}
              onAdd={(input) => actions.add(exercise.id, input)}
              onUpdate={(setId, input) =>
                actions.update(exercise.id, setId, input)
              }
              onDelete={(setId) => actions.remove(exercise.id, setId)}
            />
          ))}
        </div>
      </section>
      {editable && (
        <section
          aria-label="Finish workout"
          className="mt-7 rounded-xl border border-slate-200 bg-white p-5"
        >
          <p className="mb-4 text-sm text-slate-500">
            Finishing is permanent. Completed and cancelled sessions cannot be
            edited.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={
                buttonClass +
                ' border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
              }
              disabled={busy !== null || blocked}
              onClick={() => actions.finish('COMPLETED')}
            >
              {busy === 'COMPLETED' ? 'Completing...' : 'Complete workout'}
            </button>
            <button
              type="button"
              className={buttonClass + ' text-red-800'}
              disabled={busy !== null || blocked}
              onClick={() => actions.finish('CANCELLED')}
            >
              {busy === 'CANCELLED' ? 'Cancelling...' : 'Cancel workout'}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-sm text-slate-700">
              {error}
            </p>
          )}
        </section>
      )}
      <div className="mt-6">
        <Link href="/workout" className={buttonClass}>
          Workout templates
        </Link>
      </div>
    </>
  );
}
export function WorkoutSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<{
    key: number;
    session: WorkoutSession;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: number;
    status?: number;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [blocked, setBlocked] = useState(false);
  const lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  function login() {
    router.replace(
      '/login?' +
        new URLSearchParams({
          returnTo: '/workout/' + encodeURIComponent(sessionId),
        }),
    );
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void apiClient
      .getWorkoutSession(sessionId, controller.signal)
      .then((session) => {
        if (!controller.signal.aborted) {
          setResource({ key: retry, session });
          setBlocked(false);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' +
              new URLSearchParams({
                returnTo: '/workout/' + encodeURIComponent(sessionId),
              }),
          );
        else
          setFailure({
            key: retry,
            status: error instanceof ApiError ? error.status : undefined,
          });
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [sessionId, retry, router]);
  const session = resource?.key === retry ? resource.session : null;
  async function mutate(
    label: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    if (blocked || session?.status !== 'IN_PROGRESS' || !lock.current.acquire())
      return false;
    setBusy(label);
    try {
      await operation();
      return true;
    } catch (error: unknown) {
      if (mounted.current && error instanceof ApiError) {
        if (error.kind === 'unauthorized') login();
        if (error.kind === 'network') setBlocked(true);
        if (error.status === 409) {
          // A second tab may have finished the session. Reconcile, never reopen it.
          try {
            const fresh = await apiClient.getWorkoutSession(sessionId);
            if (mounted.current) setResource({ key: retry, session: fresh });
          } catch {
            if (mounted.current) setBlocked(true);
          }
        }
      }
      throw error;
    } finally {
      lock.current.release();
      if (mounted.current) setBusy(null);
    }
  }
  const actions: SessionActions = {
    add: (exerciseId, input) =>
      mutate('add:' + exerciseId, async () => {
        const set = await apiClient.addSet(sessionId, exerciseId, input);
        if (mounted.current)
          setResource((current) =>
            current
              ? {
                  ...current,
                  session: applyServerSet(current.session, exerciseId, set),
                }
              : current,
          );
      }),
    update: (exerciseId, setId, input) =>
      mutate('edit:' + setId, async () => {
        const set = await apiClient.updateSet(
          sessionId,
          exerciseId,
          setId,
          input,
        );
        if (mounted.current)
          setResource((current) =>
            current
              ? {
                  ...current,
                  session: applyServerSet(current.session, exerciseId, set),
                }
              : current,
          );
      }),
    remove: (exerciseId, setId) =>
      mutate('delete:' + setId, async () => {
        await apiClient.deleteSet(sessionId, exerciseId, setId);
        try {
          const fresh = await apiClient.getWorkoutSession(sessionId);
          if (mounted.current) setResource({ key: retry, session: fresh });
        } catch (error: unknown) {
          if (mounted.current) {
            setBlocked(true);
            setError(
              'The set was deleted, but the session could not be reloaded.',
            );
          }
          throw error;
        }
      }),
    finish: (status) => {
      if (
        busy !== null ||
        blocked ||
        !window.confirm(
          status === 'COMPLETED'
            ? 'Complete this workout? You will not be able to change its sets.'
            : 'Cancel this workout? It will remain in history but will not count as completed activity.',
        )
      )
        return;
      setError(null);
      void mutate(status, async () => {
        const fresh =
          status === 'COMPLETED'
            ? await apiClient.completeWorkout(sessionId)
            : await apiClient.cancelWorkout(sessionId);
        if (mounted.current) setResource({ key: retry, session: fresh });
      }).catch((error: unknown) => {
        if (mounted.current) setError(mutationMessage(error));
      });
    },
  };
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="workout" />
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {!session && (
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">
            Workout session
          </h1>
        )}
        {session ? (
          <>
            <WorkoutSessionContent
              session={session}
              busy={busy}
              blocked={blocked}
              error={error}
              actions={actions}
            />
            {blocked && (
              <button
                type="button"
                className={buttonClass + ' mt-4'}
                disabled={busy !== null}
                onClick={() => setRetry((value) => value + 1)}
              >
                Reload workout
              </button>
            )}
          </>
        ) : failure?.key === retry ? (
          <WorkoutError
            title="Workout unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          >
            {failure.status === 404 || failure.status === 400
              ? 'This workout is unavailable. Check the link or return to Workout.'
              : undefined}
          </WorkoutError>
        ) : (
          <WorkoutLoading />
        )}
      </main>
    </div>
  );
}
