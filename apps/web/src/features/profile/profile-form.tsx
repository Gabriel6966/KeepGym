'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '../dashboard/dashboard.ui';
import { inputClass } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import {
  profileDraft,
  validateProfileDraft,
  type ProfileErrors,
} from './profile.validation';
import { profileMutationMessage } from './profile-state';
import {
  experienceOptions,
  goalOptions,
  unitOptions,
  type Profile,
  type ProfileChanges,
} from './profile.types';

const enumFields = [
  {
    key: 'experienceLevel',
    label: 'Experience level',
    options: experienceOptions,
    nullable: true,
    hint: 'Optional training background.',
  },
  {
    key: 'trainingGoal',
    label: 'Training goal',
    options: goalOptions,
    nullable: true,
    hint: 'Optional preference; no recommendations are inferred.',
  },
  {
    key: 'unitSystem',
    label: 'Unit system',
    options: unitOptions,
    nullable: false,
    hint: 'Display preference only. Height remains cm; body measurements remain kg/cm/%.',
  },
] as const;
export function ProfileForm({
  profile,
  today,
  disabled,
  onSave,
}: {
  profile?: Profile;
  today: string;
  disabled: boolean;
  onSave: (input: ProfileChanges) => Promise<boolean>;
}) {
  const prefix = useId(),
    lock = useRef(createSubmissionLock());
  const [draft, setDraft] = useState(() => profileDraft(profile)),
    [errors, setErrors] = useState<ProfileErrors>({}),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const result = validateProfileDraft(draft, today, profile);
    if (result.errors) {
      setErrors(result.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      await onSave(result.input);
    } catch (error: unknown) {
      setError(profileMutationMessage(error));
    } finally {
      lock.current.release();
      setPending(false);
    }
  }
  return (
    <form
      aria-label={profile ? 'Edit profile' : 'Create profile'}
      onSubmit={submit}
      noValidate
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div>
        <label
          htmlFor={prefix + '-displayName'}
          className="text-sm font-medium"
        >
          Display name
        </label>
        <input
          id={prefix + '-displayName'}
          name="displayName"
          type="text"
          autoComplete="nickname"
          required
          value={draft.displayName}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              displayName: event.target.value,
            }))
          }
          disabled={disabled || pending}
          aria-invalid={!!errors.displayName}
          aria-describedby={
            prefix +
            '-name-hint' +
            (errors.displayName ? ' ' + prefix + '-name-error' : '')
          }
          className={inputClass}
        />
        <p id={prefix + '-name-hint'} className="mt-1 text-xs text-slate-500">
          Required · 1–80 characters. Internal spacing is preserved.
        </p>
        {errors.displayName && (
          <p id={prefix + '-name-error'} className="mt-1 text-sm text-red-800">
            {errors.displayName}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={prefix + '-birthDate'}
            className="text-sm font-medium"
          >
            Birth date (optional)
          </label>
          <input
            id={prefix + '-birthDate'}
            name="birthDate"
            type="date"
            max={today}
            value={draft.birthDate}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                birthDate: event.target.value,
              }))
            }
            disabled={disabled || pending}
            aria-invalid={!!errors.birthDate}
            aria-describedby={
              prefix +
              '-birth-hint' +
              (errors.birthDate ? ' ' + prefix + '-birth-error' : '')
            }
            className={inputClass}
          />
          <p
            id={prefix + '-birth-hint'}
            className="mt-1 text-xs text-slate-500"
          >
            Calendar date only, without time or timezone. No minimum age.
          </p>
          {errors.birthDate && (
            <p
              id={prefix + '-birth-error'}
              className="mt-1 text-sm text-red-800"
            >
              {errors.birthDate}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <label htmlFor={prefix + '-heightCm'} className="text-sm font-medium">
            Height (cm, optional)
          </label>
          <input
            id={prefix + '-heightCm'}
            name="heightCm"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.heightCm}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                heightCm: event.target.value,
              }))
            }
            disabled={disabled || pending}
            aria-invalid={!!errors.heightCm}
            aria-describedby={
              prefix +
              '-height-hint' +
              (errors.heightCm ? ' ' + prefix + '-height-error' : '')
            }
            className={inputClass}
          />
          <p
            id={prefix + '-height-hint'}
            className="mt-1 text-xs text-slate-500"
          >
            Whole numbers · 50–300 cm, regardless of unit preference.
          </p>
          {errors.heightCm && (
            <p
              id={prefix + '-height-error'}
              className="mt-1 text-sm text-red-800"
            >
              {errors.heightCm}
            </p>
          )}
        </div>
      </div>
      {enumFields.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={prefix + '-' + field.key}
            className="text-sm font-medium"
          >
            {field.label}
          </label>
          <select
            id={prefix + '-' + field.key}
            name={field.key}
            value={draft[field.key]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
            disabled={disabled || pending}
            aria-invalid={!!errors[field.key]}
            aria-describedby={
              prefix +
              '-' +
              field.key +
              '-hint' +
              (errors[field.key]
                ? ' ' + prefix + '-' + field.key + '-error'
                : '')
            }
            className={inputClass}
          >
            {field.nullable && <option value="">Not specified</option>}
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p
            id={prefix + '-' + field.key + '-hint'}
            className="mt-1 text-xs text-slate-500"
          >
            {field.hint}
          </p>
          {errors[field.key] && (
            <p
              id={prefix + '-' + field.key + '-error'}
              className="mt-1 text-sm text-red-800"
            >
              {errors[field.key]}
            </p>
          )}
        </div>
      ))}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          {errors.form ?? 'Check the highlighted fields.'}
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
          {pending ? 'Saving...' : profile ? 'Save profile' : 'Create profile'}
        </button>
        {profile && (
          <button
            type="button"
            disabled={disabled || pending}
            className={buttonClass}
            onClick={() => {
              setDraft(profileDraft(profile));
              setErrors({});
              setError(null);
            }}
          >
            Reset changes
          </button>
        )}
      </div>
    </form>
  );
}
