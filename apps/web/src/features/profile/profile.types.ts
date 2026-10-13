export const experienceOptions = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
] as const;
export const goalOptions = [
  { value: 'GENERAL_FITNESS', label: 'General fitness' },
  { value: 'MUSCLE_GAIN', label: 'Muscle gain' },
  { value: 'STRENGTH', label: 'Strength' },
  { value: 'ENDURANCE', label: 'Endurance' },
] as const;
export const unitOptions = [
  { value: 'METRIC', label: 'Metric' },
  { value: 'IMPERIAL', label: 'Imperial' },
] as const;
export type ExperienceLevel = (typeof experienceOptions)[number]['value'];
export type TrainingGoal = (typeof goalOptions)[number]['value'];
export type UnitSystem = (typeof unitOptions)[number]['value'];
export interface Profile {
  displayName: string;
  birthDate: string | null;
  heightCm: number | null;
  experienceLevel: ExperienceLevel | null;
  trainingGoal: TrainingGoal | null;
  unitSystem: UnitSystem;
  createdAt: string;
  updatedAt: string;
}
export interface ProfileInput {
  displayName: string;
  birthDate?: string | null;
  heightCm?: number | null;
  experienceLevel?: ExperienceLevel | null;
  trainingGoal?: TrainingGoal | null;
  unitSystem?: UnitSystem;
}
export type ProfileChanges = Partial<ProfileInput>;
