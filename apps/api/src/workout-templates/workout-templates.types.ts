import type { Prisma } from '../generated/prisma/client';

// Only catalog summary fields are fetched, including inactive linked exercises.
export const templateInclude = {
  exercises: {
    orderBy: { position: 'asc' },
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          slug: true,
          primaryMuscle: true,
          equipment: true,
          movementPattern: true,
          isActive: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutTemplateInclude;

export type TemplateRecord = Prisma.WorkoutTemplateGetPayload<{
  include: typeof templateInclude;
}>;
export type TemplateExerciseRecord = TemplateRecord['exercises'][number];

export interface TemplateInput {
  name: string;
  description?: string | null;
}
export interface TemplateChanges {
  name?: string;
  description?: string | null;
}
export interface ExerciseTargets {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds?: number;
  notes?: string | null;
}
export interface AddTemplateExerciseInput extends ExerciseTargets {
  exerciseId: string;
}
export type TemplateExerciseChanges = Partial<ExerciseTargets>;
export interface TemplateListInput {
  q?: string;
  page?: number;
  limit?: number;
}
export interface TemplateListQuery {
  q?: string;
  page: number;
  limit: number;
}

export interface PublicTemplateExercise {
  id: string;
  position: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  notes: string | null;
  exercise: Omit<TemplateExerciseRecord['exercise'], 'isActive'> & {
    isAvailable: boolean;
  };
}
export interface PublicWorkoutTemplate {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  exercises: PublicTemplateExercise[];
}
export interface WorkoutTemplatePage {
  items: PublicWorkoutTemplate[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
