import { ApiError } from '../../lib/api-client';

export function ambiguousBodyWrite(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'network' ||
      (error.kind === 'response' && error.status === undefined))
  );
}
export function bodyMutationMessage(error: unknown): string {
  if (ambiguousBodyWrite(error))
    return 'The result could not be confirmed. Reload before making another change; this write will not be repeated automatically.';
  if (error instanceof ApiError && error.status === 400)
    return 'The server rejected these values or their timestamp. Check the fields or reload. A measurement must retain at least one metric.';
  if (error instanceof ApiError && error.status === 404)
    return 'This measurement is unavailable. Reload to check its current state.';
  return 'Unable to save this change. Please try again.';
}
