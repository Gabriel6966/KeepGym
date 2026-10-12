import type {
  TemplateExercise,
  WorkoutTemplate,
} from '../workout/workout.types';
import type { PlanningInput, TemplateMetadataInput } from './templates.types';

export type MetadataDraft = { name: string; description: string };
export type PlanningField =
  'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'restSeconds' | 'notes';
export type PlanningDraft = Record<PlanningField, string>;
type Validation<T, K extends string> =
  | { input: T; errors?: never }
  | { input?: never; errors: Partial<Record<K, string>> };
export function metadataDraft(template?: WorkoutTemplate): MetadataDraft {
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
  };
}
export function validateMetadata(
  draft: MetadataDraft,
): Validation<TemplateMetadataInput, keyof MetadataDraft> {
  const errors: Partial<Record<keyof MetadataDraft, string>> = {},
    name = draft.name.trim();
  if ([...name].length < 1 || [...name].length > 120)
    errors.name = 'Use a name with 1–120 characters.';
  if ([...draft.description].length > 1000)
    errors.description = 'Use at most 1000 characters.';
  return Object.keys(errors).length
    ? { errors }
    : {
        input: {
          name,
          description: draft.description === '' ? null : draft.description,
        },
      };
}
export function planningDraft(entry?: TemplateExercise): PlanningDraft {
  return {
    targetSets: entry ? String(entry.targetSets) : '',
    targetRepsMin: entry ? String(entry.targetRepsMin) : '',
    targetRepsMax: entry ? String(entry.targetRepsMax) : '',
    restSeconds: entry ? String(entry.restSeconds) : '90',
    notes: entry?.notes ?? '',
  };
}
export function validatePlanning(
  draft: PlanningDraft,
): Validation<PlanningInput, PlanningField> {
  const errors: Partial<Record<PlanningField, string>> = {};
  const targets = {
    targetSets: Number(draft.targetSets.trim()),
    targetRepsMin: Number(draft.targetRepsMin.trim()),
    targetRepsMax: Number(draft.targetRepsMax.trim()),
  };
  for (const key of ['targetSets', 'targetRepsMin', 'targetRepsMax'] as const) {
    const max = key === 'targetSets' ? 20 : 100;
    if (
      !/^\d+$/.test(draft[key].trim()) ||
      targets[key] < 1 ||
      targets[key] > max
    )
      errors[key] = `Use a whole number from 1 to ${max}.`;
  }
  if (
    !errors.targetRepsMin &&
    !errors.targetRepsMax &&
    targets.targetRepsMin > targets.targetRepsMax
  )
    errors.targetRepsMax = 'Maximum reps must be at least minimum reps.';
  const rest = draft.restSeconds.trim(),
    restSeconds = rest === '' ? undefined : Number(rest);
  if (
    restSeconds !== undefined &&
    (!/^\d+$/.test(rest) || restSeconds < 0 || restSeconds > 1800)
  )
    errors.restSeconds = 'Use a whole number from 0 to 1800, or leave blank.';
  if ([...draft.notes].length > 500)
    errors.notes = 'Use at most 500 characters.';
  return Object.keys(errors).length
    ? { errors }
    : {
        input: {
          ...targets,
          restSeconds,
          notes: draft.notes === '' ? null : draft.notes,
        },
      };
}
