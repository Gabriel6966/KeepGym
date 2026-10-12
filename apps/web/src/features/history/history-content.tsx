import Link from 'next/link';
import { buttonClass, EmptyState, Metric } from '../dashboard/dashboard.ui';
import { formatKg, formatNumber } from '../dashboard/format';
import type { SessionExercise } from '../workout/workout.types';
import type {
  WorkoutHistoryDetail,
  WorkoutHistorySummary,
} from './history.types';

export function HistoryTime({
  value,
  label,
}: {
  value: string | null;
  label?: string;
}) {
  return value === null ? (
    <span>—</span>
  ) : (
    <time dateTime={value}>
      {label}
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))}
    </time>
  );
}
export function HistoryCards({
  items,
  filtered,
}: {
  items: WorkoutHistorySummary[];
  filtered: boolean;
}) {
  return items.length === 0 ? (
    <EmptyState>
      {filtered ? (
        'No workouts match these filters.'
      ) : (
        <>
          No workout history yet.{' '}
          <Link href="/workout" className={buttonClass + ' mt-4'}>
            Start a workout
          </Link>
        </>
      )}
    </EmptyState>
  ) : (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((workout) => (
        <li
          key={workout.id}
          data-history-workout-id={workout.id}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]">
              {workout.name}
            </h2>
            <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold">
              {workout.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <Metric
              label="Started"
              value={<HistoryTime value={workout.startedAt} />}
            />
            <Metric
              label="Ended"
              value={<HistoryTime value={workout.endedAt} />}
            />
            <Metric
              label="Exercises"
              value={formatNumber(workout.exerciseCount)}
            />
            <Metric
              label="Recorded sets"
              value={formatNumber(workout.setCount)}
            />
          </dl>
          <Link
            href={'/history/' + encodeURIComponent(workout.id)}
            aria-label={'View history of ' + workout.name}
            className={buttonClass + ' mt-5'}
          >
            View workout
          </Link>
        </li>
      ))}
    </ul>
  );
}
function HistoricalExercise({ entry }: { entry: SessionExercise }) {
  return (
    <li
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      data-history-exercise-id={entry.id}
    >
      <p className="text-xs font-semibold text-slate-500">
        Exercise {entry.position}
      </p>
      <h3 className="mt-1 text-xl font-semibold [overflow-wrap:anywhere]">
        {entry.exercise.name}
      </h3>
      <p className="mt-2 text-xs text-slate-500">
        {entry.exercise.primaryMuscle} ·{' '}
        {entry.exercise.equipment.replaceAll('_', ' ')} ·{' '}
        {entry.exercise.movementPattern.replaceAll('_', ' ')}
      </p>
      <p className="mt-3 text-sm text-slate-600">
        Planned: {entry.plannedSets} sets × {entry.plannedRepsMin}–
        {entry.plannedRepsMax} reps · {entry.plannedRestSeconds}s rest
      </p>
      {entry.plannedNotes && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
          {entry.plannedNotes}
        </p>
      )}
      {entry.sets.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">No sets recorded.</p>
      ) : (
        <ol className="mt-5 space-y-3">
          {entry.sets.map((set) => (
            <li
              key={set.id}
              data-history-set-id={set.id}
              className="rounded-lg border border-slate-200 p-4"
            >
              <h4 className="text-sm font-semibold">Set {set.position}</h4>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric label="Load" value={formatKg(set.loadKg)} />
                <Metric label="Reps" value={formatNumber(set.reps)} />
                <Metric label="RPE" value={formatNumber(set.rpe)} />
                <Metric label="RIR" value={formatNumber(set.rir)} />
              </dl>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
export function HistoryDetailContent({
  workout,
}: {
  workout: WorkoutHistoryDetail;
}) {
  return (
    <>
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">
          Workout history · read-only
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {workout.name}
        </h1>
        <p role="status" className="mt-3 font-semibold">
          {workout.status === 'COMPLETED'
            ? 'Completed workout'
            : 'Cancelled workout'}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <Metric
            label="Started"
            value={<HistoryTime value={workout.startedAt} />}
          />
          <Metric
            label="Ended"
            value={<HistoryTime value={workout.endedAt} />}
          />
        </dl>
        {workout.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600 [overflow-wrap:anywhere]">
            {workout.notes}
          </p>
        )}
        <Link href="/history" className={buttonClass + ' mt-5'}>
          Back to History
        </Link>
      </div>
      <section aria-labelledby="historical-exercises">
        <h2 id="historical-exercises" className="mb-4 text-xl font-semibold">
          Historical exercises
        </h2>
        {workout.exercises.length === 0 ? (
          <EmptyState>No exercises recorded.</EmptyState>
        ) : (
          <ol className="space-y-5">
            {workout.exercises.map((entry) => (
              <HistoricalExercise key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
