import { authReturnPath } from './return-path';

export function onboardingPath(returnTo: string | null): string {
  const destination = authReturnPath(returnTo);
  return (
    '/onboarding' +
    (destination !== '/dashboard'
      ? '?' + new URLSearchParams({ returnTo: destination })
      : '')
  );
}
export function afterProfileCheck(
  exists: boolean,
  returnTo: string | null,
): string {
  return exists ? authReturnPath(returnTo) : onboardingPath(returnTo);
}
