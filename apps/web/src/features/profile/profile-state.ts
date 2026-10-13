import { ApiError } from '../../lib/api-client';
export function ambiguousProfileWrite(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'network' ||
      (error.kind === 'response' && error.status === undefined))
  );
}
export function profileMutationMessage(error: unknown): string {
  if (ambiguousProfileWrite(error))
    return 'The result could not be confirmed. Reload to reconcile before another write.';
  if (error instanceof ApiError && error.status === 400)
    return 'The server rejected these profile values. Check the fields and try again.';
  if (error instanceof ApiError && error.status === 409)
    return 'A profile may already exist. Reload to check before another attempt.';
  return 'Unable to save your profile. Please try again.';
}
