import { Injectable } from '@nestjs/common';
import type {
  PublicSetEntry,
  PublicWorkoutSessionExercise,
} from '../workout-sessions/workout-sessions.types';
import { HistoryRepository } from './history.repository';
import { WorkoutHistoryNotFoundError } from './errors/workout-history-not-found.error';
import { HistoryPersistenceError } from './errors/history-persistence.error';
import {
  normalizeHistoryQuery,
  normalizeWorkoutHistoryQuery,
  validateHistoryIds,
} from './history.validation';
import type {
  HistoryQueryInput,
  WorkoutHistoryQueryInput,
  HistoryStatus,
  HistorySetRecord,
  HistoryExerciseRecord,
  HistoryPage,
  WorkoutHistorySummary,
  WorkoutHistoryDetail,
  ExerciseHistoryEntry,
} from './history.types';

function historicalStatus(status: string): HistoryStatus {
  if (status === 'COMPLETED' || status === 'CANCELLED') return status;
  throw new HistoryPersistenceError();
}
function publicSet(set: HistorySetRecord): PublicSetEntry {
  return {
    id: set.id,
    position: set.position,
    loadKg: set.loadKg.toNumber(),
    reps: set.reps,
    rpe: set.rpe === null ? null : set.rpe.toNumber(),
    rir: set.rir,
    completedAt: set.completedAt,
  };
}
function publicExercise(
  entry: HistoryExerciseRecord,
): PublicWorkoutSessionExercise {
  return {
    id: entry.id,
    position: entry.position,
    exercise: {
      sourceExerciseId: entry.sourceExerciseId,
      name: entry.exerciseName,
      slug: entry.exerciseSlug,
      primaryMuscle: entry.primaryMuscle,
      secondaryMuscles: [...entry.secondaryMuscles],
      equipment: entry.equipment,
      movementPattern: entry.movementPattern,
    },
    plannedSets: entry.plannedSets,
    plannedRepsMin: entry.plannedRepsMin,
    plannedRepsMax: entry.plannedRepsMax,
    plannedRestSeconds: entry.plannedRestSeconds,
    plannedNotes: entry.plannedNotes,
    sets: [...entry.sets]
      .sort((a, b) => a.position - b.position)
      .map(publicSet),
  };
}
function pageResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): HistoryPage<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

@Injectable()
export class HistoryService {
  constructor(private readonly repository: HistoryRepository) {}

  async listWorkouts(
    userId: string,
    input: WorkoutHistoryQueryInput = {},
  ): Promise<HistoryPage<WorkoutHistorySummary>> {
    validateHistoryIds(userId);
    const query = normalizeWorkoutHistoryQuery(input);
    const { items, total } = await this.repository.findWorkoutHistory(
      userId,
      query,
    );
    return pageResult(
      items.map((session) => ({
        id: session.id,
        name: session.name,
        status: historicalStatus(session.status),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        exerciseCount: session.exercises.length,
        setCount: session.exercises.reduce(
          (count, entry) => count + entry._count.sets,
          0,
        ),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async getWorkout(userId: string, id: string): Promise<WorkoutHistoryDetail> {
    validateHistoryIds(userId, id);
    const session = await this.repository.findWorkoutHistoryById(userId, id);
    if (!session) throw new WorkoutHistoryNotFoundError();
    return {
      id: session.id,
      name: session.name,
      status: historicalStatus(session.status),
      notes: session.notes,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      exercises: [...session.exercises]
        .sort((a, b) => a.position - b.position)
        .map(publicExercise),
    };
  }

  async getExerciseHistory(
    userId: string,
    exerciseId: string,
    input: HistoryQueryInput = {},
  ): Promise<HistoryPage<ExerciseHistoryEntry>> {
    validateHistoryIds(userId, exerciseId);
    const normalized = normalizeHistoryQuery(input);
    const query = {
      ...normalized,
      status: normalized.status ?? ('COMPLETED' as const),
    };
    const { items, total } = await this.repository.findExerciseHistory(
      userId,
      exerciseId,
      query,
    );
    return pageResult(
      items.map((entry) => {
        const snapshot = publicExercise(entry);
        return {
          sessionId: entry.workoutSession.id,
          sessionName: entry.workoutSession.name,
          sessionStatus: historicalStatus(entry.workoutSession.status),
          startedAt: entry.workoutSession.startedAt,
          endedAt: entry.workoutSession.endedAt,
          sessionExerciseId: entry.id,
          exercise: snapshot.exercise,
          plannedSets: snapshot.plannedSets,
          plannedRepsMin: snapshot.plannedRepsMin,
          plannedRepsMax: snapshot.plannedRepsMax,
          plannedRestSeconds: snapshot.plannedRestSeconds,
          plannedNotes: snapshot.plannedNotes,
          sets: snapshot.sets,
        };
      }),
      total,
      query.page,
      query.limit,
    );
  }
}
