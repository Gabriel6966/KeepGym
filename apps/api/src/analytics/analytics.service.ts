import { Injectable } from '@nestjs/common';
import { AnalyticsRepository } from './analytics.repository';
import {
  calculateEstimated1RM,
  estimated1RMScore,
  roundMetric,
  sumSetVolumes,
} from './analytics.math';
import {
  normalizeAnalyticsRange,
  normalizeExerciseAnalyticsQuery,
  validateAnalyticsIds,
  validateExerciseHighlightsLimit,
} from './analytics.validation';
import { AnalyticsPersistenceError } from './errors/analytics-persistence.error';
import type {
  AnalyticsOverview,
  AnalyticsRangeInput,
  ExerciseAnalyticsInput,
  ExerciseAnalytics,
  AnalyticsSetRecord,
  PublicAnalyticsSet,
  AnalyticsCandidateRecord,
  PublicAnalyticsCandidate,
  AnalyticsPerformanceRecord,
  ExercisePerformance,
  ExerciseHighlightPerformanceRecord,
  ExerciseHighlightCandidate,
  PublicExerciseHighlightPerformance,
  PublicExerciseHighlights,
} from './analytics.types';

function count(value: string): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result))
    throw new AnalyticsPersistenceError();
  return result;
}
function publicSet(set: AnalyticsSetRecord): PublicAnalyticsSet {
  return {
    id: set.id,
    position: set.position,
    loadKg: roundMetric(set.loadKg),
    reps: set.reps,
    rpe: set.rpe === null ? null : roundMetric(set.rpe),
    rir: set.rir,
    completedAt: set.completedAt,
    estimated1RMKg: calculateEstimated1RM(set.loadKg, set.reps),
  };
}
function publicCandidate(
  set: AnalyticsCandidateRecord,
): PublicAnalyticsCandidate {
  return {
    sessionId: set.sessionId,
    sessionName: set.sessionName,
    sessionStartedAt: set.sessionStartedAt,
    sessionExerciseId: set.sessionExerciseId,
    setId: set.setId,
    position: set.position,
    loadKg: roundMetric(set.loadKg),
    reps: set.reps,
    rpe: set.rpe === null ? null : roundMetric(set.rpe),
    rir: set.rir,
    completedAt: set.completedAt,
  };
}
function bestEstimated(
  candidates: readonly AnalyticsCandidateRecord[],
): AnalyticsCandidateRecord | null {
  return (
    [...candidates]
      .filter((set) => estimated1RMScore(set.loadKg, set.reps) !== null)
      .sort(
        (a, b) =>
          estimated1RMScore(b.loadKg, b.reps)!.comparedTo(
            estimated1RMScore(a.loadKg, a.reps)!,
          ) ||
          Number(b.loadKg) - Number(a.loadKg) ||
          b.reps - a.reps ||
          b.completedAt.getTime() - a.completedAt.getTime() ||
          b.setId.localeCompare(a.setId),
      )[0] ?? null
  );
}
function performance(entry: AnalyticsPerformanceRecord): ExercisePerformance {
  const sets = [...entry.sets]
    .sort((a, b) => a.position - b.position)
    .map(publicSet);
  const estimated = sets.flatMap((set) =>
    set.estimated1RMKg === null ? [] : [set.estimated1RMKg],
  );
  return {
    sessionId: entry.workoutSession.id,
    sessionName: entry.workoutSession.name,
    startedAt: entry.workoutSession.startedAt,
    endedAt: entry.workoutSession.endedAt,
    sessionExerciseId: entry.id,
    exercise: {
      sourceExerciseId: entry.sourceExerciseId,
      name: entry.exerciseName,
      slug: entry.exerciseSlug,
      primaryMuscle: entry.primaryMuscle,
      secondaryMuscles: [...entry.secondaryMuscles],
      equipment: entry.equipment,
      movementPattern: entry.movementPattern,
    },
    setCount: sets.length,
    repCount: sets.reduce((total, set) => total + set.reps, 0),
    volumeKg: sumSetVolumes(entry.sets),
    maxLoadKg: sets.reduce<number | null>(
      (max, set) => (max === null ? set.loadKg : Math.max(max, set.loadKg)),
      null,
    ),
    maxEstimated1RMKg: estimated.reduce<number | null>(
      (max, value) => (max === null ? value : Math.max(max, value)),
      null,
    ),
    sets,
  };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}
  async getExerciseHighlights(
    userId: string,
    limit = 5,
  ): Promise<PublicExerciseHighlights> {
    validateAnalyticsIds(userId);
    validateExerciseHighlightsLimit(limit);
    try {
      const data = await this.repository.findExerciseHighlightPerformances(
        userId,
        limit,
      );
      const candidates = new Map<string, ExerciseHighlightCandidate>();
      for (const candidate of data.estimatedCandidates) {
        const score = estimated1RMScore(candidate.loadKg, candidate.reps);
        const best = candidates.get(candidate.sessionExerciseId);
        if (
          score !== null &&
          (!best || score.gt(estimated1RMScore(best.loadKg, best.reps)!))
        )
          candidates.set(candidate.sessionExerciseId, candidate);
      }
      const publicPerformance = (
        row: ExerciseHighlightPerformanceRecord,
      ): PublicExerciseHighlightPerformance => {
        const completedSets = count(row.completedSets);
        if (completedSets < 1) throw new AnalyticsPersistenceError();
        const best = candidates.get(row.sessionExerciseId);
        return {
          workoutSessionId: row.workoutSessionId,
          startedAt: row.startedAt,
          completedSets,
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
          maxLoadKg: roundMetric(row.maxLoadKg),
          bestEstimated1RMKg: best
            ? calculateEstimated1RM(best.loadKg, best.reps)
            : null,
        };
      };
      const groups = new Map<string, ExerciseHighlightPerformanceRecord[]>();
      for (const row of data.performances) {
        const group = groups.get(row.sourceExerciseId) ?? [];
        group.push(row);
        groups.set(row.sourceExerciseId, group);
      }
      const items = [...groups.values()].map((rows) => {
        const [latest, previous] = [...rows].sort(
          (a, b) => a.performanceRank - b.performanceRank,
        );
        if (
          !latest ||
          latest.performanceRank !== 1 ||
          rows.length > 2 ||
          (previous && previous.performanceRank !== 2)
        )
          throw new AnalyticsPersistenceError();
        return {
          exercise: {
            sourceExerciseId: latest.sourceExerciseId,
            name: latest.exerciseName,
            slug: latest.exerciseSlug,
          },
          latest: publicPerformance(latest),
          previous: previous ? publicPerformance(previous) : null,
        };
      });
      items.sort(
        (a, b) =>
          b.latest.startedAt.getTime() - a.latest.startedAt.getTime() ||
          b.latest.workoutSessionId.localeCompare(a.latest.workoutSessionId) ||
          a.exercise.sourceExerciseId.localeCompare(
            b.exercise.sourceExerciseId,
          ),
      );
      return { items };
    } catch {
      throw new AnalyticsPersistenceError();
    }
  }
  async overview(
    userId: string,
    input: AnalyticsRangeInput = {},
  ): Promise<AnalyticsOverview> {
    validateAnalyticsIds(userId);
    const data = await this.repository.overview(
      userId,
      normalizeAnalyticsRange(input),
    );
    return {
      completedWorkouts: count(data.completedWorkouts),
      completedSets: count(data.completedSets),
      totalReps: count(data.totalReps),
      totalVolumeKg: roundMetric(data.totalVolumeKg),
    };
  }
  async exercise(
    userId: string,
    exerciseId: string,
    input: ExerciseAnalyticsInput = {},
  ): Promise<ExerciseAnalytics> {
    validateAnalyticsIds(userId, exerciseId);
    const query = normalizeExerciseAnalyticsQuery(input);
    const data = await this.repository.exercise(userId, exerciseId, query);
    const best = bestEstimated(data.estimatedCandidates);
    const estimated1RMKg = best
      ? calculateEstimated1RM(best.loadKg, best.reps)
      : null;
    const total = count(data.summary.sessions);
    return {
      exercise:
        data.exercise === null
          ? null
          : {
              sourceExerciseId: data.exercise.sourceExerciseId,
              name: data.exercise.exerciseName,
              slug: data.exercise.exerciseSlug,
            },
      summary: {
        sessions: total,
        sets: count(data.summary.sets),
        reps: count(data.summary.reps),
        totalVolumeKg: roundMetric(data.summary.totalVolumeKg),
        maxLoadKg: data.heaviestSet
          ? roundMetric(data.heaviestSet.loadKg)
          : null,
        maxEstimated1RMKg: estimated1RMKg,
      },
      heaviestSet: data.heaviestSet ? publicCandidate(data.heaviestSet) : null,
      bestEstimated1RMSet:
        best && estimated1RMKg !== null
          ? { ...publicCandidate(best), estimated1RMKg }
          : null,
      performances: data.performances.map(performance),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
