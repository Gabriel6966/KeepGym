'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { MeasurementForm } from './body-form';
import { ambiguousBodyWrite } from './body-state';
import type { BodyMeasurement, BodyMeasurementInput } from './body.types';

export function BodyEditor({ measurementId }: { measurementId?: string }) {
  const router = useRouter(),
    lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  const [retry, setRetry] = useState(0),
    [resource, setResource] = useState<{
      key: number;
      measurement?: BodyMeasurement;
    } | null>(null),
    [failure, setFailure] = useState<{
      key: number;
      unavailable: boolean;
    } | null>(null),
    [pending, setPending] = useState(false),
    [blocked, setBlocked] = useState(false);
  const path = measurementId
    ? '/body/' + encodeURIComponent(measurementId) + '/edit'
    : '/body/new';
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const read = measurementId
      ? apiClient.getBodyMeasurement(measurementId, controller.signal)
      : apiClient
          .listBodyMeasurements({ limit: 1 }, controller.signal)
          .then(() => undefined);
    void read
      .then((measurement) => {
        if (!controller.signal.aborted) {
          setResource({ key: retry, measurement });
          setBlocked(false);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace('/login?' + new URLSearchParams({ returnTo: path }));
        else
          setFailure({
            key: retry,
            unavailable:
              error instanceof ApiError &&
              (error.status === 400 ||
                error.status === 403 ||
                error.status === 404),
          });
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [measurementId, path, retry, router]);
  async function save(input: BodyMeasurementInput): Promise<boolean> {
    if (resource?.key !== retry || blocked || !lock.current.acquire())
      return false;
    setPending(true);
    let accepted = false;
    try {
      if (measurementId)
        await apiClient.updateBodyMeasurement(measurementId, input);
      else await apiClient.createBodyMeasurement(input);
      accepted = true;
      if (mounted.current) router.push('/body');
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace('/login?' + new URLSearchParams({ returnTo: path }));
        if (ambiguousBodyWrite(error)) setBlocked(true);
        if (error instanceof ApiError && error.status === 404) {
          setResource(null);
          setFailure({ key: retry, unavailable: true });
        }
      }
      throw error;
    } finally {
      // Keep a confirmed write locked through navigation, not only its request.
      // A second click during a slow route transition must not create a duplicate.
      if (!accepted) {
        lock.current.release();
        if (mounted.current) setPending(false);
      }
    }
  }
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="body" />
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          {measurementId ? 'Edit measurement' : 'Add measurement'}
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Historical observations in kg, cm and %. No goals or analytics are
          calculated here.
        </p>
        {resource?.key === retry ? (
          <MeasurementForm
            key={retry}
            measurement={resource.measurement}
            disabled={pending || blocked}
            onSave={save}
          />
        ) : failure?.key === retry ? (
          <WorkoutError
            title="Measurement unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          >
            {failure.unavailable
              ? 'This measurement is not available to your account.'
              : undefined}
          </WorkoutError>
        ) : (
          <WorkoutLoading
            label={
              measurementId ? 'Loading measurement...' : 'Checking access...'
            }
          />
        )}
        {blocked && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm"
          >
            <p>
              {measurementId
                ? 'Reload before another change. Reload discards unsaved drafts.'
                : 'Creation may have succeeded. Check the refreshed list before creating another measurement.'}
            </p>
            {measurementId ? (
              <button
                type="button"
                className={buttonClass + ' mt-3'}
                onClick={() => setRetry((value) => value + 1)}
              >
                Reload measurement
              </button>
            ) : (
              <Link href="/body" className={buttonClass + ' mt-3'}>
                Reload measurements
              </Link>
            )}
          </div>
        )}
        <Link href="/body" className={buttonClass + ' mt-6'}>
          {measurementId ? 'Cancel edit' : 'Back to Body'}
        </Link>
      </main>
    </div>
  );
}
