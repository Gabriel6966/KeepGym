import type { Prisma } from '../generated/prisma/client';
import type {
  PublicSetEntry,
  PublicWorkoutSessionExercise,
} from '../workout-sessions/workout-sessions.types';

export const recordExerciseSelect = {
  sourceExerciseId: true,
  exerciseName: true,
  exerciseSlug: true,
  primaryMuscle: true,
  secondaryMuscles: true,
  equipment: true,
  movementPattern: true,
} satisfies Prisma.WorkoutSessionExerciseSelect;
export type RecordExerciseSnapshot = Prisma.WorkoutSessionExerciseGetPayload<{
  select: typeof recordExerciseSelect;
}>;

// Raw NUMERIC values remain decimal text until public conversion, just as in
// Analytics. Only the selected holders/candidates, never all sets, are loaded.
export interface RecordCandidate {
  sessionId: string;
  sessionName: string;
  sessionStartedAt: Date;
  setId: string;
  position: number;
  loadKg: string;
  reps: number;
  rpe: string | null;
  rir: number | null;
  completedAt: Date;
}
export interface ExerciseRecordData {
  exercise: RecordExerciseSnapshot | null;
  maxLoad: RecordCandidate | null;
  estimatedCandidates: RecordCandidate[];
}
export const personalRecordTypes = ['MAX_LOAD', 'ESTIMATED_1RM'] as const;
export type PersonalRecordType = (typeof personalRecordTypes)[number];
export interface CurrentRecordCandidate extends RecordCandidate {
  sourceExerciseId: string;
  exerciseName: string;
  exerciseSlug: string;
}
export interface CurrentRecordData {
  maxLoadCandidates: CurrentRecordCandidate[];
  estimatedCandidates: CurrentRecordCandidate[];
}
export interface PublicCurrentRecord {
  type: PersonalRecordType;
  exercise: { sourceExerciseId: string; name: string; slug: string };
  valueKg: number;
  achievedAt: Date;
  workoutSessionId: string;
  setEntryId: string;
  loadKg: number;
  reps: number;
}
export interface PublicCurrentRecords {
  items: PublicCurrentRecord[];
}
export interface PublicPersonalRecord<T extends PersonalRecordType> {
  type: T;
  valueKg: number;
  achievedAt: Date;
  session: { id: string; name: string; startedAt: Date };
  set: PublicSetEntry;
}
export interface ExerciseRecords {
  exercise: PublicWorkoutSessionExercise['exercise'] | null;
  maxLoadRecord: PublicPersonalRecord<'MAX_LOAD'> | null;
  estimated1RMRecord: PublicPersonalRecord<'ESTIMATED_1RM'> | null;
}
