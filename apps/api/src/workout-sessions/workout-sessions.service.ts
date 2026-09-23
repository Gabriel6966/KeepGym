import { Injectable } from '@nestjs/common';
import type { SetEntry } from '../generated/prisma/client';
import {
  validateCreateSetEntry,
  validateSetEntryChanges,
} from './set-entry.validation';
import { WorkoutSessionNotFoundError } from './errors/workout-session-not-found.error';
import { WorkoutSessionsRepository } from './workout-sessions.repository';
import {
  normalizeWorkoutSessionQuery,
  validateWorkoutSessionIds,
} from './workout-session.validation';
import type {
  CreateSetEntryInput,
  UpdateSetEntryInput,
  PublicSetEntry,
  ListWorkoutSessionsInput,
  PublicWorkoutSession,
  PublicWorkoutSessionSummary,
  StartWorkoutSessionInput,
  WorkoutSessionListRecord,
  WorkoutSessionPage,
  WorkoutSessionRecord,
} from './workout-sessions.types';

function publicSetEntry(set: SetEntry): PublicSetEntry {
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

function publicSummary(
  session: WorkoutSessionListRecord,
): PublicWorkoutSessionSummary {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    notes: session.notes,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}
function publicSession(session: WorkoutSessionRecord): PublicWorkoutSession {
  return {
    ...publicSummary(session),
    exercises: [...session.exercises]
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({
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
          .map(publicSetEntry),
      })),
  };
}

@Injectable()
export class WorkoutSessionsService {
  constructor(private readonly repository: WorkoutSessionsRepository) {}

  async addSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    input: CreateSetEntryInput,
  ): Promise<PublicSetEntry> {
    validateWorkoutSessionIds(userId, sessionId, exerciseId);
    return publicSetEntry(
      await this.repository.addSet(
        userId,
        sessionId,
        exerciseId,
        validateCreateSetEntry(input),
      ),
    );
  }

  async updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
    input: UpdateSetEntryInput,
  ): Promise<PublicSetEntry> {
    validateWorkoutSessionIds(userId, sessionId, exerciseId, setId);
    return publicSetEntry(
      await this.repository.updateSet(
        userId,
        sessionId,
        exerciseId,
        setId,
        validateSetEntryChanges(input),
      ),
    );
  }

  async removeSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
  ): Promise<void> {
    validateWorkoutSessionIds(userId, sessionId, exerciseId, setId);
    await this.repository.removeSet(userId, sessionId, exerciseId, setId);
  }

  async start(
    userId: string,
    input: StartWorkoutSessionInput,
  ): Promise<PublicWorkoutSession> {
    validateWorkoutSessionIds(userId, input.workoutTemplateId);
    return publicSession(
      await this.repository.createFromTemplateSnapshot(
        userId,
        input.workoutTemplateId,
      ),
    );
  }

  async list(
    userId: string,
    input: ListWorkoutSessionsInput = {},
  ): Promise<WorkoutSessionPage> {
    validateWorkoutSessionIds(userId);
    const query = normalizeWorkoutSessionQuery(input);
    const { items, total } = await this.repository.findManyByUser(
      userId,
      query,
    );
    return {
      items: items.map(publicSummary),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(userId: string, id: string): Promise<PublicWorkoutSession> {
    validateWorkoutSessionIds(userId, id);
    const session = await this.repository.findByIdAndUser(userId, id);
    if (!session) throw new WorkoutSessionNotFoundError();
    return publicSession(session);
  }

  async complete(userId: string, id: string): Promise<PublicWorkoutSession> {
    validateWorkoutSessionIds(userId, id);
    return publicSession(
      await this.repository.completeIfInProgress(userId, id),
    );
  }

  async cancel(userId: string, id: string): Promise<PublicWorkoutSession> {
    validateWorkoutSessionIds(userId, id);
    return publicSession(await this.repository.cancelIfInProgress(userId, id));
  }
}
