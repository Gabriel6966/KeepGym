import { ApiError } from '../../lib/api-client';
import type { SetEntry, WorkoutSession } from './workout.types';

// Synchronous admission also blocks two events before React has rendered disabled.
export function createSubmissionLock() {
  let held = false;
  return {
    acquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}
export function applyServerSet(
  session: WorkoutSession,
  exerciseId: string,
  set: SetEntry,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) =>
      exercise.id !== exerciseId
        ? exercise
        : {
            ...exercise,
            sets: [
              ...exercise.sets.filter((item) => item.id !== set.id),
              set,
            ].sort((a, b) => a.position - b.position),
          },
    ),
  };
}
export function mutationMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'The server rejected these values. Check the fields and try again.';
    if (error.status === 404)
      return 'This workout or set is no longer available. Reload the workout.';
    if (error.status === 409)
      return 'The workout changed or is no longer editable. Reload to check its current state.';
    if (error.kind === 'network')
      return 'The change could not be confirmed. Reload the workout before trying again.';
  }
  return 'Unable to save this change. Please try again.';
}
