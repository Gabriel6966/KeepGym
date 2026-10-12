import { ApiError } from '../../lib/api-client';
import type {
  TemplateExercise,
  WorkoutTemplate,
} from '../workout/workout.types';

export function requestedMove(
  entries: TemplateExercise[],
  entryId: string,
  direction: -1 | 1,
): string[] | null {
  const index = entries.findIndex((entry) => entry.id === entryId),
    target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) return null;
  const ids = entries.map((entry) => entry.id),
    current = ids[index],
    neighbor = ids[target];
  if (current === undefined || neighbor === undefined) return null;
  ids[index] = neighbor;
  ids[target] = current;
  return ids;
}
export function applyTemplateExercise(
  template: WorkoutTemplate,
  entry: TemplateExercise,
): WorkoutTemplate {
  return {
    ...template,
    exercises: [
      ...template.exercises.filter((item) => item.id !== entry.id),
      entry,
    ].sort((a, b) => a.position - b.position),
  };
}
export function ambiguousWrite(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'network' ||
      (error.kind === 'response' && error.status === undefined))
  );
}
export function templateMutationMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (ambiguousWrite(error))
      return 'The result could not be confirmed. Reload before making another change.';
    if (error.status === 400)
      return 'The server rejected these values. Check the fields and try again.';
    if (error.status === 404)
      return 'The template or exercise is unavailable. Reload to check its current state.';
    if (error.status === 409)
      return 'The template changed or this exercise is already present. Reload to check before retrying.';
  }
  return 'Unable to save this change. Please try again.';
}
