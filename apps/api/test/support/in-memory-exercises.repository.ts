import { randomUUID } from 'node:crypto';
import { exerciseCatalog } from '../../prisma/exercise-catalog';
import type { Exercise } from '../../src/generated/prisma/client';
import type { ExercisesRepository } from '../../src/exercises/exercises.repository';
import type { ExerciseListQuery } from '../../src/exercises/exercises.types';

export function catalogRecords(): Exercise[] {
  return exerciseCatalog.map((entry) => ({
    ...entry,
    instructions: [...entry.instructions],
    secondaryMuscles: [...entry.secondaryMuscles],
    id: randomUUID(),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }));
}

export class InMemoryExercisesRepository implements Pick<
  ExercisesRepository,
  'findMany' | 'findById'
> {
  constructor(readonly records: Exercise[] = catalogRecords()) {}

  async findMany(
    query: ExerciseListQuery,
  ): Promise<{ items: Exercise[]; total: number }> {
    const search = query.q?.toLowerCase();
    const filtered = this.records
      .filter(
        (exercise) =>
          exercise.isActive &&
          (search === undefined ||
            exercise.name.toLowerCase().includes(search) ||
            exercise.slug.toLowerCase().includes(search)) &&
          (query.primaryMuscle === undefined ||
            exercise.primaryMuscle === query.primaryMuscle) &&
          (query.equipment === undefined ||
            exercise.equipment === query.equipment) &&
          (query.movementPattern === undefined ||
            exercise.movementPattern === query.movementPattern),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
    return {
      items: filtered.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      total: filtered.length,
    };
  }

  async findById(id: string): Promise<Exercise | null> {
    return (
      this.records.find(
        (exercise) => exercise.id === id && exercise.isActive,
      ) ?? null
    );
  }
}
