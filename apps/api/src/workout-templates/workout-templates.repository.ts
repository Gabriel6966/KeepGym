import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExerciseAlreadyInTemplateError } from './errors/exercise-already-in-template.error';
import { InvalidWorkoutTemplateInputError } from './errors/invalid-workout-template-input.error';
import { TemplateExerciseNotFoundError } from './errors/template-exercise-not-found.error';
import { WorkoutTemplateNotFoundError } from './errors/workout-template-not-found.error';
import { WorkoutTemplatePersistenceError } from './errors/workout-template-persistence.error';
import { WorkoutTemplateBusyError } from './errors/workout-template-busy.error';
import { validateOrder, validateTargets } from './workout-template.validation';
import {
  templateInclude,
  type AddTemplateExerciseInput,
  type TemplateChanges,
  type TemplateExerciseChanges,
  type TemplateInput,
  type TemplateListQuery,
  type TemplateRecord,
} from './workout-templates.types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function uniqueConstraint(
  error: unknown,
  field: 'exerciseId' | 'position',
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002' ||
    (error.meta?.modelName !== undefined &&
      error.meta.modelName !== 'WorkoutTemplateExercise')
  )
    return false;
  const name =
    field === 'position'
      ? 'template_exercises_position_key'
      : 'template_exercises_exercise_key';
  const target = error.meta?.target;
  if (target === name) return true;
  if (
    Array.isArray(target) &&
    target.length === 2 &&
    (target.includes('workoutTemplateId') ||
      target.includes('workout_template_id')) &&
    (target.includes(field) ||
      (field === 'exerciseId' && target.includes('exercise_id')))
  )
    return true;
  const adapter = error.meta?.driverAdapterError;
  return (
    record(adapter) &&
    record(adapter.cause) &&
    adapter.cause.kind === 'UniqueConstraintViolation' &&
    record(adapter.cause.constraint) &&
    adapter.cause.constraint.index === name
  );
}

function rethrowSafe(error: unknown): never {
  if (
    error instanceof WorkoutTemplateNotFoundError ||
    error instanceof TemplateExerciseNotFoundError ||
    error instanceof InvalidWorkoutTemplateInputError ||
    error instanceof ExerciseAlreadyInTemplateError
  )
    throw error;
  if (uniqueConstraint(error, 'exerciseId'))
    throw new ExerciseAlreadyInTemplateError();
  throw new WorkoutTemplatePersistenceError();
}

