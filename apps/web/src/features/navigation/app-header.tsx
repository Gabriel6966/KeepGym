'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '../../lib/api-client';
import { buttonClass } from '../dashboard/dashboard.ui';

export function AppHeader({
  active,
}: {
  active:
    | 'dashboard'
    | 'workout'
    | 'templates'
    | 'history'
    | 'body'
    | 'profile'
    | 'progress';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  async function logout() {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await apiClient.logout();
      router.replace('/login');
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <header className="kg-header-blur border-b border-slate-200 lg:sticky lg:top-0 lg:z-30">
      <div className="mx-auto grid max-w-7xl gap-2 px-4 py-2 sm:px-6 md:flex md:items-center md:justify-between md:gap-3 md:py-3 lg:px-8">
        <Link
          href="/"
          aria-label="Gym App home"
          className="flex min-h-11 w-fit shrink-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white"
          >
            G
          </span>
          <span className="font-semibold tracking-tight">Gym App</span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-x-1 gap-y-1 md:justify-end lg:gap-x-2"
        >
          {(
            [
              'dashboard',
              'workout',
              'templates',
              'history',
              'body',
              'profile',
              'progress',
            ] as const
          ).map((item) => (
            <Link
              key={item}
              href={'/' + item}
              aria-current={active === item ? 'page' : undefined}
              className="kg-nav-active inline-flex min-h-11 items-center rounded-md px-2 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-700 motion-safe:transition-colors"
            >
              {item === 'dashboard'
                ? 'Dashboard'
                : item === 'workout'
                  ? 'Workout'
                  : item === 'templates'
                    ? 'Templates'
                    : item === 'history'
                      ? 'History'
                      : item === 'body'
                        ? 'Body'
                        : item === 'profile'
                          ? 'Profile'
                          : 'Progress'}
            </Link>
          ))}
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            className={buttonClass}
          >
            {pending ? 'Signing out...' : 'Sign out'}
          </button>
        </nav>
      </div>
      {error && (
        <p
          role="alert"
          className="mx-auto max-w-7xl px-4 pb-3 text-sm text-slate-700"
        >
          We couldn&apos;t sign you out. Please try again.
        </p>
      )}
    </header>
  );
}
