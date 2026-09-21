import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Exercise } from '../generated/prisma/client';
import {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../generated/prisma/enums';
import { ExerciseNotFoundError } from './errors/exercise-not-found.error';
import { InvalidExerciseQueryError } from './errors/invalid-exercise-query.error';
import { ExercisesRepository } from './exercises.repository';
import type {
  ExerciseListQuery,
  ExercisePage,
  ListExercisesInput,
  PublicExercise,
} from './exercises.types';

function normalizeQuery(input: ListExercisesInput): ExerciseListQuery {
  const page = input.page === undefined ? 1 : input.page;
  const limit = input.limit === undefined ? 20 : input.limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new InvalidExerciseQueryError(
      'page must be a positive integer and limit must be between 1 and 100.',
    );
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset) || offset > 2147483647) {
    throw new InvalidExerciseQueryError(
      'The requested page exceeds the supported pagination range.',
    );
  }
  let q: string | undefined;
  if (input.q !== undefined) {
    if (typeof input.q !== 'string')
      throw new InvalidExerciseQueryError('q must be a string.');
    q = input.q.trim();
    if ([...q].length < 1 || [...q].length > 100)
      throw new InvalidExerciseQueryError(
        'q must contain between 1 and 100 characters.',
      );
  }
  if (
    input.primaryMuscle !== undefined &&
    !Object.values(MuscleGroup).includes(input.primaryMuscle)
  )
    throw new InvalidExerciseQueryError(
      'primaryMuscle must be a supported value.',
    );
  if (
    input.equipment !== undefined &&
    !Object.values(Equipment).includes(input.equipment)
  )
    throw new InvalidExerciseQueryError('equipment must be a supported value.');
  if (
    input.movementPattern !== undefined &&
    !Object.values(MovementPattern).includes(input.movementPattern)
  )
    throw new InvalidExerciseQueryError(
      'movementPattern must be a supported value.',
    );
  return {
    q,
    primaryMuscle: input.primaryMuscle,
    equipment: input.equipment,
    movementPattern: input.movementPattern,
    page,
    limit,
  };
}

function toPublicExercise(exercise: Exercise): PublicExercise {
  return {
    id: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    description: exercise.description,
    instructions: [...exercise.instructions],
    primaryMuscle: exercise.primaryMuscle,
    secondaryMuscles: [...exercise.secondaryMuscles],
    equipment: exercise.equipment,
    movementPattern: exercise.movementPattern,
  };
}

@Injectable()
export class ExercisesService {
  constructor(private readonly repository: ExercisesRepository) {}

  async list(input: ListExercisesInput = {}): Promise<ExercisePage> {
    const query = normalizeQuery(input);
    const { items, total } = await this.repository.findMany(query);
    return {
      items: items.map(toPublicExercise),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(id: string): Promise<PublicExercise> {
    if (!isUUID(id))
      throw new InvalidExerciseQueryError('Exercise id must be a UUID.');
    const exercise = await this.repository.findById(id);
    if (!exercise || !exercise.isActive) throw new ExerciseNotFoundError();
    return toPublicExercise(exercise);
  }
}
