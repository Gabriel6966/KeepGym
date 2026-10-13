'use client';

import { useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '../dashboard/dashboard.ui';
import { inputClass } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import {
  validateRegistration,
  type RegistrationDraft,
} from './register.validation';

export function RegisterForm({
  disabled,
  onRegister,
}: {
  disabled: boolean;
  onRegister: (email: string, password: string) => Promise<void>;
}) {
  const lock = useRef(createSubmissionLock());
  const [draft, setDraft] = useState<RegistrationDraft>({
      email: '',
      password: '',
      confirmPassword: '',
    }),
    [errors, setErrors] = useState<
      Partial<Record<keyof RegistrationDraft, string>>
    >({}),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const result = validateRegistration(draft);
    if (result.errors) {
      setErrors(result.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await onRegister(result.input.email, result.input.password);
    } finally {
      setDraft((current) => ({
        ...current,
        password: '',
        confirmPassword: '',
      }));
      setPending(false);
      lock.current.release();
    }
  }
  return (
    <form
      aria-label="Create account"
      noValidate
      onSubmit={submit}
      className="mt-7 space-y-5"
    >
      {(['email', 'password', 'confirmPassword'] as const).map((field) => (
        <div key={field}>
          <label htmlFor={'register-' + field} className="text-sm font-medium">
            {field === 'email'
              ? 'Email'
              : field === 'password'
                ? 'Password'
                : 'Confirm password'}
          </label>
          <input
            id={'register-' + field}
            name={field}
            type={field === 'email' ? 'email' : 'password'}
            autoComplete={field === 'email' ? 'email' : 'new-password'}
            required
            value={draft[field]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [field]: event.target.value,
              }))
            }
            disabled={disabled || pending}
            aria-invalid={!!errors[field]}
            aria-describedby={
              (field === 'password' ? 'register-password-hint ' : '') +
              (errors[field] ? 'register-' + field + '-error' : '')
            }
            className={inputClass}
          />
          {field === 'password' && (
            <p
              id="register-password-hint"
              className="mt-1 text-xs text-slate-500"
            >
              15–128 characters. No required character combinations.
            </p>
          )}
          {errors[field] && (
            <p
              id={'register-' + field + '-error'}
              className="mt-1 text-sm text-red-800"
            >
              {errors[field]}
            </p>
          )}
        </div>
      ))}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          Check the highlighted fields.
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className={buttonClass + ' w-full'}
      >
        {pending ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}
