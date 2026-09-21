import {
  Prisma,
  type Exercise,
  type PrismaClient,
} from '../src/generated/prisma/client';
import {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../src/generated/prisma/enums';
import { exerciseCatalog, type ExerciseSeedEntry } from './exercise-catalog';

export function validateExerciseCatalog(
  catalog: readonly ExerciseSeedEntry[],
): void {
  const slugs = new Set<string>();
  for (const exercise of catalog) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(exercise.slug) ||
      exercise.slug.length > 140 ||
      slugs.has(exercise.slug) ||
      exercise.name !== exercise.name.trim() ||
      [...exercise.name].length < 1 ||
      [...exercise.name].length > 120 ||
      !exercise.description.trim() ||
      exercise.description.length > 500 ||
      exercise.instructions.length === 0 ||
      exercise.instructions.some((step) => !step.trim() || step.length > 300) ||
      !Object.values(MuscleGroup).includes(exercise.primaryMuscle) ||
      exercise.secondaryMuscles.some(
        (muscle) =>
          !Object.values(MuscleGroup).includes(muscle) ||
          muscle === exercise.primaryMuscle,
      ) ||
      new Set(exercise.secondaryMuscles).size !==
        exercise.secondaryMuscles.length ||
      !Object.values(Equipment).includes(exercise.equipment) ||
      !Object.values(MovementPattern).includes(exercise.movementPattern) ||
      exercise.isActive !== true
    )
      throw new Error('Invalid exercise catalog data.');
    slugs.add(exercise.slug);
  }
}

// A narrow infrastructure port also lets unit tests verify idempotence without DB.
export interface ExerciseSeedWriter {
  upsert(args: Prisma.ExerciseUpsertArgs): Promise<Exercise>;
}

export async function upsertExerciseCatalog(
  writer: ExerciseSeedWriter,
  catalog: readonly ExerciseSeedEntry[],
): Promise<void> {
  validateExerciseCatalog(catalog);
  for (const exercise of catalog) {
    const data = {
      name: exercise.name,
      slug: exercise.slug,
      description: exercise.description,
      instructions: [...exercise.instructions],
      primaryMuscle: exercise.primaryMuscle,
      secondaryMuscles: [...exercise.secondaryMuscles],
      equipment: exercise.equipment,
      movementPattern: exercise.movementPattern,
      isActive: exercise.isActive,
    };
    await writer.upsert({
      where: { slug: data.slug },
      create: data,
      update: data,
    });
  }
}

export async function seedExercises(prisma: PrismaClient): Promise<void> {
  // Validate before opening a transaction; no partial catalog on a failed seed.
  validateExerciseCatalog(exerciseCatalog);
  await prisma.$transaction(
    async (transaction) => {
      await upsertExerciseCatalog(transaction.exercise, exerciseCatalog);
    },
    { timeout: 30000 },
  );
}
