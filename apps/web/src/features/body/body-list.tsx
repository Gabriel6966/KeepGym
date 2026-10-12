'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { bodyMetricKeys } from '../dashboard/dashboard.types';
import { buttonClass, EmptyState, Metric } from '../dashboard/dashboard.ui';
import { formatNumber } from '../dashboard/format';
import { HistoryTime } from '../history/history-content';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { ambiguousBodyWrite, bodyMutationMessage } from './body-state';
import {
  bodyFields,
  type BodyMeasurement,
  type BodyMeasurementPage,
} from './body.types';

export function MeasurementCards({
  items,
  pendingId,
  blocked,
  failure,
  onDelete,
}: {
  items: BodyMeasurement[];
  pendingId: string | null;
  blocked: boolean;
  failure: { id: string; message: string } | null;
  onDelete: (id: string) => void;
}) {
  const disabled = blocked || pendingId !== null;
  return items.length === 0 ? (
    <EmptyState>
      No body measurements yet.{' '}
      <Link href="/body/new" className={buttonClass + ' mt-4'}>
        Add measurement
      </Link>
    </EmptyState>
  ) : (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((measurement) => (
        <li
          key={measurement.id}
          data-measurement-id={measurement.id}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="font-semibold">
            <HistoryTime value={measurement.measuredAt} />
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            {bodyMetricKeys.map((key) =>
              measurement[key] === null ? null : (
                <Metric
                  key={key}
                  label={bodyFields[key].label}
                  value={
                    formatNumber(measurement[key]) + ' ' + bodyFields[key].unit
                  }
                />
              ),
            )}
          </dl>
          {measurement.notes && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
              {measurement.notes}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            {disabled ? (
              <span
                aria-disabled="true"
                className={buttonClass + ' opacity-50'}
              >
                Edit measurement
              </span>
            ) : (
              <Link
                href={'/body/' + encodeURIComponent(measurement.id) + '/edit'}
                className={buttonClass}
              >
                Edit measurement
              </Link>
            )}
            <button
              type="button"
              disabled={disabled}
              className={buttonClass + ' text-red-800'}
              onClick={() => onDelete(measurement.id)}
            >
              {pendingId === measurement.id
                ? 'Deleting...'
                : 'Delete measurement'}
            </button>
          </div>
          {failure?.id === measurement.id && (
            <p role="alert" className="mt-3 text-sm text-slate-700">
              {failure.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
export function BodyList() {
  const router = useRouter(),
    lock = useRef(createSubmissionLock()),
    mounted = useRef(true);
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [resource, setResource] = useState<{
      key: string;
      data: BodyMeasurementPage;
    } | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [pendingId, setPendingId] = useState<string | null>(null),
    [blocked, setBlocked] = useState(false),
    [deleteFailure, setDeleteFailure] = useState<{
      id: string;
      message: string;
    } | null>(null);
  const key = page + '|' + retry;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void apiClient
      .listBodyMeasurements({ page, limit: 20 }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          if (data.items.length === 0 && page > 1) {
            setPage(Math.max(1, data.totalPages));
            return;
          }
          setResource({ key, data });
          setBlocked(false);
          setDeleteFailure(null);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/body' }),
          );
        else setFailure(key);
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [page, key, router]);
  async function remove(id: string) {
    if (
      blocked ||
      pendingId !== null ||
      !window.confirm(
        'Delete this historical measurement permanently? Body progress will be recalculated by the backend.',
      ) ||
      !lock.current.acquire()
    )
      return;
    setPendingId(id);
    setDeleteFailure(null);
    try {
      await apiClient.deleteBodyMeasurement(id);
      if (mounted.current) setRetry((value) => value + 1);
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' + new URLSearchParams({ returnTo: '/body' }),
          );
        if (
          ambiguousBodyWrite(error) ||
          (error instanceof ApiError && error.status === 404)
        )
          setBlocked(true);
        setDeleteFailure({ id, message: bodyMutationMessage(error) });
      }
    } finally {
      lock.current.release();
      if (mounted.current) setPendingId(null);
    }
  }
  const data = resource?.key === key ? resource.data : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="body" />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Body measurements
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Partial historical observations. Missing metrics are not zero.
            </p>
          </div>
          <Link href="/body/new" className={buttonClass}>
            Add measurement
          </Link>
        </div>
        {data ? (
          <>
            <MeasurementCards
              items={data.items}
              pendingId={pendingId}
              blocked={blocked}
              failure={deleteFailure}
              onDelete={(id) => void remove(id)}
            />
            {blocked && (
              <div role="alert" className="mt-5 text-sm">
                <p>Reload the list before making another change.</p>
                <button
                  type="button"
                  className={buttonClass + ' mt-3'}
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Reload measurements
                </button>
              </div>
            )}
            {(data.totalPages > 1 || page > 1) && (
              <nav
                aria-label="Body measurement pages"
                className="mt-6 flex flex-wrap items-center justify-between gap-3"
              >
                <button
                  type="button"
                  className={buttonClass}
                  disabled={page === 1 || pendingId !== null || blocked}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous measurements
                </button>
                <span className="text-sm text-slate-500">
                  Page {data.page} · {data.totalPages} total pages
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={
                    page >= data.totalPages || pendingId !== null || blocked
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next measurements
                </button>
              </nav>
            )}
          </>
        ) : failure === key ? (
          <WorkoutError
            title="Body measurements unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          <WorkoutLoading label="Loading body measurements..." />
        )}
        <Link href="/dashboard" className={buttonClass + ' mt-6'}>
          Open Dashboard
        </Link>
      </main>
    </div>
  );
}
