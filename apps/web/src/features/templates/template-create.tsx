'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import { TemplateMetadataForm } from './template-forms';
import { ambiguousWrite } from './templates.state';
import type { TemplateMetadataInput } from './templates.types';

export function TemplateCreate() {
  const router = useRouter(),
    lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  const [pending, setPending] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0),
    [authorized, setAuthorized] = useState<number | null>(null),
    [failure, setFailure] = useState<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    // The existing bounded, owned list read authorizes the page without a second
    // auth mechanism or inspecting/storing access tokens in UI components.
    void apiClient
      .listWorkoutTemplates(1, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setAuthorized(retry);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/templates/new' }),
          );
        else setFailure(retry);
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [retry, router]);
  async function create(input: TemplateMetadataInput): Promise<boolean> {
    if (authorized !== retry || blocked || !lock.current.acquire())
      return false;
    setPending(true);
    try {
      const template = await apiClient.createWorkoutTemplate(input);
      if (mounted.current)
        router.push('/templates/' + encodeURIComponent(template.id));
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/templates/new' }),
          );
        if (ambiguousWrite(error)) setBlocked(true);
      }
      throw error;
    } finally {
      lock.current.release();
      if (mounted.current) setPending(false);
    }
  }
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="templates" />
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          Create template
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Start with a name. Add exercises and planning after creating the
          template.
        </p>
        {authorized === retry ? (
          <TemplateMetadataForm disabled={pending || blocked} onSave={create} />
        ) : failure === retry ? (
          <WorkoutError
            title="Templates unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          <WorkoutLoading label="Checking access..." />
        )}
        {blocked && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm"
          >
            <p>
              Creation may have succeeded. Check the refreshed list before
              creating another template; this write will not be repeated
              automatically.
            </p>
            <Link href="/templates" className={buttonClass + ' mt-3'}>
              Reload templates
            </Link>
          </div>
        )}
        <Link href="/templates" className={buttonClass + ' mt-6'}>
          Back to Templates
        </Link>
      </main>
    </div>
  );
}
