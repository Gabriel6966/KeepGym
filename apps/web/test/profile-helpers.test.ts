import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  profileDraft,
  validBirthDate,
  validateProfileDraft,
} from '../src/features/profile/profile.validation';
import { isProfile } from '../src/features/profile/profile.contract';
import {
  profileMutationMessage,
  ambiguousProfileWrite,
} from '../src/features/profile/profile-state';
import { validateRegistration } from '../src/features/auth/register.validation';
import {
  afterProfileCheck,
  onboardingPath,
} from '../src/features/auth/onboarding-routing';
import { authReturnPath } from '../src/features/auth/return-path';
import {
  experienceOptions,
  goalOptions,
  unitOptions,
} from '../src/features/profile/profile.types';
import { ApiError } from '../src/lib/api-client';
import { profileFixture } from './support/profile-fixture';

const today = '2026-10-13';
void test('only displayName is required; nullable stable fields and default METRIC do not include weight', () => {
  const draft = { ...profileDraft(), displayName: '  A  Name  ' };
  assert.deepEqual(validateProfileDraft(draft, today).input, {
    displayName: 'A  Name',
    birthDate: null,
    heightCm: null,
    experienceLevel: null,
    trainingGoal: null,
    unitSystem: 'METRIC',
  });
});
for (const name of ['', ' '.repeat(2), 'x'.repeat(81)])
  void test('display name rejects empty/overlong ' + name.length, () =>
    assert.ok(
      validateProfileDraft({ ...profileDraft(), displayName: name }, today)
        .errors?.displayName,
    ),
  );
void test('displayName Unicode length and trim match backend; internal spaces remain', () => {
  assert.equal(
    validateProfileDraft(
      { ...profileDraft(), displayName: '😀'.repeat(80) },
      today,
    ).errors,
    undefined,
  );
  assert.equal(
    validateProfileDraft({ ...profileDraft(), displayName: ' A  B ' }, today)
      .input?.displayName,
    'A  B',
  );
});
for (const [value, valid] of [
  ['2000-02-29', true],
  ['1900-02-29', false],
  ['2026-02-30', false],
  ['1995-04-10', true],
  ['2026-10-14', false],
  ['2026-10-13', true],
  ['1995-04-10T00:00:00Z', false],
  ['0000-01-01', false],
] as const)
  void test('birth DATE-only validation ' + value, () =>
    assert.equal(validBirthDate(value, today), valid),
  );