@Injectable()
export class WorkoutTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTemplate(
    userId: string,
    input: TemplateInput,
  ): Promise<TemplateRecord> {
    try {
      return await this.prisma.workoutTemplate.create({
        data: { userId, name: input.name, description: input.description },
        include: templateInclude,
      });
    } catch (error: unknown) {
      rethrowSafe(error);
    }
  }

  async findTemplatesByUser(
    userId: string,
    query: TemplateListQuery,
  ): Promise<{ items: TemplateRecord[]; total: number }> {
    const search = query.q?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.WorkoutTemplateWhereInput = {
      userId,
      archivedAt: null,
      ...(search === undefined
        ? {}
        : { name: { contains: search, mode: 'insensitive' } }),
    };
    try {
      const [items, total] = await this.prisma.$transaction(
        [
          this.prisma.workoutTemplate.findMany({
            where,
            include: templateInclude,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          }),
          this.prisma.workoutTemplate.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items, total };
    } catch (error: unknown) {
      rethrowSafe(error);
    }
  }

  async findTemplateByIdAndUser(
    userId: string,
    id: string,
  ): Promise<TemplateRecord | null> {
    try {
      return await this.prisma.workoutTemplate.findFirst({
        where: { id, userId, archivedAt: null },
        include: templateInclude,
      });
    } catch (error: unknown) {
      rethrowSafe(error);
    }
  }

  updateTemplate(
    userId: string,
    id: string,
    input: TemplateChanges,
  ): Promise<TemplateRecord> {
    return this.mutate(userId, id, async (tx) =>
      tx.workoutTemplate.update({
        where: { id, userId, archivedAt: null },
        data: { name: input.name, description: input.description },
        include: templateInclude,
      }),
    );
  }

  archiveTemplate(userId: string, id: string): Promise<void> {
    return this.mutate(userId, id, async (tx) => {
      await tx.workoutTemplate.update({
        where: { id, userId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
    });
  }

  addExercise(userId: string, id: string, input: AddTemplateExerciseInput) {
    return this.mutate(userId, id, async (tx, template) => {
      if (
        template.exercises.some(
          (entry) => entry.exerciseId === input.exerciseId,
        )
      )
        throw new ExerciseAlreadyInTemplateError();
      validateTargets(input);
      const position = (template.exercises.at(-1)?.position ?? 0) + 1;
      return tx.workoutTemplateExercise.create({
        data: {
          workoutTemplateId: id,
          exerciseId: input.exerciseId,
          position,
          targetSets: input.targetSets,
          targetRepsMin: input.targetRepsMin,
          targetRepsMax: input.targetRepsMax,
          restSeconds: input.restSeconds,
          notes: input.notes,
        },
        include: templateInclude.exercises.include,
      });
    });
  }

  updateTemplateExercise(
    userId: string,
    id: string,
    childId: string,
    input: TemplateExerciseChanges,
  ) {
    return this.mutate(userId, id, async (tx, template) => {
      const current = template.exercises.find((entry) => entry.id === childId);
      if (!current) throw new TemplateExerciseNotFoundError();
      const changes = {
        targetSets: input.targetSets ?? current.targetSets,
        targetRepsMin: input.targetRepsMin ?? current.targetRepsMin,
        targetRepsMax: input.targetRepsMax ?? current.targetRepsMax,
        restSeconds: input.restSeconds ?? current.restSeconds,
        notes: input.notes === undefined ? current.notes : input.notes,
      };
      validateTargets(changes);
      return tx.workoutTemplateExercise.update({
        where: { id: childId, workoutTemplateId: id },
        data: changes,
        include: templateInclude.exercises.include,
      });
    });
  }

  removeTemplateExercise(
    userId: string,
    id: string,
    childId: string,
  ): Promise<void> {
    return this.mutate(userId, id, async (tx, template) => {
      if (!template.exercises.some((entry) => entry.id === childId))
        throw new TemplateExerciseNotFoundError();
      await tx.workoutTemplateExercise.delete({
        where: { id: childId, workoutTemplateId: id },
      });
      await this.writeOrder(
        tx,
        id,
        template.exercises
          .filter((entry) => entry.id !== childId)
          .map((entry) => entry.id),
      );
    });
  }

  reorderTemplateExercises(
    userId: string,
    id: string,
    ids: string[],
  ): Promise<TemplateRecord> {
    return this.mutate(userId, id, async (tx, template) => {
      validateOrder(
        ids,
        template.exercises.map((entry) => entry.id),
      );
      await this.writeOrder(tx, id, ids);
      return tx.workoutTemplate.findFirstOrThrow({
        where: { id, userId, archivedAt: null },
        include: templateInclude,
      });
    });
  }

  private async writeOrder(
    tx: Prisma.TransactionClient,
    id: string,
    ids: string[],
  ): Promise<void> {
    // Negative positions are private to this transaction. Clearing the positive
    // range first avoids transient collisions with the non-deferrable UNIQUE.
    for (const [index, childId] of ids.entries()) {
      await tx.workoutTemplateExercise.update({
        where: { id: childId, workoutTemplateId: id },
        data: { position: -(index + 1) },
      });
    }
    for (const [index, childId] of ids.entries()) {
      await tx.workoutTemplateExercise.update({
        where: { id: childId, workoutTemplateId: id },
        data: { position: index + 1 },
      });
    }
  }

  private async mutate<T>(
    userId: string,
    id: string,
    operation: (
      tx: Prisma.TransactionClient,
      template: TemplateRecord,
    ) => Promise<T>,
  ): Promise<T> {
    // All mutations write the same parent first. Serializable isolation plus
    // bounded retries serializes competing add/order/archive/partial updates.
    // Validation and temporary positions roll back together on every failure.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const touched = await tx.workoutTemplate.updateMany({
              where: { id, userId, archivedAt: null },
              data: { updatedAt: new Date() },
            });
            if (touched.count !== 1) throw new WorkoutTemplateNotFoundError();
            const template = await tx.workoutTemplate.findFirst({
              where: { id, userId, archivedAt: null },
              include: templateInclude,
            });
            if (!template) throw new WorkoutTemplateNotFoundError();
            return operation(tx, template);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        const retryable =
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034') ||
          uniqueConstraint(error, 'position');
        if (retryable) {
          if (attempt < 2) continue;
          throw new WorkoutTemplateBusyError();
        }
        rethrowSafe(error);
      }
    }
    throw new WorkoutTemplateBusyError();
  }
}
