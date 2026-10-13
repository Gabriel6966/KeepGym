import { parseDateOnly } from '../dashboard/calendar';
import {
  experienceOptions,
  goalOptions,
  unitOptions,
  type Profile,
  type ProfileChanges,
  type ProfileInput,
} from './profile.types';

export type ProfileField =
  | 'displayName'
  | 'birthDate'
  | 'heightCm'
  | 'experienceLevel'
  | 'trainingGoal'
  | 'unitSystem';
export type ProfileDraft = Record<ProfileField, string>;
export type ProfileErrors = Partial<Record<ProfileField | 'form', string>>;
export function profileDraft(profile?: Profile): ProfileDraft {
  return {
    displayName: profile?.displayName ?? '',
    birthDate: profile?.birthDate ?? '',
    heightCm: profile?.heightCm == null ? '' : String(profile.heightCm),
    experienceLevel: profile?.experienceLevel ?? '',
    trainingGoal: profile?.trainingGoal ?? '',
    unitSystem: profile?.unitSystem ?? 'METRIC',
  };
}
// DATE-only validation uses the existing calendar carrier. The original string,
// never its Date/toISOString representation, is retained in the HTTP payload.
export function validBirthDate(value: string, today: string): boolean {
  return (
    parseDateOnly(value) !== null &&
    parseDateOnly(today) !== null &&
    value <= today
  );
}
export function validateProfileDraft(
  draft: ProfileDraft,
  today: string,
  original?: Profile,
):
  | { input: ProfileChanges; errors?: never }
  | { input?: never; errors: ProfileErrors } {
  const errors: ProfileErrors = {},
    displayName = draft.displayName.trim(),
    birthDate = draft.birthDate === '' ? null : draft.birthDate;
  if ([...displayName].length < 1 || [...displayName].length > 80)
    errors.displayName = 'Use a name with 1–80 characters.';
  if (birthDate !== null && !validBirthDate(birthDate, today))
    errors.birthDate = 'Use a real, non-future calendar date.';
  const heightText = draft.heightCm.trim(),
    heightCm = heightText === '' ? null : Number(heightText);
  if (
    heightCm !== null &&
    (!/^\d+$/.test(heightText) || heightCm < 50 || heightCm > 300)
  )
    errors.heightCm = 'Use a whole number from 50 to 300 cm, or leave blank.';
  const experience = experienceOptions.find(
      (option) => option.value === draft.experienceLevel,
    ),
    goal = goalOptions.find((option) => option.value === draft.trainingGoal),
    unit = unitOptions.find((option) => option.value === draft.unitSystem);
  if (draft.experienceLevel !== '' && !experience)
    errors.experienceLevel = 'Choose a supported experience level.';
  if (draft.trainingGoal !== '' && !goal)
    errors.trainingGoal = 'Choose a supported training goal.';
  if (!unit) errors.unitSystem = 'Choose Metric or Imperial.';
  if (Object.keys(errors).length || !unit) return { errors };
  const values: ProfileInput = {
    displayName,
    birthDate,
    heightCm,
    experienceLevel: experience?.value ?? null,
    trainingGoal: goal?.value ?? null,
    unitSystem: unit.value,
  };
  const input: ProfileChanges = {};
  for (const field of [
    'displayName',
    'birthDate',
    'heightCm',
    'experienceLevel',
    'trainingGoal',
    'unitSystem',
  ] as const)
    if (!original || values[field] !== original[field]) {
      // Explicit assignments keep the heterogeneous field types checked without
      // an indexed write cast; absent fields remain absent for PATCH.
      switch (field) {
        case 'displayName':
          input.displayName = values.displayName;
          break;
        case 'birthDate':
          input.birthDate = values.birthDate;
          break;
        case 'heightCm':
          input.heightCm = values.heightCm;
          break;
        case 'experienceLevel':
          input.experienceLevel = values.experienceLevel;
          break;
        case 'trainingGoal':
          input.trainingGoal = values.trainingGoal;
          break;
        case 'unitSystem':
          input.unitSystem = values.unitSystem;
          break;
      }
    }
  if (original && Object.keys(input).length === 0)
    return { errors: { form: 'No changes to save.' } };
  return { input };
}
