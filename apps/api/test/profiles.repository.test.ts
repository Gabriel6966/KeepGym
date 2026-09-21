import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma, type Profile } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProfileAlreadyExistsError } from '../src/profiles/errors/profile-already-exists.error';
import { ProfileNotFoundError } from '../src/profiles/errors/profile-not-found.error';
import { ProfilePersistenceError } from '../src/profiles/errors/profile-persistence.error';
import { ProfilesRepository } from '../src/profiles/profiles.repository';
import type { ProfileData } from '../src/profiles/profiles.types';

const userId = '4506bce7-785c-477f-8ac1-cb1296f4d867';
const data: ProfileData = {
  displayName: 'Alex',
  birthDate: new Date('1998-04-15T00:00:00.000Z'),
  heightCm: 180,
  experienceLevel: 'INTERMEDIATE',
  trainingGoal: 'STRENGTH',
  unitSystem: 'METRIC',
};
const stored: Profile = {
  userId,
  ...data,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function setup(context: TestContext) {
  const profile = {
    create: context.mock.fn<
      (args: Prisma.ProfileCreateArgs) => Promise<Profile>
    >(async () => stored),
    findUnique: context.mock.fn<
      (args: Prisma.ProfileFindUniqueArgs) => Promise<Profile | null>
    >(async () => stored),
    update: context.mock.fn<
      (args: Prisma.ProfileUpdateArgs) => Promise<Profile>
    >(async () => stored),
  };
  const module = await Test.createTestingModule({
    providers: [
      ProfilesRepository,
      { provide: PrismaService, useValue: { profile } },
    ],
  }).compile();
  context.after(() => module.close());
  return { repository: module.get(ProfilesRepository), profile };
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    'Internal query details must not escape',
    { code, clientVersion: Prisma.prismaVersion.client, meta },
  );
}

void test('profile repository persists only allowed data and the separately supplied user identity', async (context) => {
  const { repository, profile } = await setup(context);
  const untrusted = {
    ...data,
    userId: 'ignored',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  assert.equal(await repository.create(userId, untrusted), stored);
  assert.deepEqual(profile.create.mock.calls[0]?.arguments, [
    { data: { ...data, userId } },
  ]);
  assert.equal(await repository.findByUserId(userId), stored);
  assert.deepEqual(profile.findUnique.mock.calls[0]?.arguments, [
    { where: { userId } },
  ]);
  profile.findUnique.mock.mockImplementation(async () => null);
  assert.equal(await repository.findByUserId(userId), null);
});

void test('profile repository update uses only userId as selector and preserves undefined versus null', async (context) => {
  const { repository, profile } = await setup(context);
  await repository.updateByUserId(userId, { heightCm: null });
  assert.deepEqual(profile.update.mock.calls[0]?.arguments, [
    {
      where: { userId },
      data: {
        displayName: undefined,
        birthDate: undefined,
        heightCm: null,
        experienceLevel: undefined,
        trainingGoal: undefined,
        unitSystem: undefined,
      },
    },
  ]);
});

const conflicts = [
  { modelName: 'Profile', target: 'profiles_pkey' },
  { modelName: 'Profile', target: ['userId'] },
  { modelName: 'Profile', target: ['user_id'] },
  {
    modelName: 'Profile',
    driverAdapterError: {
      cause: {
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'profiles_pkey' },
      },
    },
  },
];

for (const [index, meta] of conflicts.entries()) {
  void test(`profile repository translates the specific primary-key conflict (metadata variant ${index + 1})`, async (context) => {
    const { repository, profile } = await setup(context);
    profile.create.mock.mockImplementation(async () => {
      throw prismaError('P2002', meta);
    });
    await assert.rejects(repository.create(userId, data), (error: unknown) => {
      assert.ok(error instanceof ProfileAlreadyExistsError);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      return true;
    });
  });
}

const otherErrors = [
  prismaError('P2002', { modelName: 'User', target: 'profiles_pkey' }),
  prismaError('P2002', { modelName: 'Profile', target: ['displayName'] }),
  prismaError('P2002', {
    modelName: 'Profile',
    driverAdapterError: {
      cause: {
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'other_pkey' },
      },
    },
  }),
  prismaError('P2002'),
  prismaError('P2003', { modelName: 'Profile' }),
  new Error('Unexpected persistence failure'),
];

void test('unrelated Prisma and unexpected profile create errors are sanitized, never classified as duplicates', async (context) => {
  const { repository, profile } = await setup(context);
  for (const original of otherErrors) {
    profile.create.mock.mockImplementation(async () => {
      throw original;
    });
    await assert.rejects(repository.create(userId, data), (error: unknown) => {
      assert.ok(error instanceof ProfilePersistenceError);
      assert.equal('cause' in error, false);
      assert.equal('meta' in error, false);
      assert.equal('code' in error, false);
      return true;
    });
  }
});

void test('profile update translates P2025 absence but sanitizes unrelated errors; read failures are not missing profiles', async (context) => {
  const { repository, profile } = await setup(context);
  profile.update.mock.mockImplementation(async () => {
    throw prismaError('P2025', { modelName: 'Profile' });
  });
  await assert.rejects(
    repository.updateByUserId(userId, { heightCm: null }),
    ProfileNotFoundError,
  );
  for (const error of [
    prismaError('P2025', { modelName: 'User' }),
    prismaError('P2002'),
    new Error('Internal'),
  ]) {
    profile.update.mock.mockImplementation(async () => {
      throw error;
    });
    profile.findUnique.mock.mockImplementation(async () => {
      throw error;
    });
    await assert.rejects(
      repository.updateByUserId(userId, { displayName: 'Alex' }),
      ProfilePersistenceError,
    );
    await assert.rejects(
      repository.findByUserId(userId),
      ProfilePersistenceError,
    );
  }
});
