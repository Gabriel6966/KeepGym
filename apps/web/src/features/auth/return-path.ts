import { dashboardReturnPath } from '../dashboard/calendar';
import { historyUrl, normalizeHistoryUrl } from '../history/history-query';
import { safeProgressReturn } from '../progress/progress-query';

export function authReturnPath(value: string | null): string {
  if (value?.startsWith('/progress') && !value.startsWith('//')) {
    try {
      const url = new URL(value, 'https://return.invalid');
      if (url.origin === 'https://return.invalid') {
        const path = safeProgressReturn(url);
        if (path) return path;
      }
    } catch {
      /* Fall back to a closed safe destination. */
    }
  }
  if (value?.startsWith('/profile') && !value.startsWith('//')) {
    try {
      const url = new URL(value, 'https://return.invalid');
      if (
        url.origin === 'https://return.invalid' &&
        url.pathname === '/profile'
      )
        return '/profile';
    } catch {
      /* Keep the closed existing return contract. */
    }
  }
  if (
    (value?.startsWith('/workout') ||
      value?.startsWith('/templates') ||
      value?.startsWith('/history') ||
      value?.startsWith('/body')) &&
    !value.startsWith('//')
  ) {
    try {
      const url = new URL(value, 'https://return.invalid');
      if (
        url.origin === 'https://return.invalid' &&
        (url.pathname === '/body' ||
          url.pathname === '/body/new' ||
          /^\/body\/[^/]+\/edit$/.test(url.pathname))
      )
        return url.pathname;
      if (
        url.origin === 'https://return.invalid' &&
        url.pathname === '/history'
      )
        return historyUrl(normalizeHistoryUrl(url.searchParams));
      if (
        url.origin === 'https://return.invalid' &&
        (url.pathname === '/workout' ||
          url.pathname === '/templates' ||
          /^\/(?:workout|templates|history)\/[^/]+$/.test(url.pathname))
      )
        return url.pathname;
    } catch {
      /* Fall through to the existing closed Dashboard return contract. */
    }
  }
  return dashboardReturnPath(value);
}
