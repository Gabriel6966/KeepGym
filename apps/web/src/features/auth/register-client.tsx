'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { buttonClass } from '../dashboard/dashboard.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { authReturnPath } from './return-path';
import { afterProfileCheck } from './onboarding-routing';
import { ambiguousProfileWrite } from '../profile/profile-state';
import { RegisterForm } from './register-form';

export function RegisterClient() {
  const router = useRouter(),
    params = useSearchParams(),
    lock = useRef(createSubmissionLock());
  const destination = authReturnPath(params.get('returnTo'));
  const [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [reconcile, setReconcile] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .getProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted)
          router.replace(afterProfileCheck(profile !== null, destination));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized') {
          setReady(true);
          setFailure(null);
        } else {
          setReady(false);
          setFailure(
            'Unable to check your session. Retry before creating an account.',
          );
        }
      });
    return () => controller.abort();
  }, [retry, destination, router]);
  async function checkSession() {
    if (!lock.current.acquire()) return;
    setPending(true);
    setFailure(null);
    try {
      const profile = await apiClient.getProfile();
      router.replace(afterProfileCheck(profile !== null, destination));
    } catch (error: unknown) {
      setFailure(
        error instanceof ApiError && error.kind === 'unauthorized'
          ? 'No active session was found. Sign in to check whether the account was created.'
          : 'Unable to check your profile. Please retry.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  async function register(email: string, password: string) {
    if (!ready || pending || reconcile || !lock.current.acquire()) return;
    setPending(true);
    setFailure(null);
    try {
      await apiClient.register(email, password);
      setReconcile(true);
      try {
        const profile = await apiClient.getProfile();
        router.replace(afterProfileCheck(profile !== null, destination));
      } catch {
        setFailure(
          'Account created. Retry the profile check to continue; do not register again.',
        );
        setPending(false);
        lock.current.release();
      }
    } catch (error: unknown) {
      const ambiguous = ambiguousProfileWrite(error);
      setReconcile(ambiguous);
      setFailure(
        ambiguous
          ? 'The account request may have been applied. Check the session or sign in before trying to register again.'
          : error instanceof ApiError && error.status === 409
            ? 'Unable to create this account. If you already registered, sign in.'
            : 'Unable to create the account. Check your details and try again.',
      );
      setPending(false);
      lock.current.release();
    }
  }
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className={buttonClass}>
          Gym App
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Create account
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Create your account, then set up your profile.
        </p>
        {ready && !reconcile ? (
          <RegisterForm disabled={pending} onRegister={register} />
        ) : !failure && !reconcile ? (
          <p role="status" className="mt-7">
            Checking session...
          </p>
        ) : null}
        {failure && (
          <p role="alert" className="mt-5 text-sm text-slate-700">
            {failure}
          </p>
        )}
        {reconcile ? (
          <button
            type="button"
            disabled={pending}
            className={buttonClass + ' mt-4'}
            onClick={() => void checkSession()}
          >
            {pending ? 'Checking profile...' : 'Check session / profile'}
          </button>
        ) : !ready && failure ? (
          <button
            type="button"
            className={buttonClass + ' mt-4'}
            onClick={() => {
              setFailure(null);
              setRetry((value) => value + 1);
            }}
          >
            Retry session check
          </button>
        ) : null}
        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link
            className="rounded underline focus-visible:outline-2 focus-visible:outline-teal-700"
            href={'/login?' + new URLSearchParams({ returnTo: destination })}
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
