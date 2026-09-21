import { Injectable } from '@nestjs/common';
import { Prisma, type Profile } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileAlreadyExistsError } from './errors/profile-already-exists.error';
import { ProfileNotFoundError } from './errors/profile-not-found.error';
import { ProfilePersistenceError } from './errors/profile-persistence.error';
import type { ProfileChanges, ProfileData } from './profiles.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProfileError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code &&
    (error.meta?.modelName === undefined || error.meta.modelName === 'Profile')
  );
}

function isProfileDuplicate(error: unknown): boolean {
  if (!isProfileError(error, 'P2002')) return false;
  const target = error.meta?.target;
  if (
    target === 'profiles_pkey' ||
    (Array.isArray(target) &&
      target.length === 1 &&
      (target[0] === 'userId' || target[0] === 'user_id'))
  )
    return true;

  const adapter = error.meta?.driverAdapterError;
  if (!isRecord(adapter) || !isRecord(adapter.cause)) return false;
  const { kind, constraint } = adapter.cause;
  return (
    kind === 'UniqueConstraintViolation' &&
    isRecord(constraint) &&
    constraint.index === 'profiles_pkey'
  );
}

// Explicit allowlist prevents identity/timestamps from being written as input.
function writableFields(input: ProfileChanges): ProfileChanges {
  return {
    displayName: input.displayName,
    birthDate: input.birthDate,
    heightCm: input.heightCm,
    experienceLevel: input.experienceLevel,
    trainingGoal: input.trainingGoal,
    unitSystem: input.unitSystem,
  };
}

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: ProfileData): Promise<Profile> {
    try {
      return await this.prisma.profile.create({
        data: {
          ...writableFields(input),
          displayName: input.displayName,
          userId,
        },
      });
    } catch (error: unknown) {
      if (isProfileDuplicate(error)) throw new ProfileAlreadyExistsError();
      throw new ProfilePersistenceError();
    }
  }

  async findByUserId(userId: string): Promise<Profile | null> {
    try {
      return await this.prisma.profile.findUnique({ where: { userId } });
    } catch {
      throw new ProfilePersistenceError();
    }
  }

  async updateByUserId(
    userId: string,
    input: ProfileChanges,
  ): Promise<Profile> {
    try {
      return await this.prisma.profile.update({
        where: { userId },
        data: writableFields(input),
      });
    } catch (error: unknown) {
      if (isProfileError(error, 'P2025')) throw new ProfileNotFoundError();
      throw new ProfilePersistenceError();
    }
  }
}
