import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { MuscleGroup } from '../generated/prisma/enums';
import {
  calculateEstimated1RM,
  roundMetric,
} from '../analytics/analytics.math';
import { InvalidTrainingTrendsQueryError } from './errors/invalid-training-trends-query.error';
import { TrainingTrendsPersistenceError } from './errors/training-trends-persistence.error';
import { TrainingTrendsRepository } from './training-trends.repository';
import { normalizeWeeklyTrainingTrends } from './training-trends.validation';
import type {
  PublicExerciseWeeklyTrends,
  PublicMuscleGroupWeeklyBucket,
  PublicMuscleGroupWeeklyTrends,
  PublicWeeklyTrainingTrends,
  WeeklyTrainingTrendsInput,
} from './training-trends.types';

function count(value: string): number {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result))
    throw new TrainingTrendsPersistenceError();
  return result;
}

@Injectable()
export class TrainingTrendsService {
  constructor(private readonly repository: TrainingTrendsRepository) {}

  async getMuscleGroupWeeklyTrends(
    userId: string,
    input: WeeklyTrainingTrendsInput,
  ): Promise<PublicMuscleGroupWeeklyTrends> {
    const query = normalizeWeeklyTrainingTrends(userId, input);
    const rows = await this.repository.findMuscleGroupWeeklyTrends(
      userId,
      query,
    );
    try {
      const buckets = new Map<string, PublicMuscleGroupWeeklyBucket>();
      for (const row of rows) {
        const muscleGroup = Object.values(MuscleGroup).find(
          (value) => value === row.muscleGroup,
        );
        if (muscleGroup === undefined)
          throw new TrainingTrendsPersistenceError();
        const bucket = buckets.get(row.weekStart) ?? {
          weekStart: row.weekStart,
          muscleGroups: [],
        };
        bucket.muscleGroups.push({
          muscleGroup,
          completedWorkouts: count(row.completedWorkouts),
          completedSets: count(row.completedSets),
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
        });
        buckets.set(row.weekStart, bucket);
      }
      // ASCII ordering matches SQL COLLATE C, independent of process locale or enum order.
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      return {
        timezone: query.timezone,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        buckets: [...buckets.values()]
          .sort((a, b) => compare(a.weekStart, b.weekStart))
          .map((bucket) => ({
            weekStart: bucket.weekStart,
            muscleGroups: bucket.muscleGroups.sort((a, b) =>
              compare(a.muscleGroup, b.muscleGroup),
            ),
          })),
      };
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }

  async getExerciseWeeklyTrends(
    userId: string,
    exerciseId: string,
    input: WeeklyTrainingTrendsInput,
  ): Promise<PublicExerciseWeeklyTrends> {
    const query = normalizeWeeklyTrainingTrends(userId, input);
    if (typeof exerciseId !== 'string' || !isUUID(exerciseId))
      throw new InvalidTrainingTrendsQueryError(
        'Exercise identifier must be a UUID.',
      );
    const data = await this.repository.findExerciseWeeklyTrends(
      userId,
      exerciseId,
      query,
    );
    try {
      if ((data.buckets.length === 0) !== (data.exercise === null))
        throw new TrainingTrendsPersistenceError();
      const maximums = new Map<string, number>();
      for (const candidate of data.estimatedCandidates) {
        const value = calculateEstimated1RM(candidate.loadKg, candidate.reps);
        if (value !== null)
          maximums.set(
            candidate.weekStart,
            Math.max(value, maximums.get(candidate.weekStart) ?? 0),
          );
      }
      const snapshot = data.exercise;
      return {
        exercise:
          snapshot === null
            ? null
            : {
                sourceExerciseId: snapshot.sourceExerciseId,
                name: snapshot.name,
                slug: snapshot.slug,
                primaryMuscle: snapshot.primaryMuscle,
                secondaryMuscles: [...snapshot.secondaryMuscles],
                equipment: snapshot.equipment,
                movementPattern: snapshot.movementPattern,
              },
        timezone: query.timezone,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        buckets: data.buckets.map((row) => ({
          weekStart: row.weekStart,
          completedWorkouts: count(row.completedWorkouts),
          completedSets: count(row.completedSets),
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
          maxLoadKg: roundMetric(row.maxLoadKg),
          maxEstimated1RMKg: maximums.get(row.weekStart) ?? null,
        })),
      };
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }

  async getWeeklyTrends(
    userId: string,
    input: WeeklyTrainingTrendsInput,
  ): Promise<PublicWeeklyTrainingTrends> {
    const query = normalizeWeeklyTrainingTrends(userId, input);
    const rows = await this.repository.findWeeklyTrends(userId, query);
    try {
      return {
        timezone: query.timezone,
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        buckets: rows.map((row) => ({
          weekStart: row.weekStart,
          completedWorkouts: count(row.completedWorkouts),
          completedSets: count(row.completedSets),
          totalReps: count(row.totalReps),
          totalVolumeKg: roundMetric(row.totalVolumeKg),
        })),
      };
    } catch {
      throw new TrainingTrendsPersistenceError();
    }
  }
}
