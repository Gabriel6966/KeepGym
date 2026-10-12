import { isDashboardSummary } from '../features/dashboard/dashboard.contract';
import {
  canonicalBrowserTimezone,
  isDashboardWeek,
} from '../features/dashboard/calendar';
import type { DashboardSummary } from '../features/dashboard/dashboard.types';
import {
  isSetEntry,
  isWorkoutSession,
  isTemplatePage,
  isSessionPage,
} from '../features/workout/workout.contract';
import type {
  ResourcePage,
  SetEntry,
  SetEntryInput,
  WorkoutSession,
  WorkoutSessionSummary,
  WorkoutTemplate,
} from '../features/workout/workout.types';

export class ApiError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'network' | 'response' | 'configuration',
    readonly status?: number,
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
    if (response.status === 401) throw new ApiError('unauthorized', 401);
    if (!response.ok) throw new ApiError('response', response.status);
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
    const result = await this.json(await this.authenticated(path, { signal }));
    if (
      !isDashboardSummary(result) ||
      result.weekStart !== weekStart ||
      result.timezone !== timezone
    )
      throw new ApiError('response');
    return result;
  }
  private async authenticated(
    path: string,
    input: RequestInit = {},
  ): Promise<Response> {
    const signal = input.signal;
    signal?.throwIfAborted();
    let token = this.token ?? (await this.refresh());
    signal?.throwIfAborted();
    const headers = new Headers(input.headers);
    headers.set('authorization', 'Bearer ' + token);
    let response = await this.send(path, {
      ...input,
      headers,
    });
    if (response.status === 401) {
      token = await this.refresh(token);
      signal?.throwIfAborted();
      headers.set('authorization', 'Bearer ' + token);
      response = await this.send(path, {
        ...input,
        headers,
      });
    }
    if (response.status === 401) this.token = null;
    return response;
  }
  private async request<T>(
    path: string,
    check: (v: unknown) => v is T,
    input: RequestInit = {},
  ): Promise<T> {
    const result = await this.json(await this.authenticated(path, input));
    if (!check(result)) throw new ApiError('response');
    return result;
  }
  listWorkoutTemplates(
    page = 1,
    signal?: AbortSignal,
  ): Promise<ResourcePage<WorkoutTemplate>> {
    return this.request(
      '/workout-templates?' +
        new URLSearchParams({ page: String(page), limit: '20' }),
      isTemplatePage,
      { signal },
    );
  }
  listInProgressWorkouts(
    signal?: AbortSignal,
  ): Promise<ResourcePage<WorkoutSessionSummary>> {
    return this.request(
      '/workout-sessions?status=IN_PROGRESS&page=1&limit=20',
      isSessionPage,
      { signal },
    );
  }
  startWorkout(workoutTemplateId: string): Promise<WorkoutSession> {
    return this.request(
      '/workout-sessions',
      isWorkoutSession,
      this.body('POST', { workoutTemplateId }),
    );
  }
  async getWorkoutSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<WorkoutSession> {
    const result = await this.request(
      this.sessionPath(sessionId),
      isWorkoutSession,
      { signal },
    );
    if (result.id !== sessionId) throw new ApiError('response');
    return result;
  }
  addSet(
    sessionId: string,
    exerciseId: string,
    input: SetEntryInput,
  ): Promise<SetEntry> {
    return this.request(
      this.setPath(sessionId, exerciseId),
      isSetEntry,
      this.body('POST', {
        loadKg: input.loadKg,
        reps: input.reps,
        rpe: input.rpe,
        rir: input.rir,
      }),
    );
  }
  updateSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
    input: Partial<SetEntryInput>,
  ): Promise<SetEntry> {
    return this.request(
      this.setPath(sessionId, exerciseId) + '/' + this.pathSegment(setId),
      isSetEntry,
      this.body('PATCH', {
        loadKg: input.loadKg,
        reps: input.reps,
        rpe: input.rpe,
        rir: input.rir,
      }),
    );
  }
  async deleteSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
  ): Promise<void> {
    const response = await this.authenticated(
      this.setPath(sessionId, exerciseId) + '/' + this.pathSegment(setId),
      { method: 'DELETE' },
    );
    if (response.status !== 204) {
      await this.json(response);
      throw new ApiError('response');
    }
  }
  completeWorkout(sessionId: string): Promise<WorkoutSession> {
    return this.request(
      this.sessionPath(sessionId) + '/complete',
      isWorkoutSession,
      { method: 'POST' },
    );
  }
  cancelWorkout(sessionId: string): Promise<WorkoutSession> {
    return this.request(
      this.sessionPath(sessionId) + '/cancel',
      isWorkoutSession,
      { method: 'POST' },
    );
  }
  private sessionPath(id: string): string {
    return '/workout-sessions/' + this.pathSegment(id);
  }
  private pathSegment(id: string): string {
    // Prevent URL normalization from turning an opaque ID into another route.
    // UUID/ownership validation remains exclusively the backend's responsibility.
    if (!id || id === '.' || id === '..') throw new ApiError('configuration');
    return encodeURIComponent(id);
  }
  private setPath(sessionId: string, exerciseId: string): string {
    return (
      this.sessionPath(sessionId) +
      '/exercises/' +
      this.pathSegment(exerciseId) +
      '/sets'
    );
  }
  private body(method: 'POST' | 'PATCH', value: object): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    };
  }
}
export const apiClient = new ApiClient(process.env.NEXT_PUBLIC_API_URL);
