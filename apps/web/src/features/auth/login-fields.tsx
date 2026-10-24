import { AuthIcon } from './auth-icon';
import type { FormEvent } from 'react';

export function LoginFields({
  email,
  password,
  pending,
  disabled = false,
  error,
  onEmail,
  onPassword,
  onSubmit,
}: {
  email: string;
  password: string;
  pending: boolean;
  disabled?: boolean;
  error: string | null;
  onEmail: (email: string) => void;
  onPassword: (password: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="auth-form"
      onSubmit={onSubmit}
      aria-label="Iniciar sesión"
      aria-describedby={error ? 'login-error' : undefined}
    >
      <div className="auth-field">
        <label htmlFor="email">Correo electrónico</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => onEmail(event.target.value)}
          className="auth-input"
          disabled={pending || disabled}
        />
      </div>
      <div className="auth-field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          className="auth-input"
          disabled={pending || disabled}
        />
      </div>
      {error && (
        <p id="login-error" role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || disabled}
        className="auth-button auth-button--primary"
      >
        {pending ? 'Iniciando sesión…' : 'Iniciar sesión'}
        <AuthIcon name="arrow-right" />
      </button>
    </form>
  );
}
