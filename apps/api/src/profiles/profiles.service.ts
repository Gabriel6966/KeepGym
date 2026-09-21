import { Injectable } from '@nestjs/common';
import type { Profile } from '../generated/prisma/client';
import {
  ExperienceLevel,
  TrainingGoal,
  UnitSystem,
} from '../generated/prisma/enums';
import { isValidBirthDate } from './birth-date';
import { InvalidProfileInputError } from './errors/invalid-profile-input.error';
import { ProfileNotFoundError } from './errors/profile-not-found.error';
import { ProfilesRepository } from './profiles.repository';
import type {
  CreateProfileInput,
  ProfileChanges,
  PublicProfile,
  UpdateProfileInput,
} from './profiles.types';

function normalizeChanges(input: UpdateProfileInput): ProfileChanges {
  const changes: ProfileChanges = {};
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string')
      throw new InvalidProfileInputError('displayName must be a string.');
    const name = input.displayName.trim();
    if ([...name].length < 1 || [...name].length > 80)
      throw new InvalidProfileInputError(
        'displayName must contain between 1 and 80 characters.',
      );
    changes.displayName = name;
  }
  if (input.birthDate !== undefined) {
    if (input.birthDate !== null && !isValidBirthDate(input.birthDate))
      throw new InvalidProfileInputError(
        'birthDate must be a real, non-future date in YYYY-MM-DD format.',
      );
    changes.birthDate =
      input.birthDate === null
        ? null
        : new Date(`${input.birthDate}T00:00:00.000Z`);
  }
  if (input.heightCm !== undefined) {
    if (
      input.heightCm !== null &&
      (!Number.isInteger(input.heightCm) ||
        input.heightCm < 50 ||
        input.heightCm > 300)
    )
      throw new InvalidProfileInputError(
        'heightCm must be an integer between 50 and 300.',
      );
    changes.heightCm = input.heightCm;
  }
  if (input.experienceLevel !== undefined) {
    if (
      input.experienceLevel !== null &&
      !Object.values(ExperienceLevel).includes(input.experienceLevel)
    )
      throw new InvalidProfileInputError(
        'experienceLevel must be a supported value.',
      );
    changes.experienceLevel = input.experienceLevel;
  }
  if (input.trainingGoal !== undefined) {
    if (
      input.trainingGoal !== null &&
      !Object.values(TrainingGoal).includes(input.trainingGoal)
    )
      throw new InvalidProfileInputError(
        'trainingGoal must be a supported value.',
      );
    changes.trainingGoal = input.trainingGoal;
  }
  if (input.unitSystem !== undefined) {
    if (!Object.values(UnitSystem).includes(input.unitSystem))
      throw new InvalidProfileInputError(
        'unitSystem must be METRIC or IMPERIAL.',
      );
    changes.unitSystem = input.unitSystem;
  }
  return changes;
}

function toPublicProfile(profile: Profile): PublicProfile {
  return {
    displayName: profile.displayName,
    birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null,
    heightCm: profile.heightCm,
    experienceLevel: profile.experienceLevel,
    trainingGoal: profile.trainingGoal,
    unitSystem: profile.unitSystem,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

@Injectable()
export class ProfilesService {
  constructor(private readonly repository: ProfilesRepository) {}

  async create(
    userId: string,
    input: CreateProfileInput,
  ): Promise<PublicProfile> {
    const data = normalizeChanges(input);
    if (data.displayName === undefined)
      throw new InvalidProfileInputError('displayName is required.');
    const profile = await this.repository.create(userId, {
      displayName: data.displayName,
      birthDate: data.birthDate ?? null,
      heightCm: data.heightCm ?? null,
      experienceLevel: data.experienceLevel ?? null,
      trainingGoal: data.trainingGoal ?? null,
      unitSystem: data.unitSystem ?? UnitSystem.METRIC,
    });
    return toPublicProfile(profile);
  }

  async getByUserId(userId: string): Promise<PublicProfile> {
    const profile = await this.repository.findByUserId(userId);
    if (!profile) throw new ProfileNotFoundError();
    return toPublicProfile(profile);
  }

  async update(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<PublicProfile> {
    const changes = normalizeChanges(input);
    if (Object.keys(changes).length === 0)
      throw new InvalidProfileInputError(
        'At least one profile field is required.',
      );
    return toPublicProfile(
      await this.repository.updateByUserId(userId, changes),
    );
  }
}
