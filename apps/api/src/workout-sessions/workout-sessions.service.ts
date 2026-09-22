import { Injectable } from '@nestjs/common';
import { WorkoutSessionNotFoundError } from './errors/workout-session-not-found.error';
import { WorkoutSessionsRepository } from './workout-sessions.repository';
import {
  normalizeWorkoutSessionQuery,
  validateWorkoutSessionIds,
} from './workout-session.validation';
import type {
  ListWorkoutSessionsInput,
  PublicWorkoutSession,
  PublicWorkoutSessionSummary,
  StartWorkoutSessionInput,
  WorkoutSessionListRecord,
  WorkoutSessionPage,
  WorkoutSessionRecord,
} from './workout-sessions.types';

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
      })),
  };
}

@Injectable()
export class WorkoutSessionsService {
  constructor(private readonly repository: WorkoutSessionsRepository) {}

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
