import { parseDateOnly } from '../dashboard/calendar';
import { historyTimestamp } from '../history/history-query';
import {
  experienceOptions,
  goalOptions,
  unitOptions,
  type Profile,
} from './profile.types';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export function isProfile(value: unknown): value is Profile {
  return (
    object(value) &&
    typeof value.displayName === 'string' &&
    value.displayName.length > 0 &&
    [...value.displayName].length <= 80 &&
    (value.birthDate === null || parseDateOnly(value.birthDate) !== null) &&
    (value.heightCm === null ||
      (typeof value.heightCm === 'number' &&
        Number.isInteger(value.heightCm) &&
        value.heightCm >= 50 &&
        value.heightCm <= 300)) &&
    (value.experienceLevel === null ||
      experienceOptions.some(
        (option) => option.value === value.experienceLevel,
      )) &&
    (value.trainingGoal === null ||
      goalOptions.some((option) => option.value === value.trainingGoal)) &&
    unitOptions.some((option) => option.value === value.unitSystem) &&
    historyTimestamp(value.createdAt) !== null &&
    historyTimestamp(value.updatedAt) !== null
  );
}
export function isMissingProfileResponse(value: unknown): boolean {
  return (
    object(value) &&
    value.statusCode === 404 &&
    value.message === 'Profile not found.'
  );
}
