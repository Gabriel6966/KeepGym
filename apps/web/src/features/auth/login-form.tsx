'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { apiClient, ApiError } from '../../lib/api-client';
import { authReturnPath } from './return-path';
import { buttonClass } from '../dashboard/dashboard.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { afterProfileCheck } from './onboarding-routing';

export function LoginForm() {
  const router = useRouter(),
    params = useSearchParams();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const lock = useRef(createSubmissionLock());
  const destination = authReturnPath(params.get('returnTo'));
  async function checkProfile() {
    const profile = await apiClient.getProfile();
    router.replace(afterProfileCheck(profile !== null, destination));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lock.current.acquire()) return;
    setPending(true);
    setError(null);
    try {
      await apiClient.login(email, password);
      setPassword('');
      setSignedIn(true);
      try {
        await checkProfile();
      } catch {
        setError(
          'You are signed in, but your profile could not be checked. Retry the profile check.',
        );
        setPending(false);
        lock.current.release();
      }
    } catch (error: unknown) {
      setError(
        error instanceof ApiError && error.kind === 'unauthorized'
          ? 'Email or password is incorrect.'
          : 'Unable to sign in right now. Please try again.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  async function retryProfile() {
    if (!lock.current.acquire()) return;
    setPending(true);
    setError(null);
    try {
      await checkProfile();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === 'unauthorized') {
        setSignedIn(false);
        setError('Your session expired. Sign in again.');
      } else setError('Unable to check your profile. Please retry.');
      setPending(false);
      lock.current.release();
    }
  }
  const inputClass =
    'mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-700';
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <Link
          href="/"
          className="rounded text-sm font-semibold text-slate-600 focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          Gym App
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Access your workouts and dashboard with your existing account.
        </p>
        {!signedIn && (
          <form
            className="mt-7 space-y-5"
            onSubmit={submit}
            aria-describedby={error ? 'login-error' : undefined}
          >
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                disabled={pending}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                disabled={pending}
              />
            </div>
            {error && (
              <p
                id="login-error"
                role="alert"
                className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className={
                buttonClass +
                ' w-full border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
              }
            >
              {pending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}
        {signedIn && (
          <div className="mt-7 space-y-4">
            <p role="status">
              {pending
                ? 'Checking your profile...'
                : 'Signed in. Profile check pending.'}
            </p>
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              disabled={pending}
              className={buttonClass}
              onClick={() => void retryProfile()}
            >
              Retry profile check
            </button>
          </div>
        )}
        <p className="mt-6 text-sm text-slate-600">
          New here?{' '}
          <Link
            className="rounded underline focus-visible:outline-2 focus-visible:outline-teal-700"
            href={'/register?' + new URLSearchParams({ returnTo: destination })}
          >
            Create account
          </Link>
        </p>
      </div>
    </main>
  );
}
