import { isDashboardSummary } from '../features/dashboard/dashboard.contract';
import {
  canonicalBrowserTimezone,
  isDashboardWeek,
} from '../features/dashboard/calendar';
import type { DashboardSummary } from '../features/dashboard/dashboard.types';

export class ApiError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'network' | 'response' | 'configuration',
  ) {
    super(
      kind === 'unauthorized'
        ? 'Authentication required.'
        : 'Unable to complete the request.',
    );
  }
}
function tokenFrom(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    value.accessToken &&
    'tokenType' in value &&
    value.tokenType === 'Bearer'
  )
    return value.accessToken;
  throw new ApiError('response');
}
export class ApiClient {
  // Access tokens never leave memory. The existing backend alone owns the
  // HttpOnly refresh cookie; fetch includes it only on matching cookie paths.
  private token: string | null = null;
  private refreshPromise: Promise<string> | null = null;
  constructor(
    private readonly baseUrl: string | undefined,
    // Keep the native browser fetch bound to its global receiver, not this client.
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
  ) {}
  private endpoint(path: string): string {
    try {
      if (!this.baseUrl) throw new Error();
      const url = new URL(this.baseUrl);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
      return this.baseUrl.replace(/\/+$/, '') + path;
    } catch {
      throw new ApiError('configuration');
    }
  }
  private async send(path: string, input: RequestInit): Promise<Response> {
    const url = this.endpoint(path);
    try {
      return await this.fetcher(url, {
        credentials: 'include',
        cache: 'no-store',
        ...input,
      });
    } catch (error: unknown) {
      if (input.signal?.aborted) throw error;
      throw new ApiError('network');
    }
  }
  private async json(response: Response): Promise<unknown> {
    if (response.status === 401) throw new ApiError('unauthorized');
    if (!response.ok) throw new ApiError('response');
    try {
      return await response.json();
    } catch {
      throw new ApiError('response');
    }
  }
  private refresh(expiredToken?: string): Promise<string> {
    // A delayed 401 may arrive after another request already refreshed.
    if (expiredToken && this.token && this.token !== expiredToken)
      return Promise.resolve(this.token);
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const result = await this.json(
            await this.send('/auth/refresh', { method: 'POST' }),
          );
          this.token = tokenFrom(result);
          return this.token;
        } catch (error: unknown) {
          this.token = null;
          throw error;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    return this.refreshPromise;
  }
  async login(email: string, password: string): Promise<void> {
    // Never overlap cookie rotation with a new login or logout.
    if (this.refreshPromise) await this.refreshPromise.catch(() => undefined);
    const result = await this.json(
      await this.send('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    this.token = tokenFrom(result);
  }
  async logout(): Promise<void> {
    if (this.refreshPromise) await this.refreshPromise.catch(() => undefined);
    const response = await this.send('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new ApiError('response');
    this.token = null;
  }
  async getDashboard(
    weekStart: string,
    timezone: string,
    signal?: AbortSignal,
  ): Promise<DashboardSummary> {
    if (
      !isDashboardWeek(weekStart) ||
      canonicalBrowserTimezone(timezone) !== timezone
    )
      throw new ApiError('configuration');
    const path =
      '/dashboard/summary?' + new URLSearchParams({ weekStart, timezone });
    let token = this.token ?? (await this.refresh());
    signal?.throwIfAborted();
    let response = await this.send(path, {
      headers: { authorization: 'Bearer ' + token },
      signal,
    });
    if (response.status === 401) {
      token = await this.refresh(token);
      signal?.throwIfAborted();
      response = await this.send(path, {
        headers: { authorization: 'Bearer ' + token },
        signal,
      });
    }
    if (response.status === 401) this.token = null;
    const result = await this.json(response);
    if (
      !isDashboardSummary(result) ||
      result.weekStart !== weekStart ||
      result.timezone !== timezone
    )
      throw new ApiError('response');
    return result;
  }
}
export const apiClient = new ApiClient(process.env.NEXT_PUBLIC_API_URL);
