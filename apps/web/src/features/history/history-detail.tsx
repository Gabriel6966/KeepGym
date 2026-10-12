'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import { HistoryDetailContent } from './history-content';
import type { WorkoutHistoryDetail } from './history.types';

export function HistoryDetail({ workoutId }: { workoutId: string }) {
  const router = useRouter();
  const [retry, setRetry] = useState(0),
    [result, setResult] = useState<{
      key: number;
      data: WorkoutHistoryDetail;
    } | null>(null),
    [failure, setFailure] = useState<{
      key: number;
      unavailable: boolean;
    } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .getWorkoutHistory(workoutId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: retry, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' +
              new URLSearchParams({
                returnTo: '/history/' + encodeURIComponent(workoutId),
              }),
          );
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
    return () => controller.abort();
  }, [workoutId, retry, router]);
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="history" />
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {result?.key === retry ? (
          <HistoryDetailContent workout={result.data} />
        ) : (
          <>
            <h1 className="mb-6 text-3xl font-semibold">Workout history</h1>
            {failure?.key === retry ? (
              <WorkoutError
                title="Workout history unavailable"
                onRetry={() => setRetry((value) => value + 1)}
              >
                {failure.unavailable
                  ? 'This historical workout is not available to your account. Active sessions belong to Workout.'
                  : undefined}
              </WorkoutError>
            ) : (
              <WorkoutLoading label="Loading historical workout..." />
            )}
            <Link href="/history" className={buttonClass + ' mt-5'}>
              Back to History
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
