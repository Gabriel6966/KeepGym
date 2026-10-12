'use client';

import { useState } from 'react';
import { buttonClass, Metric } from '../dashboard/dashboard.ui';
import { formatKg, formatNumber } from '../dashboard/format';
import type { SessionExercise, SetEntry, SetEntryInput } from './workout.types';
import { SetForm } from './set-form';
import { mutationMessage } from './workout-state';

function SetRow({
  set,
  editable,
  busy,
  onSave,
  onDelete,
}: {
  set: SetEntry;
  editable: boolean;
  busy: boolean;
  onSave: (input: SetEntryInput) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false),
    [error, setError] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false);
  async function remove() {
    if (
      busy ||
      deleting ||
      !window.confirm(
        'Delete set ' +
          set.position +
          '? The remaining sets will be reordered by the server.',
      )
    )
      return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (error: unknown) {
      setError(mutationMessage(error));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <li className="rounded-lg border border-slate-200 p-4" data-set-id={set.id}>
      {editable && editing ? (
        <SetForm
          set={set}
          disabled={busy}
          onSave={async (input) => {
            const saved = await onSave(input);
            if (saved) setEditing(false);
            return saved;
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">Set {set.position}</h4>
            {editable && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setEditing(true);
                  }}
                  className={buttonClass}
                  aria-label={'Edit set ' + set.position}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className={buttonClass + ' text-red-800'}
                  aria-label={'Delete set ' + set.position}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Load" value={formatKg(set.loadKg)} />
            <Metric label="Reps" value={formatNumber(set.reps)} />
            <Metric label="RPE" value={formatNumber(set.rpe)} />
            <Metric label="RIR" value={formatNumber(set.rir)} />
          </dl>
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
export function ExerciseBlock({
  exercise,
  editable,
  busy,
  onAdd,
  onUpdate,
  onDelete,
}: {
  exercise: SessionExercise;
  editable: boolean;
  busy: boolean;
  onAdd: (input: SetEntryInput) => Promise<boolean>;
  onUpdate: (setId: string, input: SetEntryInput) => Promise<boolean>;
  onDelete: (setId: string) => Promise<boolean>;
}) {
  const headingId = 'exercise-' + exercise.id;
  return (
    <section
      aria-labelledby={headingId}
      data-exercise-id={exercise.id}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h3
        id={headingId}
        className="text-xl font-semibold [overflow-wrap:anywhere]"
      >
        {exercise.exercise.name}
      </h3>
      <p className="mt-2 text-sm text-slate-600">
        Planned: {exercise.plannedSets} sets × {exercise.plannedRepsMin}–
        {exercise.plannedRepsMax} reps · {exercise.plannedRestSeconds}s rest
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {exercise.exercise.primaryMuscle} ·{' '}
        {exercise.exercise.equipment.replaceAll('_', ' ')} · Planning does not
        limit logged sets.
      </p>
      {exercise.plannedNotes && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
          {exercise.plannedNotes}
        </p>
      )}
      {exercise.sets.length === 0 ? (
        <p className="my-5 text-sm text-slate-500">No sets recorded.</p>
      ) : (
        <ol className="my-5 space-y-3">
          {exercise.sets.map((set) => (
            <SetRow
              key={set.id}
              set={set}
              editable={editable}
              busy={busy}
              onSave={(input) => onUpdate(set.id, input)}
              onDelete={() => onDelete(set.id)}
            />
          ))}
        </ol>
      )}
      {editable && <SetForm disabled={busy} onSave={onAdd} />}
    </section>
  );
}
