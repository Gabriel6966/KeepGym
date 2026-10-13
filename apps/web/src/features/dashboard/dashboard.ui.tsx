import type { ReactNode } from 'react';

export const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="mb-5">
        <h2
          id={id}
          className="text-lg font-semibold tracking-tight text-slate-900"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-800 [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}
function Skeleton({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={
        'animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none ' +
        className
      }
    />
  );
}
export function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-6"
    >
      <span className="sr-only">Loading dashboard...</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div
          aria-hidden="true"
          className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-3 h-10" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-4">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-4 h-9" />
                <Skeleton className="mt-4 h-9" />
                <Skeleton className="mt-4 h-12" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-10" />
        </div>
        <Skeleton className="h-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-80" />
      <Skeleton className="h-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    </div>
  );
}
export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"
    >
      <h2 className="text-lg font-semibold">Dashboard unavailable</h2>
      <p className="mt-2 text-sm text-slate-600">
        We couldn&apos;t load your dashboard. Please try again.
      </p>
      <button type="button" className={buttonClass + ' mt-5'} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
