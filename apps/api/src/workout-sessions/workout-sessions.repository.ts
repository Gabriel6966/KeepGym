import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutTemplateNotFoundError } from '../workout-templates/errors/workout-template-not-found.error';
import { EmptyWorkoutTemplateError } from './errors/empty-workout-template.error';
import { InvalidWorkoutSessionStateError } from './errors/invalid-workout-session-state.error';
import { WorkoutSessionNotFoundError } from './errors/workout-session-not-found.error';
import { WorkoutSessionPersistenceError } from './errors/workout-session-persistence.error';
import { WorkoutSessionBusyError } from './errors/workout-session-busy.error';
import {
  sessionInclude,
  type TerminalWorkoutSessionStatus,
  type WorkoutSessionListQuery,
  type WorkoutSessionListRecord,
  type WorkoutSessionRecord,
} from './workout-sessions.types';

export const snapshotSourceSelect = {
  id: true,
  name: true,
  exercises: {
    orderBy: { position: 'asc' },
    select: {
      exerciseId: true,
      position: true,
      targetSets: true,
      targetRepsMin: true,
      targetRepsMax: true,
      restSeconds: true,
      notes: true,
      exercise: {
        select: {
          name: true,
          slug: true,
          primaryMuscle: true,
          secondaryMuscles: true,
          equipment: true,
          movementPattern: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutTemplateSelect;

function safeError(error: unknown): never {
  if (
    error instanceof WorkoutTemplateNotFoundError ||
    error instanceof EmptyWorkoutTemplateError ||
    error instanceof WorkoutSessionNotFoundError ||
    error instanceof InvalidWorkoutSessionStateError
  )
    throw error;
  throw new WorkoutSessionPersistenceError();
}

@Injectable()
export class WorkoutSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createFromTemplateSnapshot(
    userId: string,
    templateId: string,
  ): Promise<WorkoutSessionRecord> {
    // All source reads and nested writes share one PostgreSQL snapshot, even
    // when Prisma loads relations with multiple SQL queries. No source writes.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const template = await tx.workoutTemplate.findFirst({
              where: { id: templateId, userId, archivedAt: null },
              select: snapshotSourceSelect,
            });
            if (!template) throw new WorkoutTemplateNotFoundError();
            // Evaluated inside the transaction, not via a stale service precheck.
            if (template.exercises.length === 0)
              throw new EmptyWorkoutTemplateError();
            return tx.workoutSession.create({
              data: {
                userId,
                sourceTemplateId: template.id,
                name: template.name,
                status: 'IN_PROGRESS',
                notes: null,
                exercises: {
                  create: template.exercises.map((entry) => ({
                    sourceExerciseId: entry.exerciseId,
                    position: entry.position,
                    exerciseName: entry.exercise.name,
                    exerciseSlug: entry.exercise.slug,
                    primaryMuscle: entry.exercise.primaryMuscle,
                    secondaryMuscles: [...entry.exercise.secondaryMuscles],
                    equipment: entry.exercise.equipment,
                    movementPattern: entry.exercise.movementPattern,
                    plannedSets: entry.targetSets,
                    plannedRepsMin: entry.targetRepsMin,
                    plannedRepsMax: entry.targetRepsMax,
                    plannedRestSeconds: entry.restSeconds,
                    plannedNotes: entry.notes,
                  })),
                },
              },
              include: sessionInclude,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );
      } catch (error: unknown) {
        // A concurrent exceptional source deletion can conflict with FK checks.
        // Retry the whole snapshot, never just the insert or individual entries.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < 2) continue;
          throw new WorkoutSessionBusyError();
        }
        safeError(error);
      }
    }
    throw new WorkoutSessionBusyError();
  }

  async findManyByUser(
    userId: string,
    query: WorkoutSessionListQuery,
  ): Promise<{ items: WorkoutSessionListRecord[]; total: number }> {
    const where: Prisma.WorkoutSessionWhereInput = {
      userId,
      status: query.status,
    };
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.workoutSession.findMany({
            where,
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          this.prisma.workoutSession.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items, total };
    } catch (error: unknown) {
      safeError(error);
    }
  }

  async findByIdAndUser(
    userId: string,
    id: string,
  ): Promise<WorkoutSessionRecord | null> {
    try {
      return await this.prisma.workoutSession.findFirst({
        where: { id, userId },
        include: sessionInclude,
      });
    } catch (error: unknown) {
      safeError(error);
    }
  }

  completeIfInProgress(
    userId: string,
    id: string,
  ): Promise<WorkoutSessionRecord> {
    return this.finishIfInProgress(userId, id, 'COMPLETED');
  }

  cancelIfInProgress(
    userId: string,
    id: string,
  ): Promise<WorkoutSessionRecord> {
    return this.finishIfInProgress(userId, id, 'CANCELLED');
  }

  private async finishIfInProgress(
    userId: string,
    id: string,
    status: TerminalWorkoutSessionStatus,
  ): Promise<WorkoutSessionRecord> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // At READ COMMITTED PostgreSQL rechecks this predicate after waiting
          // for a competing writer. Only IN_PROGRESS -> terminal can win.
          const changed = await tx.workoutSession.updateMany({
            where: { id, userId, status: 'IN_PROGRESS' },
            data: { status, endedAt: new Date() },
          });
          const session = await tx.workoutSession.findFirst({
            where: { id, userId },
            include: sessionInclude,
          });
          if (!session) throw new WorkoutSessionNotFoundError();
          if (changed.count === 0) throw new InvalidWorkoutSessionStateError();
          return session;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error: unknown) {
      safeError(error);
    }
  }
}
