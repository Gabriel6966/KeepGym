import type { ReactNode } from 'react';
import { buttonClass } from '../dashboard/dashboard.ui';

export function WorkoutLoading({
  label = 'Loading workout...',
}: {
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <p className="text-sm text-slate-500">{label}</p>
      {[1, 2].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="h-52 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
export function WorkoutError({
  title,
  onRetry,
  children,
}: {
  title: string;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">
        {children ?? 'Unable to load this page. Please try again.'}
      </p>
      <button type="button" onClick={onRetry} className={buttonClass + ' mt-4'}>
        Retry
      </button>
    </div>
  );
}
export const inputClass =
  'mt-2 block min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-3 text-base tabular-nums outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-700 disabled:bg-slate-100';
