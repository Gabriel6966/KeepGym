import type {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../generated/prisma/enums';

export interface ListExercisesInput {
  q?: string;
  primaryMuscle?: MuscleGroup;
  equipment?: Equipment;
  movementPattern?: MovementPattern;
  page?: number;
  limit?: number;
}

export interface ExerciseListQuery extends ListExercisesInput {
  page: number;
  limit: number;
}

export interface PublicExercise {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  instructions: string[];
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  movementPattern: MovementPattern;
}

export interface ExercisePage {
  items: PublicExercise[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
