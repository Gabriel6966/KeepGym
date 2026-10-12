'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '../dashboard/dashboard.ui';
import type { SetEntry, SetEntryInput } from './workout.types';
import {
  setDraft,
  validateSetDraft,
  type SetField,
} from './set-form.validation';
import { createSubmissionLock, mutationMessage } from './workout-state';
import { inputClass } from './workout.ui';

const fields: {
  key: SetField;
  label: string;
  hint: string;
  decimal: boolean;
}[] = [
  {
    key: 'loadKg',
    label: 'Load (kg)',
    hint: '0–10000, up to 2 decimals',
    decimal: true,
  },
  { key: 'reps', label: 'Reps', hint: '1–1000, whole numbers', decimal: false },
  {
    key: 'rpe',
    label: 'RPE (optional)',
    hint: '1–10, steps of 0.5',
    decimal: true,
  },
  {
    key: 'rir',
    label: 'RIR (optional)',
    hint: '0–10, whole numbers',
    decimal: false,
  },
];
export function SetForm({
  set,
  disabled,
  onSave,
  onCancel,
}: {
  set?: SetEntry;
  disabled: boolean;
  onSave: (input: SetEntryInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const prefix = useId();
  const [draft, setValues] = useState(() => setDraft(set));
  const [errors, setErrors] = useState<Partial<Record<SetField, string>>>({}),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const lock = useRef(createSubmissionLock());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const validated = validateSetDraft(draft);
    if (validated.errors) {
      setErrors(validated.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      if (await onSave(validated.input)) {
        if (!set) setValues(setDraft());
      }
    } catch (error: unknown) {
      setError(mutationMessage(error));
    } finally {
      lock.current.release();
      setPending(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={set ? 'Edit set ' + set.position : 'Add set'}
      className="rounded-lg bg-slate-50 p-4"
    >
      <h4 className="mb-4 text-sm font-semibold">
        {set ? 'Edit set ' + set.position : 'Add set'}
      </h4>
      <div className="grid grid-cols-2 gap-4">
        {fields.map((field) => {
          const id = prefix + '-' + field.key;
          return (
            <div key={field.key} className="min-w-0">
              <label htmlFor={id} className="text-sm font-medium">
                {field.label}
              </label>
              <input
                id={id}
                name={field.key}
                type="text"
                inputMode={field.decimal ? 'decimal' : 'numeric'}
                autoComplete="off"
                required={field.key === 'loadKg' || field.key === 'reps'}
                value={draft[field.key]}
                disabled={disabled || pending}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [field.key]: event.target.value,
                  }))
                }
                aria-invalid={!!errors[field.key]}
                aria-describedby={
                  id + '-hint' + (errors[field.key] ? ' ' + id + '-error' : '')
                }
                className={inputClass}
              />
              <p id={id + '-hint'} className="mt-1 text-xs text-slate-500">
                {field.hint}
              </p>
              {errors[field.key] && (
                <p id={id + '-error'} className="mt-1 text-sm text-red-800">
                  {errors[field.key]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          Check the highlighted fields.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-slate-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className={buttonClass}
        >
          {pending ? 'Saving...' : set ? 'Save set' : 'Add set'}
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className={buttonClass}
          >
            Cancel edit
          </button>
        )}
      </div>
    </form>
  );
}
