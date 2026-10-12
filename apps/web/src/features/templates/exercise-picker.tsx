'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiClient, ApiError } from '../../lib/api-client';
import { buttonClass, EmptyState } from '../dashboard/dashboard.ui';
import {
  muscleGroupValues,
  type MuscleGroup,
} from '../dashboard/dashboard.types';
import {
  inputClass,
  WorkoutError,
  WorkoutLoading,
} from '../workout/workout.ui';
import type { ResourcePage } from '../workout/workout.types';
import { PlanningForm } from './template-forms';
import type {
  AddTemplateExerciseInput,
  CatalogExercise,
} from './templates.types';

export function CatalogResults({
  items,
  existingIds,
  disabled,
  onSelect,
}: {
  items: CatalogExercise[];
  existingIds: string[];
  disabled: boolean;
  onSelect: (exercise: CatalogExercise) => void;
}) {
  return items.length === 0 ? (
    <EmptyState>No exercises match this search.</EmptyState>
  ) : (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((exercise) => {
        const alreadyAdded = existingIds.includes(exercise.id);
        return (
          <li
            key={exercise.id}
            className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="font-semibold [overflow-wrap:anywhere]">
              {exercise.name}
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {exercise.primaryMuscle} ·{' '}
              {exercise.equipment.replaceAll('_', ' ')} ·{' '}
              {exercise.movementPattern.replaceAll('_', ' ')}
            </p>
            <button
              type="button"
              disabled={disabled || alreadyAdded}
              onClick={() => onSelect(exercise)}
              aria-label={'Select ' + exercise.name}
              className={buttonClass + ' mt-3'}
            >
              {alreadyAdded ? 'Already added' : 'Select exercise'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
export function ExercisePicker({
  existingIds,
  disabled,
  onAdd,
  onUnauthorized,
  onClose,
}: {
  existingIds: string[];
  disabled: boolean;
  onAdd: (input: AddTemplateExerciseInput) => Promise<boolean>;
  onUnauthorized: () => void;
  onClose: () => void;
}) {
  const [draftQuery, setDraftQuery] = useState(''),
    [query, setQuery] = useState(''),
    [muscle, setMuscle] = useState<MuscleGroup | ''>('');
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [searchError, setSearchError] = useState(false);
  const [selected, setSelected] = useState<CatalogExercise | null>(null);
  const [resource, setResource] = useState<{
      key: string;
      data: ResourcePage<CatalogExercise>;
    } | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const key = `${query}|${muscle}|${page}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .listCatalogExercises(
        { q: query, primaryMuscle: muscle || undefined, page, limit: 10 },
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          onUnauthorized();
        else setFailure(key);
      });
    return () => controller.abort();
  }, [query, muscle, page, key, onUnauthorized]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ([...draftQuery.trim()].length > 100) {
      setSearchError(true);
      return;
    }
    setSearchError(false);
    setPage(1);
    setQuery(draftQuery.trim());
  }
  const data = resource?.key === key ? resource.data : null;
  return (
    <section
      aria-labelledby="catalog-picker"
      className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="catalog-picker" className="text-lg font-semibold">
          Add exercise
        </h2>
        <button
          type="button"
          disabled={disabled}
          onClick={onClose}
          className={buttonClass}
        >
          Close picker
        </button>
      </div>
      {selected ? (
        <>
          <h3 className="mb-4 font-semibold [overflow-wrap:anywhere]">
            Configure {selected.name}
          </h3>
          {existingIds.includes(selected.id) && (
            <p role="status" className="mb-3 text-sm text-slate-600">
              This exercise is already in the template. Cancel this selection or
              reload.
            </p>
          )}
          <PlanningForm
            key={selected.id}
            disabled={disabled || existingIds.includes(selected.id)}
            onCancel={() => setSelected(null)}
            onSave={async (input) => {
              const added = await onAdd({ exerciseId: selected.id, ...input });
              if (added) setSelected(null);
              return added;
            }}
          />
        </>
      ) : (
        <>
          <form
            onSubmit={search}
            className="mb-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
          >
            <div className="min-w-0">
              <label htmlFor="catalog-query" className="text-sm font-medium">
                Search exercises
              </label>
              <input
                id="catalog-query"
                type="search"
                name="q"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                disabled={disabled}
                aria-invalid={searchError}
                aria-describedby={
                  searchError ? 'catalog-search-error' : undefined
                }
                className={inputClass}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="catalog-muscle" className="text-sm font-medium">
                Primary muscle
              </label>
              <select
                id="catalog-muscle"
                value={muscle}
                disabled={disabled}
                onChange={(event) => {
                  const selected = muscleGroupValues.find(
                    (value) => value === event.target.value,
                  );
                  setMuscle(selected ?? '');
                  setPage(1);
                }}
                className={inputClass}
              >
                <option value="">All muscles</option>
                {muscleGroupValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={disabled}
              className={buttonClass + ' self-end'}
            >
              Search
            </button>
          </form>
          {searchError && (
            <p
              id="catalog-search-error"
              role="alert"
              className="mb-3 text-sm text-red-800"
            >
              Use at most 100 search characters.
            </p>
          )}
          {data ? (
            <>
              <CatalogResults
                items={data.items}
                existingIds={existingIds}
                disabled={disabled}
                onSelect={setSelected}
              />
              {data.totalPages > 1 && (
                <nav
                  aria-label="Exercise catalog pages"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={page === 1 || disabled}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous exercises
                  </button>
                  <span className="text-sm text-slate-500">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={page >= data.totalPages || disabled}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next exercises
                  </button>
                </nav>
              )}
            </>
          ) : failure === key ? (
            <WorkoutError
              title="Catalog unavailable"
              onRetry={() => setRetry((value) => value + 1)}
            />
          ) : (
            <WorkoutLoading label="Loading exercise catalog..." />
          )}
        </>
      )}
    </section>
  );
}
