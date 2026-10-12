'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass, Metric } from '../dashboard/dashboard.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import type {
  TemplateExercise,
  WorkoutTemplate,
} from '../workout/workout.types';
import { TemplateMetadataForm, PlanningForm } from './template-forms';
import { ExercisePicker } from './exercise-picker';
import {
  ambiguousWrite,
  applyTemplateExercise,
  requestedMove,
  templateMutationMessage,
} from './templates.state';
import type {
  AddTemplateExerciseInput,
  PlanningInput,
  TemplateMetadataInput,
} from './templates.types';

interface TemplateActions {
  metadata: (input: TemplateMetadataInput) => Promise<boolean>;
  add: (input: AddTemplateExerciseInput) => Promise<boolean>;
  update: (entryId: string, input: PlanningInput) => Promise<boolean>;
  remove: (entryId: string) => Promise<boolean>;
  reorder: (ids: string[]) => Promise<boolean>;
  archive: () => void;
}
function TemplateExerciseCard({
  entry,
  first,
  last,
  disabled,
  actions,
}: {
  entry: TemplateExercise;
  first: boolean;
  last: boolean;
  disabled: boolean;
  actions: {
    update: (input: PlanningInput) => Promise<boolean>;
    remove: () => Promise<boolean>;
    move: (direction: -1 | 1) => Promise<boolean>;
  };
}) {
  const [editing, setEditing] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function act(operation: () => Promise<boolean>) {
    setError(null);
    try {
      await operation();
    } catch (error: unknown) {
      setError(templateMutationMessage(error));
    }
  }
  return (
    <li
      data-template-exercise-id={entry.id}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500">
            Exercise {entry.position}
          </p>
          <h3 className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">
            {entry.exercise.name}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {entry.exercise.primaryMuscle} ·{' '}
            {entry.exercise.equipment.replaceAll('_', ' ')}
          </p>
          {!entry.exercise.isAvailable && (
            <p className="mt-2 text-xs text-slate-600">
              Catalog reference is inactive; existing planning is retained.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || first}
            onClick={() => void act(() => actions.move(-1))}
            className={buttonClass}
            aria-label={'Move ' + entry.exercise.name + ' up'}
          >
            Move up
          </button>
          <button
            type="button"
            disabled={disabled || last}
            onClick={() => void act(() => actions.move(1))}
            className={buttonClass}
            aria-label={'Move ' + entry.exercise.name + ' down'}
          >
            Move down
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-4">
          <PlanningForm
            entry={entry}
            disabled={disabled}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              const saved = await actions.update(input);
              if (saved) setEditing(false);
              return saved;
            }}
          />
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Target sets" value={entry.targetSets} />
            <Metric
              label="Reps range"
              value={`${entry.targetRepsMin}–${entry.targetRepsMax}`}
            />
            <Metric label="Rest" value={entry.restSeconds + 's'} />
            <Metric label="Position" value={entry.position} />
          </dl>
          {entry.notes && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
              {entry.notes}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
              className={buttonClass}
            >
              Edit planning
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (
                  !disabled &&
                  window.confirm(
                    'Remove ' +
                      entry.exercise.name +
                      ' from this template? Existing workout snapshots will not change.',
                  )
                )
                  void act(actions.remove);
              }}
              className={buttonClass + ' text-red-800'}
            >
              Remove exercise
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-slate-700">
          {error}
        </p>
      )}
    </li>
  );
}
export function TemplateArchived({ name }: { name: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
        {name}
      </h1>
      <p role="status" className="mt-3 font-semibold">
        Template archived.
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        It is no longer available for new workouts. Existing sessions remain
        unchanged. The current API does not expose archived details or restore.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/templates" className={buttonClass}>
          Back to Templates
        </Link>
        <Link href="/workout" className={buttonClass}>
          Go to Workout
        </Link>
      </div>
    </section>
  );
}
export function TemplateDetailContent({
  template,
  disabled,
  pending,
  blocked,
  error,
  actions,
  onUnauthorized,
}: {
  template: WorkoutTemplate;
  disabled: boolean;
  pending: string | null;
  blocked: boolean;
  error: string | null;
  actions: TemplateActions;
  onUnauthorized: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [picker, setPicker] = useState(false);
  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Active template
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {template.name}
        </h1>
        {template.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
            {template.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/templates" className={buttonClass}>
            All templates
          </Link>
          {template.exercises.length > 0 && (
            <Link href="/workout" className={buttonClass}>
              Go to Workout
            </Link>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing((value) => !value)}
            className={buttonClass}
          >
            {editing ? 'Close metadata editor' : 'Edit metadata'}
          </button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm"
        >
          {error}
        </p>
      )}
      {blocked && (
        <p role="alert" className="mb-4 text-sm text-slate-700">
          Reload the template before making another change. Reload discards
          unsaved drafts.
        </p>
      )}
      {editing && (
        <div className="mb-6">
          <TemplateMetadataForm
            template={template}
            disabled={disabled}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              const saved = await actions.metadata(input);
              if (saved) setEditing(false);
              return saved;
            }}
          />
        </div>
      )}
      <section aria-labelledby="template-exercises">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="template-exercises" className="text-xl font-semibold">
            Exercises
          </h2>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPicker(true)}
            className={buttonClass}
          >
            Add exercise
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          This order and planning will be copied into new workouts, never into
          existing sessions.
        </p>
        {template.exercises.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-7 text-center text-sm text-slate-500">
            No exercises yet. Add an exercise before starting a workout.
          </p>
        ) : (
          <ol className="space-y-4">
            {template.exercises.map((entry, index) => (
              <TemplateExerciseCard
                key={entry.id}
                entry={entry}
                first={index === 0}
                last={index === template.exercises.length - 1}
                disabled={disabled}
                actions={{
                  update: (input) => actions.update(entry.id, input),
                  remove: () => actions.remove(entry.id),
                  move: (direction) => {
                    const ids = requestedMove(
                      template.exercises,
                      entry.id,
                      direction,
                    );
                    return ids ? actions.reorder(ids) : Promise.resolve(false);
                  },
                }}
              />
            ))}
          </ol>
        )}
      </section>
      {picker && (
        <ExercisePicker
          existingIds={template.exercises.map((entry) => entry.exercise.id)}
          disabled={disabled}
          onAdd={actions.add}
          onUnauthorized={onUnauthorized}
          onClose={() => setPicker(false)}
        />
      )}
      <section
        aria-label="Archive template"
        className="mt-7 rounded-xl border border-slate-200 bg-white p-5"
      >
        <p className="text-sm leading-6 text-slate-600">
          Archive removes this template from active planning, without deleting
          its historical workouts.
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={actions.archive}
          className={buttonClass + ' mt-4 text-red-800'}
        >
          {pending === 'archive' ? 'Archiving...' : 'Archive template'}
        </button>
      </section>
    </>
  );
}
export function TemplateDetail({ templateId }: { templateId: string }) {
  const router = useRouter(),
    lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  const [retry, setRetry] = useState(0),
    [resource, setResource] = useState<{
      key: number;
      template: WorkoutTemplate;
    } | null>(null);
  const [failure, setFailure] = useState<{
    key: number;
    status?: number;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null),
    [blocked, setBlocked] = useState(false),
    [archived, setArchived] = useState(false),
    [error, setError] = useState<string | null>(null);
  const login = useCallback(
    () =>
      router.replace(
        '/login?' +
          new URLSearchParams({
            returnTo: '/templates/' + encodeURIComponent(templateId),
          }),
      ),
    [router, templateId],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void apiClient
      .getWorkoutTemplate(templateId, controller.signal)
      .then((template) => {
        if (!controller.signal.aborted) {
          setResource({ key: retry, template });
          setBlocked(false);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized') login();
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
  }, [templateId, retry, login]);
  const template = resource?.key === retry ? resource.template : null;
  async function mutate(
    label: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    if (!template || archived || blocked || !lock.current.acquire())
      return false;
    setPending(label);
    setError(null);
    try {
      await operation();
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized') login();
        if (ambiguousWrite(error)) setBlocked(true);
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.status === 409)
        ) {
          try {
            const fresh = await apiClient.getWorkoutTemplate(templateId);
            if (mounted.current) setResource({ key: retry, template: fresh });
          } catch (readError: unknown) {
            if (mounted.current) {
              if (readError instanceof ApiError && readError.status === 404) {
                setResource(null);
                setFailure({ key: retry, status: 404 });
              } else setBlocked(true);
            }
          }
        }
      }
      throw error;
    } finally {
      lock.current.release();
      if (mounted.current) setPending(null);
    }
  }
  function acceptEntry(entry: TemplateExercise) {
    if (mounted.current)
      setResource((current) =>
        current
          ? {
              ...current,
              template: applyTemplateExercise(current.template, entry),
            }
          : current,
      );
  }
  const actions: TemplateActions = {
    metadata: (input) =>
      mutate('metadata', async () => {
        const fresh = await apiClient.updateWorkoutTemplate(templateId, input);
        if (mounted.current) setResource({ key: retry, template: fresh });
      }),
    add: (input) =>
      mutate('add', async () =>
        acceptEntry(await apiClient.addTemplateExercise(templateId, input)),
      ),
    update: (entryId, input) =>
      mutate('planning:' + entryId, async () =>
        acceptEntry(
          await apiClient.updateTemplateExercise(templateId, entryId, input),
        ),
      ),
    remove: (entryId) =>
      mutate('remove:' + entryId, async () => {
        await apiClient.removeTemplateExercise(templateId, entryId);
        try {
          const fresh = await apiClient.getWorkoutTemplate(templateId);
          if (mounted.current) setResource({ key: retry, template: fresh });
        } catch (error: unknown) {
          if (mounted.current) setBlocked(true);
          throw error;
        }
      }),
    reorder: (ids) =>
      mutate('reorder', async () => {
        const fresh = await apiClient.reorderTemplateExercises(templateId, ids);
        if (mounted.current) setResource({ key: retry, template: fresh });
      }),
    archive: () => {
      if (
        pending !== null ||
        blocked ||
        archived ||
        !window.confirm(
          'Archive this template? It will no longer be available for new workouts. Existing sessions remain unchanged.',
        )
      )
        return;
      void mutate('archive', async () => {
        await apiClient.archiveWorkoutTemplate(templateId);
        if (mounted.current) setArchived(true);
      }).catch((error: unknown) => {
        if (mounted.current) setError(templateMutationMessage(error));
      });
    },
  };
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="templates" />
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {archived && template ? (
          <TemplateArchived name={template.name} />
        ) : template ? (
          <>
            <TemplateDetailContent
              key={retry}
              template={template}
              disabled={pending !== null || blocked}
              pending={pending}
              blocked={blocked}
              error={error}
              actions={actions}
              onUnauthorized={login}
            />
            {blocked && (
              <button
                type="button"
                className={buttonClass + ' mt-4'}
                disabled={pending !== null}
                onClick={() => setRetry((value) => value + 1)}
              >
                Reload template
              </button>
            )}
          </>
        ) : (
          <>
            <h1 className="mb-6 text-3xl font-semibold">Template</h1>
            {failure?.key === retry ? (
              <WorkoutError
                title="Template unavailable"
                onRetry={() => setRetry((value) => value + 1)}
              >
                {failure.status === 400 || failure.status === 404
                  ? 'This template is unavailable. It may have been archived, or this link is not available to your account.'
                  : undefined}
              </WorkoutError>
            ) : (
              <WorkoutLoading label="Loading template..." />
            )}
            <Link href="/templates" className={buttonClass + ' mt-5'}>
              Back to Templates
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
