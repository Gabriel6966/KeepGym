'use client';
import Link from 'next/link';
import { useCallback, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass, EmptyState } from '../dashboard/dashboard.ui';
import {
  inputClass,
  WorkoutError,
  WorkoutLoading,
} from '../workout/workout.ui';
import type { CatalogExercise } from '../templates/templates.types';
import {
  selectorQuery,
  selectorUrl,
  exerciseProgressUrl,
} from './progress-query';
import { useProgressRead } from './progress-read';

export function ProgressExerciseCards({
  items,
}: {
  items: readonly CatalogExercise[];
}) {
  return items.length === 0 ? (
    <EmptyState>No exercises match this search.</EmptyState>
  ) : (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((exercise) => (
        <li
          key={exercise.id}
          data-progress-catalog-id={exercise.id}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-5"
        >
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {exercise.name}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {exercise.primaryMuscle} · {exercise.equipment.replaceAll('_', ' ')}{' '}
            · {exercise.movementPattern.replaceAll('_', ' ')}
          </p>
          <Link
            href={exerciseProgressUrl(exercise.id)}
            className={buttonClass + ' mt-4'}
            aria-label={'View progress of ' + exercise.name}
          >
            View progress
          </Link>
        </li>
      ))}
    </ul>
  );
}
function SearchForm({
  q,
  onSearch,
}: {
  q: string;
  onSearch: (q: string) => void;
}) {
  const [draft, setDraft] = useState(q),
    [error, setError] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ([...draft.trim()].length > 100) {
      setError(true);
      return;
    }
    setError(false);
    onSearch(draft.trim());
  }
  return (
    <form
      onSubmit={submit}
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="progress-search" className="text-sm font-medium">
          Search exercises
        </label>
        <input
          id="progress-search"
          name="q"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={inputClass}
          aria-invalid={error}
          aria-describedby={error ? 'progress-search-error' : undefined}
        />
        {error && (
          <p id="progress-search-error" role="alert">
            Use at most 100 search characters.
          </p>
        )}
      </div>
      <button type="submit" className={buttonClass}>
        Search
      </button>
    </form>
  );
}
export function ProgressSelector() {
  const router = useRouter(),
    params = useSearchParams(),
    query = selectorQuery(new URLSearchParams(params.toString())),
    q = query.q ?? '',
    page = query.page ?? 1,
    key = JSON.stringify([q, page]);
  const load = useCallback(
    (signal: AbortSignal) =>
      apiClient.listCatalogExercises(
        { q: q || undefined, page, limit: 10 },
        signal,
      ),
    [q, page],
  );
  const onError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.kind === 'unauthorized')
        router.replace(
          '/login?' +
            new URLSearchParams({ returnTo: selectorUrl({ q, page }) }),
        );
    },
    [q, page, router],
  );
  const resource = useProgressRead(key, load, onError);
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="progress" />
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          Exercise progress
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Select an active catalog exercise to review your historical
          performance. Historical deep links also work for inactive sources.
        </p>
        <SearchForm
          key={q}
          q={q}
          onSearch={(value) => router.push(selectorUrl({ q: value, page: 1 }))}
        />
        {resource.data ? (
          <>
            <ProgressExerciseCards items={resource.data.items} />
            <nav
              aria-label="Progress exercise pages"
              className="mt-6 flex flex-wrap items-center justify-between gap-3"
            >
              <button
                type="button"
                className={buttonClass}
                disabled={page <= 1}
                onClick={() => router.push(selectorUrl({ q, page: page - 1 }))}
              >
                Previous exercises
              </button>
              <span>
                Page {resource.data.page} of{' '}
                {Math.max(1, resource.data.totalPages)}
              </span>
              <button
                type="button"
                className={buttonClass}
                disabled={page >= resource.data.totalPages}
                onClick={() => router.push(selectorUrl({ q, page: page + 1 }))}
              >
                Next exercises
              </button>
            </nav>
          </>
        ) : resource.failed ? (
          <WorkoutError
            title="Exercise selector unavailable"
            onRetry={resource.retry}
          />
        ) : (
          <WorkoutLoading label="Loading exercises..." />
        )}
      </main>
    </div>
  );
}
