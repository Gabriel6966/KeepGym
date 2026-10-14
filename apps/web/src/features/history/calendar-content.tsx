import Link from 'next/link';
import { buttonClass, Metric, Section } from '../dashboard/dashboard.ui';
import { formatDuration, formatKg, formatNumber } from '../dashboard/format';
import {
  formatCalendarDate,
  formatCalendarMonth,
  mondayFirstOffset,
  shiftCalendarMonth,
} from './calendar-month';
import type { CalendarDay, TrainingCalendar } from './calendar.types';

export function CalendarViewLink() {
  return (
    <Link href="/history/calendar" className={buttonClass}>
      Calendar view
    </Link>
  );
}
export function CalendarMonthControls({
  month,
  currentMonth,
  onMonth,
  locale,
}: {
  month: string;
  currentMonth: string;
  onMonth: (month: string) => void;
  locale?: string;
}) {
  const previous = shiftCalendarMonth(month, -1),
    next = shiftCalendarMonth(month, 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h2 id="calendar-month" className="text-xl font-semibold">
        {formatCalendarMonth(month, locale)}
      </h2>
      <nav aria-label="Calendar months" className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!previous}
          onClick={() => previous && onMonth(previous)}
        >
          Previous month
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onMonth(currentMonth)}
        >
          Current month
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!next}
          onClick={() => next && onMonth(next)}
        >
          Next month
        </button>
      </nav>
    </div>
  );
}
const weekdays = [
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
  ['Sun', 'Sunday'],
] as const;
export function CalendarDays({
  data,
  today,
  selected,
  onSelect,
  locale,
}: {
  data: TrainingCalendar;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
  locale?: string;
}) {
  const leading = mondayFirstOffset(data.fromDate),
    trailing = (7 - ((leading + data.days.length) % 7)) % 7;
  return (
    <section
      aria-labelledby="calendar-month"
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 sm:p-5"
    >
      <p className="mb-4 px-1 text-xs leading-5 text-slate-500">
        Each day shows its date and completed workout count. Select a day for
        details.
      </p>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {weekdays.map(([short, full]) => (
          <div
            key={short}
            className="pb-2 text-center text-xs font-medium text-slate-600"
          >
            <abbr title={full} className="no-underline">
              {short}
            </abbr>
          </div>
        ))}
        {Array.from({ length: leading }, (_, index) => (
          <div
            key={'before-' + index}
            aria-hidden="true"
            data-calendar-placeholder
            className="rounded-md bg-slate-50"
          />
        ))}
        {data.days.map((day) => (
          <button
            key={day.date}
            type="button"
            data-calendar-date={day.date}
            aria-label={`${formatCalendarDate(day.date, locale)}: ${formatNumber(day.completedWorkouts, locale)} completed ${day.completedWorkouts === 1 ? 'workout' : 'workouts'}`}
            aria-pressed={selected === day.date}
            aria-current={day.date === today ? 'date' : undefined}
            onClick={() => onSelect(day.date)}
            className={
              'flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border px-0.5 py-3 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:min-h-24 ' +
              (selected === day.date
                ? 'border-slate-800 bg-slate-800 text-white '
                : day.completedWorkouts > 0
                  ? 'border-teal-200 bg-teal-50 text-slate-900 hover:bg-teal-100 '
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 ') +
              (day.date === today
                ? 'underline decoration-2 underline-offset-4'
                : '')
            }
          >
            <span className="text-sm font-semibold sm:text-base">
              {Number(day.date.slice(8))}
            </span>
            <span className="text-xs">
              <span>{formatNumber(day.completedWorkouts, locale)}</span>
              <span className="hidden sm:inline">
                {' '}
                {day.completedWorkouts === 1 ? 'workout' : 'workouts'}
              </span>
            </span>
          </button>
        ))}
        {Array.from({ length: trailing }, (_, index) => (
          <div
            key={'after-' + index}
            aria-hidden="true"
            data-calendar-placeholder
            className="rounded-md bg-slate-50"
          />
        ))}
      </div>
    </section>
  );
}
export function SelectedCalendarDay({
  day,
  locale,
}: {
  day: CalendarDay;
  locale?: string;
}) {
  return (
    <div data-selected-calendar-date={day.date} aria-live="polite">
      <Section
        id="calendar-day"
        title={formatCalendarDate(day.date, locale)}
        description="Completed activity on this local start date."
      >
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Completed workouts"
            value={formatNumber(day.completedWorkouts, locale)}
          />
          <Metric
            label="Completed sets"
            value={formatNumber(day.completedSets, locale)}
          />
          <Metric
            label="Total reps"
            value={formatNumber(day.totalReps, locale)}
          />
          <Metric
            label="Total volume"
            value={formatKg(day.totalVolumeKg, locale)}
          />
          <Metric
            label="Total duration"
            value={
              <>
                {formatDuration(day.totalDurationSeconds, locale)}
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  {formatNumber(day.totalDurationSeconds, locale, 3)} seconds
                </span>
              </>
            }
          />
        </dl>
      </Section>
    </div>
  );
}
export function CalendarLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <p className="text-sm text-slate-500">Loading training calendar...</p>
      <div
        aria-hidden="true"
        className="grid grid-cols-7 gap-1 rounded-xl border border-slate-200 bg-white p-2 sm:gap-2 sm:p-5"
      >
        {Array.from({ length: 35 }, (_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none sm:h-24"
          />
        ))}
      </div>
      <div aria-hidden="true" className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}
