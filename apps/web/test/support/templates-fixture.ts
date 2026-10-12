import type {
  TemplateExercise,
  WorkoutTemplate,
} from '../../src/features/workout/workout.types';
import type { CatalogExercise } from '../../src/features/templates/templates.types';
import { templateFixture } from './workout-fixture';

export function catalogFixture(
  id = '55555555-5555-4555-8555-555555555555',
  name = 'Barbell Bench Press',
): CatalogExercise {
  return {
    id,
    name,
    slug: 'barbell-bench-press',
    description: null,
    instructions: [],
    primaryMuscle: 'CHEST',
    secondaryMuscles: ['TRICEPS'],
    equipment: 'BARBELL',
    movementPattern: 'HORIZONTAL_PUSH',
  };
}
export function templateEntry(
  id: string,
  catalogId: string,
  name: string,
  position: number,
): TemplateExercise {
  return {
    id,
    position,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    restSeconds: 90,
    notes: 'Planning guidance',
    exercise: {
      id: catalogId,
      name,
      slug: name.toLowerCase(),
      primaryMuscle: 'CHEST',
      equipment: 'BARBELL',
      movementPattern: 'HORIZONTAL_PUSH',
      isAvailable: true,
    },
  };
}
export function threeExerciseTemplate(): WorkoutTemplate {
  return {
    ...templateFixture(),
    exercises: [
      templateEntry('entry-a', 'catalog-a', 'A Bench', 1),
      templateEntry('entry-b', 'catalog-b', 'B Press', 2),
      templateEntry('entry-c', 'catalog-c', 'C Row', 3),
    ],
  };
}
