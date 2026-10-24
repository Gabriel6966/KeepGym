'use client';

import { AuthIcon } from './auth-icon';
import { useRef, useState, type FormEvent } from 'react';
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
      aria-label="Crear cuenta"
      noValidate
      onSubmit={submit}
      className="auth-form"
    >
      {(['email', 'password', 'confirmPassword'] as const).map((field) => (
        <div key={field} className="auth-field">
          <label htmlFor={'register-' + field}>
            {field === 'email'
              ? 'Correo electrónico'
              : field === 'password'
                ? 'Contraseña'
                : 'Confirmar contraseña'}
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
            className="auth-input"
          />
          {field === 'password' && (
            <p id="register-password-hint" className="auth-hint">
              Entre 15 y 128 caracteres. Sin combinaciones de caracteres
              obligatorias.
            </p>
          )}
          {errors[field] && (
            <p id={'register-' + field + '-error'} className="auth-field-error">
              {field === 'email'
                ? 'Introduce un correo válido, de hasta 320 caracteres.'
                : field === 'password'
                  ? 'Utiliza una contraseña de entre 15 y 128 caracteres.'
                  : 'Las contraseñas deben coincidir.'}
            </p>
          )}
        </div>
      ))}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="auth-error">
          Revisa los campos señalados.
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className="auth-button auth-button--primary"
      >
        {pending ? 'Creando cuenta…' : 'Crear cuenta'}
        <AuthIcon name="arrow-right" />
      </button>
    </form>
  );
}
