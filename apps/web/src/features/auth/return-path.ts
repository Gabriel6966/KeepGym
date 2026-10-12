import { dashboardReturnPath } from '../dashboard/calendar';

export function authReturnPath(value: string | null): string {
  if (
    (value?.startsWith('/workout') || value?.startsWith('/templates')) &&
    !value.startsWith('//')
  ) {
    try {
      const url = new URL(value, 'https://return.invalid');
      if (
        url.origin === 'https://return.invalid' &&
        (url.pathname === '/workout' ||
          url.pathname === '/templates' ||
          /^\/(?:workout|templates)\/[^/]+$/.test(url.pathname))
      )
        return url.pathname;
    } catch {
      /* Fall through to the existing closed Dashboard return contract. */
    }
  }
  return dashboardReturnPath(value);
}
