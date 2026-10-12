'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '../dashboard/dashboard.ui';
import { inputClass } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import type {
  TemplateExercise,
  WorkoutTemplate,
} from '../workout/workout.types';
import {
  metadataDraft,
  planningDraft,
  validateMetadata,
  validatePlanning,
  type MetadataDraft,
  type PlanningField,
} from './templates.validation';
import { templateMutationMessage } from './templates.state';
import type { PlanningInput, TemplateMetadataInput } from './templates.types';

function FormField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
  required = false,
  multiline = false,
  numeric = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  error?: string;
  disabled: boolean;
  required?: boolean;
  multiline?: boolean;
  numeric?: boolean;
}) {
  const description = id + '-hint' + (error ? ' ' + id + '-error' : '');
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          name={label === 'Description' ? 'description' : 'notes'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={description}
          className={inputClass + ' resize-y'}
        />
      ) : (
        <input
          id={id}
          name={id.split('-').at(-1)}
          type="text"
          inputMode={numeric ? 'numeric' : 'text'}
          autoComplete="off"
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={description}
          className={inputClass}
        />
      )}
      <p id={id + '-hint'} className="mt-1 text-xs text-slate-500">
        {hint}
      </p>
      {error && (
        <p id={id + '-error'} className="mt-1 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
export function TemplateMetadataForm({
  template,
  disabled,
  onSave,
  onCancel,
}: {
  template?: WorkoutTemplate;
  disabled: boolean;
  onSave: (input: TemplateMetadataInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const prefix = useId(),
    lock = useRef(createSubmissionLock());
  const [draft, setDraft] = useState(() => metadataDraft(template)),
    [errors, setErrors] = useState<
      Partial<Record<keyof MetadataDraft, string>>
    >({});
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const validated = validateMetadata(draft);
    if (validated.errors) {
      setErrors(validated.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      await onSave(validated.input);
    } catch (error: unknown) {
      setError(templateMutationMessage(error));
    } finally {
      lock.current.release();
      setPending(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={template ? 'Edit template metadata' : 'Create template'}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <FormField
        id={prefix + '-name'}
        label="Name"
        value={draft.name}
        onChange={(value) =>
          setDraft((current) => ({ ...current, name: value }))
        }
        hint="Required · 1–120 characters"
        required
        disabled={disabled || pending}
        error={errors.name}
      />
      <FormField
        id={prefix + '-description'}
        label="Description"
        value={draft.description}
        onChange={(value) =>
          setDraft((current) => ({ ...current, description: value }))
        }
        hint="Optional · up to 1000 characters. Leave blank to clear."
        multiline
        disabled={disabled || pending}
        error={errors.description}
      />
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          Check the highlighted fields.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-slate-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className={buttonClass}
        >
          {pending
            ? 'Saving...'
            : template
              ? 'Save metadata'
              : 'Create template'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={buttonClass}
          >
            Cancel edit
          </button>
        )}
      </div>
    </form>
  );
}
const planningFields = [
  { key: 'targetSets', label: 'Target sets', hint: '1–20, whole numbers' },
  { key: 'targetRepsMin', label: 'Minimum reps', hint: '1–100, whole numbers' },
  {
    key: 'targetRepsMax',
    label: 'Maximum reps',
    hint: '1–100, at least minimum reps',
  },
  {
    key: 'restSeconds',
    label: 'Rest seconds',
    hint: '0–1800. Blank uses 90 when adding, or keeps the existing value when editing.',
  },
] as const;
export function PlanningForm({
  entry,
  disabled,
  onSave,
  onCancel,
}: {
  entry?: TemplateExercise;
  disabled: boolean;
  onSave: (input: PlanningInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const prefix = useId(),
    lock = useRef(createSubmissionLock());
  const [draft, setDraft] = useState(() => planningDraft(entry)),
    [errors, setErrors] = useState<Partial<Record<PlanningField, string>>>({});
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const validated = validatePlanning(draft);
    if (validated.errors) {
      setErrors(validated.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      await onSave(validated.input);
    } catch (error: unknown) {
      setError(templateMutationMessage(error));
    } finally {
      lock.current.release();
      setPending(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={entry ? 'Edit planning' : 'Add exercise planning'}
      className="space-y-4 rounded-lg bg-slate-50 p-4"
    >
      <p className="text-sm text-slate-600">
        Planning guides future workouts; it never restricts actual logged sets.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {planningFields.map((field) => (
          <FormField
            key={field.key}
            id={prefix + '-' + field.key}
            label={field.label}
            value={draft[field.key]}
            onChange={(value) =>
              setDraft((current) => ({ ...current, [field.key]: value }))
            }
            hint={field.hint}
            error={errors[field.key]}
            disabled={disabled || pending}
            required={field.key !== 'restSeconds'}
            numeric
          />
        ))}
      </div>
      <FormField
        id={prefix + '-notes'}
        label="Planning notes"
        value={draft.notes}
        onChange={(value) =>
          setDraft((current) => ({ ...current, notes: value }))
        }
        hint="Optional · up to 500 characters. Leave blank to clear."
        multiline
        error={errors.notes}
        disabled={disabled || pending}
      />
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          Check the highlighted fields.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-slate-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className={buttonClass}
        >
          {pending ? 'Saving...' : entry ? 'Save planning' : 'Add exercise'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={buttonClass}
        >
          {entry ? 'Cancel edit' : 'Cancel selection'}
        </button>
      </div>
    </form>
  );
}
