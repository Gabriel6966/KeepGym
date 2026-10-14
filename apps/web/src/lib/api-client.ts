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
  isWorkoutTemplate,
  isTemplateExercise,
} from '../features/workout/workout.contract';
import type {
  ResourcePage,
  SetEntry,
  SetEntryInput,
  WorkoutSession,
  WorkoutSessionSummary,
  WorkoutTemplate,
  TemplateExercise,
} from '../features/workout/workout.types';
import { isCatalogPage } from '../features/templates/templates.contract';
import type {
  AddTemplateExerciseInput,
  CatalogExercise,
  CatalogQuery,
  PlanningInput,
  TemplateMetadataInput,
} from '../features/templates/templates.types';
import {
  isHistoryPage,
  isHistoryDetail,
} from '../features/history/history.contract';
import {
  historyTimestamp,
  validHistoryPagination,
} from '../features/history/history-query';
import {
  historyStatuses,
  type WorkoutHistoryQuery,
  type WorkoutHistoryPage,
  type WorkoutHistoryDetail,
} from '../features/history/history.types';
import {
  isBodyMeasurement,
  isBodyMeasurementPage,
} from '../features/body/body.contract';
import type {
  BodyMeasurement,
  BodyMeasurementInput,
  BodyMeasurementPage,
  BodyMeasurementQuery,
} from '../features/body/body.types';
import {
  isProfile,
  isMissingProfileResponse,
} from '../features/profile/profile.contract';
import type {
  Profile,
  ProfileInput,
  ProfileChanges,
} from '../features/profile/profile.types';
import {
  isExerciseAnalytics,
  isExerciseRecords,
  isExerciseWeeklyTrends,
} from '../features/progress/progress.contract';
import type {
  ExerciseAnalytics,
  ExerciseRecords,
  ExerciseWeeklyTrends,
  WeeklyQuery,
} from '../features/progress/progress.types';
import {
  isWeeklyTraining,
  isWeeklyConsistency,
  isWeeklyDuration,
} from '../features/progress/training.contract';
import { validConsistencyQuery } from '../features/progress/training-query';
import type {
  ConsistencyQuery,
  WeeklyTraining,
  WeeklyConsistency,
  WeeklyDuration,
} from '../features/progress/training.types';

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
  async register(email: string, password: string): Promise<void> {
    if (this.refreshPromise) await this.refreshPromise.catch(() => undefined);
    const result = await this.json(
      await this.send('/auth/register', this.body('POST', { email, password })),
    );
    this.token = tokenFrom(result);
  }
  async getProfile(signal?: AbortSignal): Promise<Profile | null> {
    const response = await this.authenticated('/profile', { signal });
    if (response.status === 404) {
      let missing: unknown;
      try {
        missing = await response.json();
      } catch {
        throw new ApiError('response', 404);
      }
      if (isMissingProfileResponse(missing)) return null;
      throw new ApiError('response', 404);
    }
    const result = await this.json(response);
    if (!isProfile(result)) throw new ApiError('response');
    return result;
  }
  createProfile(input: ProfileInput): Promise<Profile> {
    return this.request(
      '/profile',
      isProfile,
      this.body('POST', this.profileBody(input)),
    );
  }
  updateProfile(input: ProfileChanges): Promise<Profile> {
    return this.request(
      '/profile',
      isProfile,
      this.body('PATCH', this.profileBody(input)),
    );
  }
  private profileBody(input: ProfileChanges) {
    return {
      displayName: input.displayName,
      birthDate: input.birthDate,
      heightCm: input.heightCm,
      experienceLevel: input.experienceLevel,
      trainingGoal: input.trainingGoal,
      unitSystem: input.unitSystem,
    };
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
  listBodyMeasurements(
    query: BodyMeasurementQuery = {},
    signal?: AbortSignal,
  ): Promise<BodyMeasurementPage> {
    const page = query.page ?? 1,
      limit = query.limit ?? 20;
    if (
      !validHistoryPagination(page, limit) ||
      (query.from !== undefined && !historyTimestamp(query.from)) ||
      (query.to !== undefined && !historyTimestamp(query.to)) ||
      (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
    )
      throw new ApiError('configuration');
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    for (const key of ['from', 'to'] as const)
      if (query[key] !== undefined) params.set(key, query[key]);
    return this.request('/body-measurements?' + params, isBodyMeasurementPage, {
      signal,
    });
  }
  async getBodyMeasurement(
    id: string,
    signal?: AbortSignal,
  ): Promise<BodyMeasurement> {
    const measurement = await this.request(
      '/body-measurements/' + this.pathSegment(id),
      isBodyMeasurement,
      { signal },
    );
    if (measurement.id !== id) throw new ApiError('response');
    return measurement;
  }
  createBodyMeasurement(input: BodyMeasurementInput): Promise<BodyMeasurement> {
    return this.request(
      '/body-measurements',
      isBodyMeasurement,
      this.body('POST', this.measurementBody(input)),
    );
  }
  async updateBodyMeasurement(
    id: string,
    input: BodyMeasurementInput,
  ): Promise<BodyMeasurement> {
    const measurement = await this.request(
      '/body-measurements/' + this.pathSegment(id),
      isBodyMeasurement,
      this.body('PATCH', this.measurementBody(input)),
    );
    if (measurement.id !== id) throw new ApiError('response');
    return measurement;
  }
  deleteBodyMeasurement(id: string): Promise<void> {
    return this.noContent('/body-measurements/' + this.pathSegment(id));
  }
  private measurementBody(input: BodyMeasurementInput) {
    return {
      measuredAt: input.measuredAt,
      weightKg: input.weightKg,
      bodyFatPercent: input.bodyFatPercent,
      waistCm: input.waistCm,
      chestCm: input.chestCm,
      hipsCm: input.hipsCm,
      notes: input.notes,
    };
  }
  listWorkoutHistory(
    query: WorkoutHistoryQuery = {},
    signal?: AbortSignal,
  ): Promise<WorkoutHistoryPage> {
    const page = query.page ?? 1,
      limit = query.limit ?? 20;
    if (
      !validHistoryPagination(page, limit) ||
      (query.status !== undefined && !historyStatuses.includes(query.status)) ||
      (query.q !== undefined &&
        (!query.q.trim() || [...query.q.trim()].length > 100)) ||
      (query.from !== undefined && !historyTimestamp(query.from)) ||
      (query.to !== undefined && !historyTimestamp(query.to)) ||
      (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
    )
      throw new ApiError('configuration');
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    for (const key of ['status', 'q', 'from', 'to'] as const)
      if (query[key] !== undefined)
        params.set(key, key === 'q' ? query[key].trim() : query[key]);
    return this.request('/history/workouts?' + params, isHistoryPage, {
      signal,
    });
  }
  async getWorkoutHistory(
    workoutId: string,
    signal?: AbortSignal,
  ): Promise<WorkoutHistoryDetail> {
    const result = await this.request(
      '/history/workouts/' + this.pathSegment(workoutId),
      isHistoryDetail,
      { signal },
    );
    if (result.id !== workoutId) throw new ApiError('response');
    return result;
  }
  createWorkoutTemplate(
    input: TemplateMetadataInput,
  ): Promise<WorkoutTemplate> {
    return this.request(
      '/workout-templates',
      isWorkoutTemplate,
      this.body('POST', { name: input.name, description: input.description }),
    );
  }
  async getWorkoutTemplate(
    templateId: string,
    signal?: AbortSignal,
  ): Promise<WorkoutTemplate> {
    const template = await this.request(
      this.templatePath(templateId),
      isWorkoutTemplate,
      { signal },
    );
    if (template.id !== templateId) throw new ApiError('response');
    return template;
  }
  updateWorkoutTemplate(
    templateId: string,
    input: Partial<TemplateMetadataInput>,
  ): Promise<WorkoutTemplate> {
    return this.request(
      this.templatePath(templateId),
      isWorkoutTemplate,
      this.body('PATCH', { name: input.name, description: input.description }),
    );
  }
  archiveWorkoutTemplate(templateId: string): Promise<void> {
    return this.noContent(this.templatePath(templateId));
  }
  addTemplateExercise(
    templateId: string,
    input: AddTemplateExerciseInput,
  ): Promise<TemplateExercise> {
    return this.request(
      this.templatePath(templateId) + '/exercises',
      isTemplateExercise,
      this.body('POST', {
        exerciseId: input.exerciseId,
        ...this.planningBody(input),
      }),
    );
  }
  updateTemplateExercise(
    templateId: string,
    templateExerciseId: string,
    input: Partial<PlanningInput>,
  ): Promise<TemplateExercise> {
    return this.request(
      this.templatePath(templateId) +
        '/exercises/' +
        this.pathSegment(templateExerciseId),
      isTemplateExercise,
      this.body('PATCH', this.planningBody(input)),
    );
  }
  removeTemplateExercise(
    templateId: string,
    templateExerciseId: string,
  ): Promise<void> {
    return this.noContent(
      this.templatePath(templateId) +
        '/exercises/' +
        this.pathSegment(templateExerciseId),
    );
  }
  reorderTemplateExercises(
    templateId: string,
    templateExerciseIds: string[],
  ): Promise<WorkoutTemplate> {
    return this.request(
      this.templatePath(templateId) + '/exercises/order',
      isWorkoutTemplate,
      this.body('PUT', { templateExerciseIds }),
    );
  }
  listCatalogExercises(
    query: CatalogQuery = {},
    signal?: AbortSignal,
  ): Promise<ResourcePage<CatalogExercise>> {
    const params = new URLSearchParams({
      page: String(query.page ?? 1),
      limit: String(query.limit ?? 10),
    });
    if (query.q?.trim()) params.set('q', query.q.trim());
    for (const key of [
      'primaryMuscle',
      'equipment',
      'movementPattern',
    ] as const)
      if (query[key] !== undefined) params.set(key, query[key]);
    return this.request('/exercises?' + params, isCatalogPage, { signal });
  }
  async getExerciseAnalytics(
    exerciseId: string,
    page = 1,
    limit = 20,
    signal?: AbortSignal,
  ): Promise<ExerciseAnalytics> {
    if (!validHistoryPagination(page, limit))
      throw new ApiError('configuration');
    const result = await this.request(
      '/analytics/exercises/' +
        this.pathSegment(exerciseId) +
        '?' +
        new URLSearchParams({ page: String(page), limit: String(limit) }),
      isExerciseAnalytics,
      { signal },
    );
    if (
      result.page !== page ||
      result.limit !== limit ||
      !this.progressIdentity(result.exercise, exerciseId) ||
      result.performances.some(
        (row) => !this.progressIdentity(row.exercise, exerciseId),
      )
    )
      throw new ApiError('response');
    return result;
  }
  async getExerciseRecords(
    exerciseId: string,
    signal?: AbortSignal,
  ): Promise<ExerciseRecords> {
    const result = await this.request(
      '/records/exercises/' + this.pathSegment(exerciseId),
      isExerciseRecords,
      { signal },
    );
    if (!this.progressIdentity(result.exercise, exerciseId))
      throw new ApiError('response');
    return result;
  }
  async getExerciseWeeklyTrends(
    exerciseId: string,
    query: WeeklyQuery,
    signal?: AbortSignal,
  ): Promise<ExerciseWeeklyTrends> {
    const from = historyTimestamp(query.from),
      to = historyTimestamp(query.to);
    if (
      !from ||
      !to ||
      from > to ||
      to.getTime() - from.getTime() > 63_072_000_000 ||
      canonicalBrowserTimezone(query.timezone) !== query.timezone
    )
      throw new ApiError('configuration');
    const result = await this.request(
      '/training-trends/exercises/' +
        this.pathSegment(exerciseId) +
        '/weekly?' +
        new URLSearchParams({
          from: query.from,
          to: query.to,
          timezone: query.timezone,
        }),
      isExerciseWeeklyTrends,
      { signal },
    );
    if (
      !this.progressIdentity(result.exercise, exerciseId) ||
      result.timezone !== query.timezone ||
      Date.parse(result.from) !== from.getTime() ||
      Date.parse(result.to) !== to.getTime()
    )
      throw new ApiError('response');
    return result;
  }
  getWeeklyTraining(
    query: WeeklyQuery,
    signal?: AbortSignal,
  ): Promise<WeeklyTraining> {
    return this.trainingInstantRead(
      '/training-trends/weekly',
      query,
      isWeeklyTraining,
      signal,
    );
  }
  getWeeklyDuration(
    query: WeeklyQuery,
    signal?: AbortSignal,
  ): Promise<WeeklyDuration> {
    return this.trainingInstantRead(
      '/training-duration/weekly',
      query,
      isWeeklyDuration,
      signal,
    );
  }
  async getWeeklyConsistency(
    query: ConsistencyQuery,
    signal?: AbortSignal,
  ): Promise<WeeklyConsistency> {
    if (!validConsistencyQuery(query)) throw new ApiError('configuration');
    const result = await this.request(
      '/training-consistency/weekly?' +
        new URLSearchParams({
          fromWeekStart: query.fromWeekStart,
          toWeekStart: query.toWeekStart,
          timezone: query.timezone,
        }),
      isWeeklyConsistency,
      { signal },
    );
    if (
      result.fromWeekStart !== query.fromWeekStart ||
      result.toWeekStart !== query.toWeekStart ||
      result.timezone !== query.timezone
    )
      throw new ApiError('response');
    return result;
  }
  private async trainingInstantRead<T extends WeeklyQuery>(
    path: string,
    query: WeeklyQuery,
    guard: (value: unknown) => value is T,
    signal?: AbortSignal,
  ): Promise<T> {
    const from = historyTimestamp(query.from),
      to = historyTimestamp(query.to);
    if (
      !from ||
      !to ||
      from > to ||
      to.getTime() - from.getTime() > 63_072_000_000 ||
      canonicalBrowserTimezone(query.timezone) !== query.timezone
    )
      throw new ApiError('configuration');
    const result = await this.request(
      path +
        '?' +
        new URLSearchParams({
          from: query.from,
          to: query.to,
          timezone: query.timezone,
        }),
      guard,
      { signal },
    );
    if (
      result.timezone !== query.timezone ||
      Date.parse(result.from) !== from.getTime() ||
      Date.parse(result.to) !== to.getTime()
    )
      throw new ApiError('response');
    return result;
  }
  private progressIdentity(
    metadata: { sourceExerciseId: string | null } | null,
    exerciseId: string,
  ): boolean {
    return (
      metadata === null ||
      metadata.sourceExerciseId?.toLowerCase() === exerciseId.toLowerCase()
    );
  }
  private templatePath(id: string): string {
    return '/workout-templates/' + this.pathSegment(id);
  }
  private planningBody(input: Partial<PlanningInput>) {
    return {
      targetSets: input.targetSets,
      targetRepsMin: input.targetRepsMin,
      targetRepsMax: input.targetRepsMax,
      restSeconds: input.restSeconds,
      notes: input.notes,
    };
  }
  private async noContent(path: string): Promise<void> {
    const response = await this.authenticated(path, { method: 'DELETE' });
    if (response.status !== 204) {
      await this.json(response);
      throw new ApiError('response');
    }
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
    await this.noContent(
      this.setPath(sessionId, exerciseId) + '/' + this.pathSegment(setId),
    );
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
  private body(method: 'POST' | 'PATCH' | 'PUT', value: object): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    };
  }
}
export const apiClient = new ApiClient(process.env.NEXT_PUBLIC_API_URL);
