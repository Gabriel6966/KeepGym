import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Test } from '@nestjs/testing';
import { isValidBirthDate } from '../src/profiles/birth-date';
import { InvalidProfileInputError } from '../src/profiles/errors/invalid-profile-input.error';
import { ProfileAlreadyExistsError } from '../src/profiles/errors/profile-already-exists.error';
import { ProfileNotFoundError } from '../src/profiles/errors/profile-not-found.error';
import { ProfilesRepository } from '../src/profiles/profiles.repository';
import { ProfilesService } from '../src/profiles/profiles.service';
import type {
  CreateProfileInput,
  PublicProfile,
  UpdateProfileInput,
} from '../src/profiles/profiles.types';
import { InMemoryProfilesRepository } from './support/in-memory-profiles.repository';

async function setup(context: TestContext) {
  const repository = new InMemoryProfilesRepository();
  const create = context.mock.method(repository, 'create');
  const find = context.mock.method(repository, 'findByUserId');
  const update = context.mock.method(repository, 'updateByUserId');
  const module = await Test.createTestingModule({
    providers: [
      ProfilesService,
      { provide: ProfilesRepository, useValue: repository },
    ],
  }).compile();
  context.after(() => module.close());
  return {
    service: module.get(ProfilesService),
    repository,
    create,
    find,
    update,
    userId: randomUUID(),
  };
}

function assertPublic(profile: PublicProfile) {
  assert.deepEqual(Object.keys(profile).sort(), [
    'birthDate',
    'createdAt',
    'displayName',
    'experienceLevel',
    'heightCm',
    'trainingGoal',
    'unitSystem',
    'updatedAt',
  ]);
}

void test('profile create trims only outer displayName whitespace, delegates once and sets explicit defaults', async (context) => {
  const { service, userId, create, find } = await setup(context);
  const result = await service.create(userId, {
    displayName: '  Álex  García  ',
  });
  assert.deepEqual(create.mock.calls[0]?.arguments, [
    userId,
    {
      displayName: 'Álex  García',
      birthDate: null,
      heightCm: null,
      experienceLevel: null,
      trainingGoal: null,
      unitSystem: 'METRIC',
    },
  ]);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(result.displayName, 'Álex  García');
  assert.equal(result.experienceLevel, null);
  assertPublic(result);
});

void test('profile dates are persisted at UTC midnight and exposed as exact date-only strings', async (context) => {
  const { service, userId, create } = await setup(context);
  const result = await service.create(userId, {
    displayName: 'Alex',
    birthDate: '2000-02-29',
    heightCm: 180,
    experienceLevel: 'INTERMEDIATE',
    trainingGoal: 'STRENGTH',
    unitSystem: 'IMPERIAL',
  });
  assert.equal(
    create.mock.calls[0]?.arguments[1].birthDate?.toISOString(),
    '2000-02-29T00:00:00.000Z',
  );
  assert.equal(result.birthDate, '2000-02-29');
  assert.equal(result.heightCm, 180);
  assert.equal(result.unitSystem, 'IMPERIAL');
  assertPublic(result);
});

void test('profile get is read-only, returns public data and reports absence without creating anything', async (context) => {
  const { service, userId, create, update } = await setup(context);
  await assert.rejects(service.getByUserId(userId), ProfileNotFoundError);
  assert.equal(create.mock.callCount(), 0);
  const original = await service.create(userId, { displayName: 'Alex' });
  assert.deepEqual(await service.getByUserId(userId), original);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(update.mock.callCount(), 0);
});

