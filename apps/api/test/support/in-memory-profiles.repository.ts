import type { Profile } from '../../src/generated/prisma/client';
import { ProfileAlreadyExistsError } from '../../src/profiles/errors/profile-already-exists.error';
import { ProfileNotFoundError } from '../../src/profiles/errors/profile-not-found.error';
import type { ProfilesRepository } from '../../src/profiles/profiles.repository';
import type {
  ProfileChanges,
  ProfileData,
} from '../../src/profiles/profiles.types';

export class InMemoryProfilesRepository implements Pick<
  ProfilesRepository,
  'create' | 'findByUserId' | 'updateByUserId'
> {
  readonly records = new Map<string, Profile>();

  async create(userId: string, data: ProfileData): Promise<Profile> {
    if (this.records.has(userId)) throw new ProfileAlreadyExistsError();
    const profile: Profile = {
      ...data,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(userId, profile);
    return { ...profile };
  }

  async findByUserId(userId: string): Promise<Profile | null> {
    const profile = this.records.get(userId);
    return profile ? { ...profile } : null;
  }

  async updateByUserId(
    userId: string,
    changes: ProfileChanges,
  ): Promise<Profile> {
    const existing = this.records.get(userId);
    if (!existing) throw new ProfileNotFoundError();
    const profile = { ...existing, ...changes, updatedAt: new Date() };
    this.records.set(userId, profile);
    return { ...profile };
  }
}
