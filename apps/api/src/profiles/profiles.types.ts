import type {
  ExperienceLevel,
  TrainingGoal,
  UnitSystem,
} from '../generated/prisma/enums';

export interface OptionalProfileInput {
  birthDate?: string | null;
  heightCm?: number | null;
  experienceLevel?: ExperienceLevel | null;
  trainingGoal?: TrainingGoal | null;
  unitSystem?: UnitSystem;
}

export interface CreateProfileInput extends OptionalProfileInput {
  displayName: string;
}

export interface UpdateProfileInput extends OptionalProfileInput {
  displayName?: string;
}

// Internal, normalized persistence data. Identity is always a separate argument.
export interface ProfileData {
  displayName: string;
  birthDate: Date | null;
  heightCm: number | null;
  experienceLevel: ExperienceLevel | null;
  trainingGoal: TrainingGoal | null;
  unitSystem: UnitSystem;
}

export type ProfileChanges = Partial<ProfileData>;

export interface PublicProfile {
  displayName: string;
  birthDate: string | null;
  heightCm: number | null;
  experienceLevel: ExperienceLevel | null;
  trainingGoal: TrainingGoal | null;
  unitSystem: UnitSystem;
  createdAt: Date;
  updatedAt: Date;
}
