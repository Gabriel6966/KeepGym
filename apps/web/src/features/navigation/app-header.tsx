'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiClient } from '../../lib/api-client';
import { buttonClass } from '../dashboard/dashboard.ui';

export function AppHeader({
  active,
}: {
  active: 'dashboard' | 'workout' | 'templates';
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
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Gym App home"
          className="flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white"
          >
            G
          </span>
          <span className="hidden font-semibold tracking-tight sm:inline">
            Gym App
          </span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center justify-end gap-1 sm:gap-3"
        >
          {(['dashboard', 'workout', 'templates'] as const).map((item) => (
            <Link
              key={item}
              href={'/' + item}
              aria-current={active === item ? 'page' : undefined}
              className="rounded-md px-2 py-3 text-sm font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-teal-700"
            >
              {item === 'dashboard'
                ? 'Dashboard'
                : item === 'workout'
                  ? 'Workout'
                  : 'Templates'}
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
