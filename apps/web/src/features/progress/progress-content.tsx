import Link from 'next/link';
import { EmptyState, Metric, buttonClass } from '../dashboard/dashboard.ui';
import { formatDate, formatKg, formatNumber } from '../dashboard/format';
import type {
  AnalyticsCandidate,
  EstimatedCandidate,
  ExerciseAnalytics,
  ExerciseRecord,
  ExerciseRecords,
} from './progress.types';

function WorkoutLink({ id, name }: { id: string; name?: string }) {
  return (
    <Link
      href={'/history/' + encodeURIComponent(id)}
      className={buttonClass + ' mt-4'}
      aria-label={name ? 'View workout ' + name : undefined}
    >
      View workout
    </Link>
  );
}
function Candidate({
  value,
  title,
  timezone,
  locale,
}: {
  value: AnalyticsCandidate | EstimatedCandidate | null;
  title: string;
  timezone: string;
  locale?: string;
}) {
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 p-4">
      <h3 className="font-semibold">{title}</h3>
      {value ? (
        <>
          <p className="mt-3 text-lg font-semibold">
            {'estimated1RMKg' in value
              ? formatKg(value.estimated1RMKg, locale)
              : formatKg(value.loadKg, locale)}
          </p>
          <p className="mt-1 text-sm">
            {formatKg(value.loadKg, locale)} ×{' '}
            {formatNumber(value.reps, locale)} reps
          </p>
          <p className="mt-2 text-sm text-slate-500 [overflow-wrap:anywhere]">
            {value.sessionName}
          </p>
          <time
            className="mt-1 block text-xs text-slate-500"
            dateTime={value.completedAt}
          >
            {formatDate(value.completedAt, timezone, locale)}
          </time>
          <WorkoutLink id={value.sessionId} name={value.sessionName} />
        </>
      ) : (
        <p className="mt-3">—</p>
      )}
    </article>
  );
}
export function ProgressSummary({
  analytics,
  timezone,
  locale,
}: {
  analytics: ExerciseAnalytics;
  timezone: string;
  locale?: string;
}) {
  return (
    <>
      <dl className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Metric
          label="Completed occurrences"
          value={formatNumber(analytics.summary.sessions, locale)}
        />
        <Metric
          label="Recorded sets"
          value={formatNumber(analytics.summary.sets, locale)}
        />
        <Metric
          label="Total reps"
          value={formatNumber(analytics.summary.reps, locale)}
        />
        <Metric
          label="Total volume"
          value={formatKg(analytics.summary.totalVolumeKg, locale)}
        />
        <Metric
          label="Max load"
          value={formatKg(analytics.summary.maxLoadKg, locale)}
        />
        <Metric
          label="Max estimated 1RM"
          value={formatKg(analytics.summary.maxEstimated1RMKg, locale)}
        />
      </dl>
      {analytics.summary.sets === 0 && (
        <p className="mb-4 text-sm text-slate-500">
          No completed set performance yet.
        </p>
      )}
      <p className="mb-4 text-xs text-slate-500">
        Occurrences without sets count here. Analytics selects these sets;
        record ownership is shown separately.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Candidate
          title="Heaviest set"
          value={analytics.heaviestSet}
          timezone={timezone}
          locale={locale}
        />
        <Candidate
          title="Best estimated 1RM set"
          value={analytics.bestEstimated1RMSet}
          timezone={timezone}
          locale={locale}
        />
      </div>
    </>
  );
}
function RecordCard({
  record,
  timezone,
  locale,
}: {
  record: ExerciseRecord;
  timezone: string;
  locale?: string;
}) {
  return (
    <article
      data-progress-record={record.type}
      className="min-w-0 rounded-lg border border-slate-200 p-4"
    >
      <h3 className="font-semibold">
        {record.type === 'MAX_LOAD' ? 'Max load' : 'Estimated 1RM'}
      </h3>
      <p className="mt-3 text-2xl font-semibold">
        {formatKg(record.valueKg, locale)}
      </p>
      <p className="mt-2 text-sm">
        Holder: {formatKg(record.set.loadKg, locale)} ×{' '}
        {formatNumber(record.set.reps, locale)} reps
      </p>
      <time
        className="mt-2 block text-xs text-slate-500"
        dateTime={record.achievedAt}
      >
        First achieved {formatDate(record.achievedAt, timezone, locale)}
      </time>
      <p className="mt-2 text-sm [overflow-wrap:anywhere]">
        {record.session.name}
      </p>
      <WorkoutLink id={record.session.id} name={record.session.name} />
    </article>
  );
}
export function ProgressRecords({
  records,
  timezone,
  locale,
}: {
  records: ExerciseRecords;
  timezone: string;
  locale?: string;
}) {
  const holders = [records.maxLoadRecord, records.estimated1RMRecord].filter(
    (record): record is ExerciseRecord => record !== null,
  );
  return holders.length === 0 ? (
    <EmptyState>No eligible current records.</EmptyState>
  ) : (
    <div className="grid gap-4 sm:grid-cols-2">
      {holders.map((record) => (
        <RecordCard
          key={record.type}
          record={record}
          timezone={timezone}
          locale={locale}
        />
      ))}
    </div>
  );
}
export function ProgressPerformances({
  analytics,
  timezone,
  locale,
}: {
  analytics: ExerciseAnalytics;
  timezone: string;
  locale?: string;
}) {
  return analytics.performances.length === 0 ? (
    <EmptyState>No completed occurrences on this page.</EmptyState>
  ) : (
    <ol className="space-y-4">
      {analytics.performances.map((performance) => (
        <li
          key={performance.sessionExerciseId}
          data-progress-performance-id={performance.sessionExerciseId}
          className="min-w-0 rounded-lg border border-slate-200 p-4"
        >
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {performance.sessionName}
          </h3>
          <p className="mt-1 text-sm [overflow-wrap:anywhere]">
            {performance.exercise.name}
          </p>
          <time
            className="mt-1 block text-xs text-slate-500"
            dateTime={performance.startedAt}
          >
            {formatDate(performance.startedAt, timezone, locale)}
          </time>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric
              label="Sets"
              value={formatNumber(performance.setCount, locale)}
            />
            <Metric
              label="Reps"
              value={formatNumber(performance.repCount, locale)}
            />
            <Metric
              label="Volume"
              value={formatKg(performance.volumeKg, locale)}
            />
            <Metric
              label="Max load"
              value={formatKg(performance.maxLoadKg, locale)}
            />
            <Metric
              label="Max estimated 1RM"
              value={formatKg(performance.maxEstimated1RMKg, locale)}
            />
          </dl>
          {performance.sets.length === 0 ? (
            <p className="mt-4 text-sm">No sets recorded.</p>
          ) : (
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer rounded py-3 font-medium focus-visible:outline-2 focus-visible:outline-teal-700">
                Recorded sets
              </summary>
              <ol className="mt-3 space-y-3">
                {performance.sets.map((set) => (
                  <li
                    key={set.id}
                    data-progress-set-id={set.id}
                    className="rounded-lg bg-slate-50 p-3"
                  >
                    <h4 className="text-sm font-semibold">
                      Set {set.position}
                    </h4>
                    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <Metric
                        label="Load"
                        value={formatKg(set.loadKg, locale)}
                      />
                      <Metric
                        label="Reps"
                        value={formatNumber(set.reps, locale)}
                      />
                      <Metric
                        label="RPE"
                        value={formatNumber(set.rpe, locale)}
                      />
                      <Metric
                        label="RIR"
                        value={formatNumber(set.rir, locale)}
                      />
                      <Metric
                        label="Estimated 1RM"
                        value={formatKg(set.estimated1RMKg, locale)}
                      />
                    </dl>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <WorkoutLink
            id={performance.sessionId}
            name={performance.sessionName}
          />
        </li>
      ))}
    </ol>
  );
}
