'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass, EmptyState } from '../dashboard/dashboard.ui';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import type { ResourcePage, WorkoutTemplate } from '../workout/workout.types';

export function TemplateListCards({ items }: { items: WorkoutTemplate[] }) {
  return items.length === 0 ? (
    <EmptyState>
      No workout templates yet.{' '}
      <Link href="/templates/new" className={buttonClass + ' mt-4'}>
        Create template
      </Link>
    </EmptyState>
  ) : (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((template) => (
        <li
          key={template.id}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <span className="text-xs font-medium text-slate-500">
            Active template
          </span>
          <h2 className="mt-2 text-lg font-semibold [overflow-wrap:anywhere]">
            {template.name}
          </h2>
          {template.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
              {template.description}
            </p>
          )}
          <p className="mt-3 text-sm text-slate-500">
            {template.exercises.length} exercises · Updated{' '}
            <time dateTime={template.updatedAt}>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
              }).format(new Date(template.updatedAt))}
            </time>
          </p>
          <Link
            href={'/templates/' + encodeURIComponent(template.id)}
            className={buttonClass + ' mt-4'}
            aria-label={'Open ' + template.name}
          >
            Open template
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function TemplatesList() {
  const router = useRouter();
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<{
      key: string;
      data: ResourcePage<WorkoutTemplate>;
    } | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const key = `${page}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .listWorkoutTemplates(page, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ key, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/templates' }),
          );
        else setFailure(key);
      });
    return () => controller.abort();
  }, [page, key, router]);
  const data = resource?.key === key ? resource.data : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="templates" />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Your active workout plans. Archived templates are not listed by
              the current API.
            </p>
          </div>
          <Link href="/templates/new" className={buttonClass}>
            Create template
          </Link>
        </div>
        {data ? (
          <>
            <TemplateListCards items={data.items} />
            {data.totalPages > 1 && (
              <nav
                aria-label="Template pages"
                className="mt-6 flex flex-wrap items-center justify-between gap-3"
              >
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((value) => value - 1)}
                  className={buttonClass}
                >
                  Previous templates
                </button>
                <span className="text-sm text-slate-500">
                  Page {data.page} of {data.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  className={buttonClass}
                >
                  Next templates
                </button>
              </nav>
            )}
          </>
        ) : failure === key ? (
          <WorkoutError
            title="Templates unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          <WorkoutLoading label="Loading templates..." />
        )}
      </main>
    </div>
  );
}
