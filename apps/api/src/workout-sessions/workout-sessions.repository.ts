import { Injectable } from '@nestjs/common';
import { Prisma, type SetEntry } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutTemplateNotFoundError } from '../workout-templates/errors/workout-template-not-found.error';
import { EmptyWorkoutTemplateError } from './errors/empty-workout-template.error';
import { InvalidWorkoutSessionStateError } from './errors/invalid-workout-session-state.error';
import { WorkoutSessionNotFoundError } from './errors/workout-session-not-found.error';
import { WorkoutSessionPersistenceError } from './errors/workout-session-persistence.error';
import { WorkoutSessionBusyError } from './errors/workout-session-busy.error';
import { SetEntryNotFoundError } from './errors/set-entry-not-found.error';
import { WorkoutSessionExerciseNotFoundError } from './errors/workout-session-exercise-not-found.error';
import { WorkoutSessionNotEditableError } from './errors/workout-session-not-editable.error';
import {
  sessionInclude,
  type CreateSetEntryInput,
  type UpdateSetEntryInput,
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
    error instanceof InvalidWorkoutSessionStateError ||
    error instanceof SetEntryNotFoundError ||
    error instanceof WorkoutSessionExerciseNotFoundError ||
    error instanceof WorkoutSessionNotEditableError
  )
    throw error;
  throw new WorkoutSessionPersistenceError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSetPositionConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002' ||
    (error.meta?.modelName !== undefined && error.meta.modelName !== 'SetEntry')
  )
    return false;
  const target = error.meta?.target;
  if (
    target === 'set_entries_exercise_position_key' ||
    (Array.isArray(target) &&
      target.length === 2 &&
      target.includes('position') &&
      (target.includes('workoutSessionExerciseId') ||
        target.includes('workout_session_exercise_id')))
  )
    return true;
  const adapter = error.meta?.driverAdapterError;
  return (
    isRecord(adapter) &&
    isRecord(adapter.cause) &&
    adapter.cause.kind === 'UniqueConstraintViolation' &&
    isRecord(adapter.cause.constraint) &&
    adapter.cause.constraint.index === 'set_entries_exercise_position_key'
  );
}

function setValues(input: UpdateSetEntryInput) {
  return {
    loadKg:
      input.loadKg === undefined
        ? undefined
        : new Prisma.Decimal(input.loadKg.toString()),
    reps: input.reps,
    rpe:
      input.rpe === undefined || input.rpe === null
        ? input.rpe
        : new Prisma.Decimal(input.rpe.toString()),
    rir: input.rir,
  };
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
      // Keep status, snapshot entries and their mutable in-progress sets in one
      // read snapshot even when Prisma fetches relations with separate queries.
      return await this.prisma.$transaction(
        (tx) =>
          tx.workoutSession.findFirst({
            where: { id, userId },
            include: sessionInclude,
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
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

  addSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    input: CreateSetEntryInput,
  ): Promise<SetEntry> {
    return this.mutateSets(
      userId,
      sessionId,
      exerciseId,
      undefined,
      async (tx, sets) => {
        return tx.setEntry.create({
          data: {
            ...setValues(input),
            loadKg: new Prisma.Decimal(input.loadKg.toString()),
            reps: input.reps,
            workoutSessionExerciseId: exerciseId,
            position: (sets.at(-1)?.position ?? 0) + 1,
          },
        });
      },
    );
  }

  updateSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
    input: UpdateSetEntryInput,
  ): Promise<SetEntry> {
    return this.mutateSets(userId, sessionId, exerciseId, setId, (tx) =>
      tx.setEntry.update({
        where: { id: setId, workoutSessionExerciseId: exerciseId },
        data: setValues(input),
      }),
    );
  }

  removeSet(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string,
  ): Promise<void> {
    return this.mutateSets(
      userId,
      sessionId,
      exerciseId,
      setId,
      async (tx, sets) => {
        await tx.setEntry.delete({
          where: { id: setId, workoutSessionExerciseId: exerciseId },
        });
        // The deletion creates a free slot. Move down in ascending order so each
        // destination is free, preserving UNIQUE and CHECK(position >= 1).
        for (const [index, entry] of sets
          .filter((set) => set.id !== setId)
          .entries()) {
          if (entry.position !== index + 1)
            await tx.setEntry.update({
              where: { id: entry.id, workoutSessionExerciseId: exerciseId },
              data: { position: index + 1 },
            });
        }
      },
    );
  }

  private async mutateSets<T>(
    userId: string,
    sessionId: string,
    exerciseId: string,
    setId: string | undefined,
    operation: (tx: Prisma.TransactionClient, sets: SetEntry[]) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // The conditional parent UPDATE holds the same row lock used by
            // complete/cancel until commit. All set mutations serialize behind
            // it; after a terminal transition wins, this UPDATE affects zero rows.
            const editable = await tx.workoutSession.updateMany({
              where: { id: sessionId, userId, status: 'IN_PROGRESS' },
              data: { updatedAt: new Date() },
            });
            if (editable.count === 0) {
              const owned = await tx.workoutSession.findFirst({
                where: { id: sessionId, userId },
                select: { id: true },
              });
              if (!owned) throw new WorkoutSessionNotFoundError();
            }
            const exercise = await tx.workoutSessionExercise.findFirst({
              where: { id: exerciseId, workoutSessionId: sessionId },
              select: { id: true, sets: { orderBy: { position: 'asc' } } },
            });
            if (!exercise) throw new WorkoutSessionExerciseNotFoundError();
            if (
              setId !== undefined &&
              !exercise.sets.some((set) => set.id === setId)
            )
              throw new SetEntryNotFoundError();
            if (editable.count === 0)
              throw new WorkoutSessionNotEditableError();
            return operation(tx, exercise.sets);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error: unknown) {
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034') ||
          isSetPositionConflict(error)
        ) {
          if (attempt < 2) continue;
          throw new WorkoutSessionBusyError();
        }
        safeError(error);
      }
    }
    throw new WorkoutSessionBusyError();
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
