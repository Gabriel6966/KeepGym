import { Injectable } from '@nestjs/common';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutTemplateNotFoundError } from './errors/workout-template-not-found.error';
import { WorkoutTemplatesRepository } from './workout-templates.repository';
import {
  normalizeList,
  normalizeTemplate,
  validateIds,
  validateOrder,
  validateTargetChanges,
  validateTargets,
} from './workout-template.validation';
import type {
  AddTemplateExerciseInput,
  PublicTemplateExercise,
  PublicWorkoutTemplate,
  TemplateChanges,
  TemplateExerciseChanges,
  TemplateExerciseRecord,
  TemplateInput,
  TemplateListInput,
  TemplateRecord,
  WorkoutTemplatePage,
} from './workout-templates.types';

function publicEntry(entry: TemplateExerciseRecord): PublicTemplateExercise {
  return {
    id: entry.id,
    position: entry.position,
    targetSets: entry.targetSets,
    targetRepsMin: entry.targetRepsMin,
    targetRepsMax: entry.targetRepsMax,
    restSeconds: entry.restSeconds,
    notes: entry.notes,
    exercise: {
      id: entry.exercise.id,
      name: entry.exercise.name,
      slug: entry.exercise.slug,
      primaryMuscle: entry.exercise.primaryMuscle,
      equipment: entry.exercise.equipment,
      movementPattern: entry.exercise.movementPattern,
      isAvailable: entry.exercise.isActive,
    },
  };
}
function publicTemplate(template: TemplateRecord): PublicWorkoutTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    exercises: [...template.exercises]
      .sort((a, b) => a.position - b.position)
      .map(publicEntry),
  };
}

@Injectable()
export class WorkoutTemplatesService {
  constructor(
    private readonly repository: WorkoutTemplatesRepository,
    private readonly exercises: ExercisesService,
  ) {}

  async create(
    userId: string,
    input: TemplateInput,
  ): Promise<PublicWorkoutTemplate> {
    validateIds(userId);
    const normalized = normalizeTemplate(input, true);
    return publicTemplate(
      await this.repository.createTemplate(userId, {
        name: input.name.trim(),
        description: normalized.description,
      }),
    );
  }

  async list(
    userId: string,
    input: TemplateListInput = {},
  ): Promise<WorkoutTemplatePage> {
    validateIds(userId);
    const query = normalizeList(input);
    const { items, total } = await this.repository.findTemplatesByUser(
      userId,
      query,
    );
    return {
      items: items.map(publicTemplate),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(userId: string, id: string): Promise<PublicWorkoutTemplate> {
    validateIds(userId, id);
    const template = await this.repository.findTemplateByIdAndUser(userId, id);
    if (!template) throw new WorkoutTemplateNotFoundError();
    return publicTemplate(template);
  }

  async update(
    userId: string,
    id: string,
    input: TemplateChanges,
  ): Promise<PublicWorkoutTemplate> {
    validateIds(userId, id);
    return publicTemplate(
      await this.repository.updateTemplate(
        userId,
        id,
        normalizeTemplate(input),
      ),
    );
  }

  async archive(userId: string, id: string): Promise<void> {
    validateIds(userId, id);
    await this.repository.archiveTemplate(userId, id);
  }

  async addExercise(
    userId: string,
    id: string,
    input: AddTemplateExerciseInput,
  ): Promise<PublicTemplateExercise> {
    validateIds(userId, id, input.exerciseId);
    validateTargets(input);
    // Resolve ownership before consulting the global catalog. Persistence
    // rechecks ownership in the transaction, including a concurrent archive.
    await this.getById(userId, id);
    await this.exercises.getById(input.exerciseId);
    return publicEntry(
      await this.repository.addExercise(userId, id, {
        exerciseId: input.exerciseId,
        targetSets: input.targetSets,
        targetRepsMin: input.targetRepsMin,
        targetRepsMax: input.targetRepsMax,
        restSeconds: input.restSeconds === undefined ? 90 : input.restSeconds,
        notes: input.notes,
      }),
    );
  }

  async updateExercise(
    userId: string,
    id: string,
    childId: string,
    input: TemplateExerciseChanges,
  ): Promise<PublicTemplateExercise> {
    validateIds(userId, id, childId);
    const changes = validateTargetChanges(input);
    return publicEntry(
      await this.repository.updateTemplateExercise(
        userId,
        id,
        childId,
        changes,
      ),
    );
  }

  async removeExercise(
    userId: string,
    id: string,
    childId: string,
  ): Promise<void> {
    validateIds(userId, id, childId);
    await this.repository.removeTemplateExercise(userId, id, childId);
  }

  async reorder(
    userId: string,
    id: string,
    ids: string[],
  ): Promise<PublicWorkoutTemplate> {
    validateIds(userId, id);
    validateOrder(ids);
    return publicTemplate(
      await this.repository.reorderTemplateExercises(userId, id, ids),
    );
  }
}
