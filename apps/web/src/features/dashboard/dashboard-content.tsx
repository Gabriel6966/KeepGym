import Link from 'next/link';
import type { DashboardSummary, ExercisePerformance } from './dashboard.types';
import { formatDate, formatDuration, formatKg, formatNumber } from './format';
import { EmptyState, Metric, Section } from './dashboard.ui';
import {
  WeeklyComparisonVisualization,
  MuscleGroupVisualization,
  BodyProgressVisualization,
} from './dashboard-visualizations';
function PerformanceDetails({
  value,
  title,
  timezone,
  locale,
}: {
  value: ExercisePerformance | null;
  title: string;
  timezone: string;
  locale?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </h4>
      {value ? (
        <>
          <time
            dateTime={value.startedAt}
            className="mt-1 block text-xs text-slate-500"
          >
            {formatDate(value.startedAt, timezone, locale)}
          </time>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Metric
              label="Sets"
              value={formatNumber(value.completedSets, locale)}
            />
            <Metric
              label="Reps"
              value={formatNumber(value.totalReps, locale)}
            />
            <Metric
              label="Volume"
              value={formatKg(value.totalVolumeKg, locale)}
            />
            <Metric
              label="Max load"
              value={formatKg(value.maxLoadKg, locale)}
            />
            <Metric
              label="Estimated 1RM"
              value={formatKg(value.bestEstimated1RMKg, locale)}
            />
          </dl>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No previous performance.</p>
      )}
    </div>
  );
}
export function DashboardContent({
  summary,
  locale,
}: {
  summary: DashboardSummary;
  locale?: string;
}) {
  const { week, comparison, consistency, timezone } = summary;
  const number = (value: number | null) => formatNumber(value, locale);
  const kg = (value: number | null) => formatKg(value, locale);
  const date = (value: string) => formatDate(value, timezone, locale);
  const duration = (value: number | null) => formatDuration(value, locale);
  return (
    <div className="space-y-6">
      <section aria-labelledby="weekly-overview">
        <h2
          id="weekly-overview"
          className="mb-4 text-lg font-semibold tracking-tight"
        >
          Weekly overview
        </h2>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['Completed workouts', number(week.completedWorkouts)],
            ['Completed sets', number(week.completedSets)],
            ['Total reps', number(week.totalReps)],
            ['External volume', kg(week.totalVolumeKg)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-3 text-2xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['Active days', number(week.activeDays)],
            ['Total duration', duration(week.totalDurationSeconds)],
            ['Average duration', duration(week.averageDurationSeconds)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Section
          id="weekly-comparison"
          title="Weekly comparison"
          description={
            'Against the week of ' +
            comparison.previousWeekStart +
            '. Changes are descriptive, not a rating.'
          }
        >
          <WeeklyComparisonVisualization
            week={week}
            comparison={comparison}
            locale={locale}
          />
          <p className="mt-4 text-xs text-slate-500">
            Current is the selected week. Each metric uses its own visual scale.
            — means the percentage is undefined because the previous value was
            zero.
          </p>
        </Section>
        <Section
          id="consistency"
          title="Weekly consistency"
          description={`${consistency.windowWeeks}-week window · ${consistency.fromWeekStart} to ${consistency.toWeekStart}`}
        >
          <dl className="grid grid-cols-3 gap-4">
            <Metric
              label="Active weeks"
              value={number(consistency.activeWeeks)}
            />
            <Metric
              label="Longest weekly streak"
              value={number(consistency.longestWeeklyStreak)}
            />
            <Metric
              label="Ending weekly streak"
              value={number(consistency.endingWeeklyStreak)}
            />
          </dl>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            The ending streak finishes exactly in the selected week. No
            current-week grace period is applied.
          </p>
        </Section>
      </div>
      <Section
        id="muscle-groups"
        title="Muscle groups"
        description="Selected week · primary muscle only. Secondary muscles are not counted."
      >
        <MuscleGroupVisualization
          groups={summary.muscleGroups}
          locale={locale}
        />
      </Section>
      <Section
        id="recent-workouts"
        title="Recent workouts"
        description="Latest completed sessions · all time, independent of the selected week."
      >
        {summary.recentWorkouts.length === 0 ? (
          <EmptyState>No completed workouts yet.</EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {summary.recentWorkouts.map((workout) => (
              <li
                key={workout.id}
                className="min-w-0 rounded-lg border border-slate-200 p-4"
              >
                <h3 className="font-semibold text-slate-800 [overflow-wrap:anywhere]">
                  <Link
                    href={'/history/' + encodeURIComponent(workout.id)}
                    className="rounded focus-visible:outline-2 focus-visible:outline-teal-700 hover:underline"
                    aria-label={'View history of ' + workout.name}
                  >
                    {workout.name}
                  </Link>
                </h3>
                <time
                  dateTime={workout.startedAt}
                  className="mt-1 block text-xs text-slate-500"
                >
                  {date(workout.startedAt)}
                </time>
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label="Duration"
                    value={
                      <span
                        title={
                          formatNumber(workout.durationSeconds, locale, 3) +
                          ' seconds'
                        }
                      >
                        {duration(workout.durationSeconds)}
                      </span>
                    }
                  />
                  <Metric label="Sets" value={number(workout.completedSets)} />
                  <Metric label="Reps" value={number(workout.totalReps)} />
                  <Metric label="Volume" value={kg(workout.totalVolumeKg)} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="exercise-highlights"
        title="Exercise highlights"
        description="Recently performed exercises · per-performance metrics, not all-time records."
      >
        {summary.exerciseHighlights.length === 0 ? (
          <EmptyState>No exercise performance yet.</EmptyState>
        ) : (
          <ul className="space-y-5">
            {summary.exerciseHighlights.map((item) => (
              <li key={item.exercise.sourceExerciseId}>
                <h3 className="mb-3 font-semibold text-slate-800 [overflow-wrap:anywhere]">
                  {item.exercise.name}
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <PerformanceDetails
                    title="Latest"
                    value={item.latest}
                    timezone={timezone}
                    locale={locale}
                  />
                  <PerformanceDetails
                    title="Previous"
                    value={item.previous}
                    timezone={timezone}
                    locale={locale}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="personal-records"
        title="Personal records"
        description="Current all-time holders · achievement dates reflect the first attainment, not PR events."
      >
        {summary.personalRecords.length === 0 ? (
          <EmptyState>No personal records yet.</EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {summary.personalRecords.map((record) => (
              <li
                key={record.type + ':' + record.exercise.sourceExerciseId}
                className="min-w-0 rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                    {record.exercise.name}
                  </h3>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                    {record.type === 'MAX_LOAD' ? 'Max load' : 'Estimated 1RM'}
                  </span>
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">
                  {kg(record.valueKg)}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Holder: {kg(record.loadKg)} × {number(record.reps)} reps
                </p>
                <time
                  dateTime={record.achievedAt}
                  className="mt-2 block text-xs text-slate-500"
                >
                  Achieved {date(record.achievedAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="body-progress"
        title="Body progress"
        description="Latest known observations · each metric has its own timeline. Canonical kg, cm and %."
      >
        <Link
          href="/body"
          className="mb-5 inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          Manage measurements
        </Link>
        <BodyProgressVisualization
          progress={summary.bodyProgress}
          timezone={timezone}
          locale={locale}
        />
        <p className="mt-4 text-xs text-slate-500">
          Body-fat changes are shown in percentage points (pp). No health or
          progress rating is inferred.
        </p>
      </Section>
    </div>
  );
}