for (const tz of ['Europe/Madrid', 'UTC', 'America/New_York'])
  void test('birthDate stays 1995-04-10 independently of ' + tz, () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const {profileDraft,validateProfileDraft}=require(${JSON.stringify(require.resolve('../src/features/profile/profile.validation'))});const result=validateProfileDraft({...profileDraft(),displayName:'Name',birthDate:'1995-04-10'},'2026-10-13');process.stdout.write(result.input.birthDate);`,
      ],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '1995-04-10');
  });
for (const height of ['0', '49', '301', '180.5', '1e2', 'abc', '-50'])
  void test('height rejects noncanonical integer ' + height, () =>
    assert.ok(
      validateProfileDraft(
        { ...profileDraft(), displayName: 'Name', heightCm: height },
        today,
      ).errors?.heightCm,
    ),
  );
void test('height boundaries/null are supported with no imperial conversion', () => {
  for (const [text, value] of [
    ['', null],
    ['50', 50],
    ['300', 300],
  ] as const)
    assert.equal(
      validateProfileDraft(
        {
          ...profileDraft(),
          displayName: 'Name',
          heightCm: text,
          unitSystem: 'IMPERIAL',
        },
        today,
      ).input?.heightCm,
      value,
    );
});
void test('all canonical enum options map labels to API constants, not user-facing labels', () => {
  for (const option of experienceOptions)
    assert.equal(
      validateProfileDraft(
        {
          ...profileDraft(),
          displayName: 'Name',
          experienceLevel: option.value,
        },
        today,
      ).input?.experienceLevel,
      option.value,
    );
  for (const option of goalOptions)
    assert.equal(
      validateProfileDraft(
        { ...profileDraft(), displayName: 'Name', trainingGoal: option.value },
        today,
      ).input?.trainingGoal,
      option.value,
    );
  for (const option of unitOptions)
    assert.equal(
      validateProfileDraft(
        { ...profileDraft(), displayName: 'Name', unitSystem: option.value },
        today,
      ).input?.unitSystem,
      option.value,
    );
  assert.ok(
    validateProfileDraft(
      {
        ...profileDraft(),
        displayName: 'Name',
        experienceLevel: 'Beginner',
        trainingGoal: 'Strength',
        unitSystem: 'Metric',
      },
      today,
    ).errors,
  );
});
void test('PATCH sends only changed fields including explicit null and unchanged birthDate is omitted', () => {
  const original = profileFixture(),
    draft = profileDraft(original);
  assert.deepEqual(
    validateProfileDraft(
      { ...draft, heightCm: '185', trainingGoal: '' },
      today,
      original,
    ).input,
    { heightCm: 185, trainingGoal: null },
  );
  assert.ok(validateProfileDraft(draft, today, original).errors?.form);
});
void test('profile contract checks nullable fields and actual enums without accepting partial success', () => {
  assert.ok(isProfile(profileFixture()));
  assert.ok(
    isProfile(
      profileFixture({
        birthDate: null,
        heightCm: null,
        experienceLevel: null,
        trainingGoal: null,
      }),
    ),
  );
  for (const fields of [
    { birthDate: '2026-02-30' },
    { heightCm: 0 },
    { unitSystem: null },
    { experienceLevel: 'Beginner' },
    { updatedAt: 'yesterday' },
  ])
    assert.equal(isProfile({ ...profileFixture(), ...fields }), false);
});
void test('safe destinations survive onboarding while open redirects and auth loops fall back', () => {
  assert.equal(afterProfileCheck(true, '/templates'), '/templates');
  assert.equal(
    afterProfileCheck(false, '/templates'),
    '/onboarding?returnTo=%2Ftemplates',
  );
  assert.equal(onboardingPath('/dashboard'), '/onboarding');
  assert.equal(authReturnPath('/profile?userId=other'), '/profile');
  for (const unsafe of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/login',
    '/register',
    '/onboarding',
    '/profile/other',
  ])
    assert.equal(afterProfileCheck(true, unsafe), '/dashboard');
});
void test('profile failures are sanitized and ambiguous outcomes require reconciliation', () => {
  assert.equal(ambiguousProfileWrite(new ApiError('network')), true);
  assert.equal(ambiguousProfileWrite(new ApiError('response')), true);
  assert.equal(ambiguousProfileWrite(new ApiError('response', 400)), false);
  assert.doesNotMatch(
    profileMutationMessage(new Error('private SQL Prisma stack')),
    /private|SQL|Prisma/,
  );
});
void test('registration allows any 15–128 character password without complexity or trimming; confirm never enters payload', () => {
  for (const password of [
    'a'.repeat(15),
    'a'.repeat(128),
    ' '.repeat(15),
    '😀'.repeat(15),
  ])
    assert.deepEqual(
      validateRegistration({
        email: ' user@example.com ',
        password,
        confirmPassword: password,
      }).input,
      { email: 'user@example.com', password },
    );
});
for (const password of ['short', 'a'.repeat(14), 'a'.repeat(129)])
  void test('password backend length ' + password.length, () =>
    assert.ok(
      validateRegistration({
        email: 'user@example.com',
        password,
        confirmPassword: password,
      }).errors?.password,
    ),
  );
void test('registration invalid email/confirm are rejected without sending profile fields', () => {
  assert.ok(
    validateRegistration({
      email: 'not email',
      password: 'a'.repeat(15),
      confirmPassword: 'different',
    }).errors?.email,
  );
  assert.ok(
    validateRegistration({
      email: 'user@example.com',
      password: 'a'.repeat(15),
      confirmPassword: 'different',
    }).errors?.confirmPassword,
  );
});