void test('profile update changes only supplied fields and preserves identity, birth date and creation date', async (context) => {
  const { service, userId, update } = await setup(context);
  const original = await service.create(userId, {
    displayName: 'Alex',
    birthDate: '1998-04-15',
    heightCm: 180,
  });
  const result = await service.update(userId, {
    displayName: '  Alex G  ',
    unitSystem: 'IMPERIAL',
  });
  assert.deepEqual(update.mock.calls[0]?.arguments, [
    userId,
    { displayName: 'Alex G', unitSystem: 'IMPERIAL' },
  ]);
  assert.equal(result.birthDate, '1998-04-15');
  assert.equal(result.heightCm, 180);
  assert.equal(result.createdAt, original.createdAt);
  assertPublic(result);
});

void test('profile optional fields can be cleared with null without resetting displayName or unitSystem', async (context) => {
  const { service, userId, update } = await setup(context);
  await service.create(userId, {
    displayName: 'Alex',
    birthDate: '1998-04-15',
    heightCm: 180,
    experienceLevel: 'ADVANCED',
    trainingGoal: 'ENDURANCE',
    unitSystem: 'IMPERIAL',
  });
  const clear = {
    birthDate: null,
    heightCm: null,
    experienceLevel: null,
    trainingGoal: null,
  };
  const result = await service.update(userId, clear);
  assert.deepEqual(update.mock.calls[0]?.arguments, [userId, clear]);
  for (const key of [
    'birthDate',
    'heightCm',
    'experienceLevel',
    'trainingGoal',
  ] as const)
    assert.equal(result[key], null);
  assert.equal(result.displayName, 'Alex');
  assert.equal(result.unitSystem, 'IMPERIAL');
});

void test('empty profile updates fail before persistence, and missing profiles are not upserted', async (context) => {
  const { service, userId, update, create } = await setup(context);
  await assert.rejects(service.update(userId, {}), InvalidProfileInputError);
  await assert.rejects(
    service.update(userId, { heightCm: undefined }),
    InvalidProfileInputError,
  );
  assert.equal(update.mock.callCount(), 0);
  await assert.rejects(
    service.update(userId, { heightCm: 180 }),
    ProfileNotFoundError,
  );
  assert.equal(create.mock.callCount(), 0);
});

void test('profile service validates its own domain inputs without leaking rejected values', async (context) => {
  const { service, userId, create, update } = await setup(context);
  const inputs: UpdateProfileInput[] = [
    { displayName: '  ' },
    { displayName: 'a'.repeat(81) },
    { birthDate: '2026-02-31' },
    { birthDate: '1998-04-15T00:00:00Z' },
    { birthDate: '9999-01-01' },
    { heightCm: 49 },
    { heightCm: 301 },
    { heightCm: 180.5 },
  ];
  for (const input of inputs)
    await assert.rejects(
      service.update(userId, input),
      InvalidProfileInputError,
    );
  await assert.rejects(
    service.create(userId, { displayName: ' ' }),
    InvalidProfileInputError,
  );
  assert.equal(create.mock.callCount(), 0);
  assert.equal(update.mock.callCount(), 0);
});

void test('profile service propagates the specific duplicate error and does not infer uniqueness from displayName', async (context) => {
  const { service, userId } = await setup(context);
  const input: CreateProfileInput = { displayName: 'Same Name' };
  await service.create(userId, input);
  await service.create(randomUUID(), input);
  await assert.rejects(
    service.create(userId, input),
    ProfileAlreadyExistsError,
  );
});

void test('birthDate validation checks calendar/leap days, date-only syntax and UTC today without a minimum age', () => {
  const now = new Date('2026-03-01T00:30:00.000Z');
  for (const date of [
    '0001-01-01',
    '1900-02-28',
    '2000-02-29',
    '2024-02-29',
    '2026-03-01',
  ])
    assert.equal(isValidBirthDate(date, now), true, date);
  for (const date of [
    '0000-01-01',
    '1900-02-29',
    '2026-02-29',
    '2026-02-31',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-03-02',
    '2026-3-1',
    '2026-03-01T00:00:00Z',
    ' 2026-03-01',
    '',
    null,
    20260301,
  ])
    assert.equal(isValidBirthDate(date, now), false);
});
