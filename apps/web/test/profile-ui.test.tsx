import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileForm } from '../src/features/profile/profile-form';
import { RegisterForm } from '../src/features/auth/register-form';
import {
  WorkoutLoading,
  WorkoutError,
} from '../src/features/workout/workout.ui';
import { profileFixture } from './support/profile-fixture';

void test('onboarding renders only stable labelled fields and required name, without skip/body/Profile weight', () => {
  const html = renderToStaticMarkup(
    <ProfileForm
      today="2026-10-13"
      disabled={false}
      onSave={async () => true}
    />,
  );
  for (const name of [
    'displayName',
    'birthDate',
    'heightCm',
    'experienceLevel',
    'trainingGoal',
    'unitSystem',
  ])
    assert.match(html, new RegExp('name="' + name + '"'));
  assert.match(html, /Create profile/);
  assert.match(html, /type="date"/);
  assert.match(html, /Whole numbers/);
  assert.match(html, /value="METRIC" selected/);
  assert.doesNotMatch(
    html,
    /name="(?:weightKg|bodyFatPercent|waistCm|chestCm|hipsCm|userId)"|Skip|BMI/,
  );
});
void test('Profile populated editor preserves birth DATE/nullable blanks and uses canonical enums, reset, cm preference', () => {
  const html = renderToStaticMarkup(
    <ProfileForm
      profile={profileFixture({
        heightCm: null,
        trainingGoal: null,
        unitSystem: 'IMPERIAL',
      })}
      today="2026-10-13"
      disabled={false}
      onSave={async () => true}
    />,
  );
  assert.match(html, /value="1995-04-10"/);
  assert.match(html, /name="heightCm"[^>]*value=""/);
  assert.match(html, /value="IMPERIAL" selected/);
  assert.match(html, /value="GENERAL_FITNESS">General fitness/);
  assert.match(html, /Reset changes/);
  assert.match(html, /Save profile/);
  assert.match(html, /Height remains cm/);
});
void test('pending/ambiguous Profile form remains populated but blocks submits and resetting', () => {
  const html = renderToStaticMarkup(
    <ProfileForm
      profile={profileFixture()}
      today="2026-10-13"
      disabled
      onSave={async () => true}
    />,
  );
  assert.match(html, /Original  Name/);
  assert.match(html, /disabled/);
});
void test('register form contains email/password/confirm UX only, no arbitrary complexity, all pending inputs disabled', () => {
  const html = renderToStaticMarkup(
    <RegisterForm disabled onRegister={async () => undefined} />,
  );
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /name="confirmPassword"/);
  assert.match(html, /15 y 128 caracteres/);
  assert.match(html, /Sin combinaciones de caracteres obligatorias/);
  assert.match(html, /autoComplete="new-password"/i);
  assert.doesNotMatch(
    html,
    /name="displayName"|userId|uppercase|special character/,
  );
  assert.match(html, /disabled/);
});
void test('Profile initial loading and GET failure use accessible safe existing states', () => {
  assert.match(
    renderToStaticMarkup(<WorkoutLoading label="Checking profile..." />),
    /aria-busy="true"/,
  );
  const html = renderToStaticMarkup(
    <WorkoutError title="Profile unavailable" onRetry={() => undefined} />,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /SQL|Prisma|stack/);
});
