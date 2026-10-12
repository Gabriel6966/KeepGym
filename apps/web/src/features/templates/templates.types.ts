import type { MuscleGroup } from '../dashboard/dashboard.types';
import type { equipmentValues, movementValues } from '../workout/workout.types';

export interface TemplateMetadataInput {
  name: string;
  description?: string | null;
}
export interface PlanningInput {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds?: number;
  notes?: string | null;
}
export interface AddTemplateExerciseInput extends PlanningInput {
  exerciseId: string;
}
export interface CatalogExercise {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  instructions: string[];
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: (typeof equipmentValues)[number];
  movementPattern: (typeof movementValues)[number];
}
export interface CatalogQuery {
  q?: string;
  primaryMuscle?: MuscleGroup;
  equipment?: CatalogExercise['equipment'];
  movementPattern?: CatalogExercise['movementPattern'];
  page?: number;
  limit?: number;
}
