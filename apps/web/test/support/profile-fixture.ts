import type { Profile } from '../../src/features/profile/profile.types';

export const profileFixture = (changes: Partial<Profile> = {}): Profile => ({
  displayName: 'Original  Name',
  birthDate: '1995-04-10',
  heightCm: 180,
  experienceLevel: 'BEGINNER',
  trainingGoal: 'GENERAL_FITNESS',
  unitSystem: 'METRIC',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...changes,
});
