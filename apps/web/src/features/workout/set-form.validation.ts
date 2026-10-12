import type { SetEntry, SetEntryInput } from './workout.types';

export type SetField = 'loadKg' | 'reps' | 'rpe' | 'rir';
export type SetDraft = Record<SetField, string>;
export function setDraft(set?: SetEntry): SetDraft {
  return {
    loadKg: set ? String(set.loadKg) : '',
    reps: set ? String(set.reps) : '',
    rpe: set?.rpe === null || set?.rpe === undefined ? '' : String(set.rpe),
    rir: set?.rir === null || set?.rir === undefined ? '' : String(set.rir),
  };
}
export function validateSetDraft(
  draft: SetDraft,
):
  | { input: SetEntryInput; errors?: never }
  | { input?: never; errors: Partial<Record<SetField, string>> } {
  const errors: Partial<Record<SetField, string>> = {};
  const load = draft.loadKg.trim(),
    reps = draft.reps.trim(),
    rpe = draft.rpe.trim(),
    rir = draft.rir.trim();
  // Validate the complete decimal string before Number; never truncate/round input.
  const loadKg = Number(load.replace(',', '.'));
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(load) || loadKg > 10000)
    errors.loadKg = 'Use 0–10000 kg, with at most two decimal places.';
  const repsValue = Number(reps);
  if (!/^\d+$/.test(reps) || repsValue < 1 || repsValue > 1000)
    errors.reps = 'Use a whole number from 1 to 1000.';
  const rpeValue = rpe === '' ? null : Number(rpe.replace(',', '.'));
  if (
    rpeValue !== null &&
    (!/^\d+(?:[.,]\d)?$/.test(rpe) ||
      rpeValue < 1 ||
      rpeValue > 10 ||
      !Number.isInteger(rpeValue * 2))
  )
    errors.rpe = 'Optional: 1–10, in steps of 0.5.';
  const rirValue = rir === '' ? null : Number(rir);
  if (
    rirValue !== null &&
    (!/^\d+$/.test(rir) || rirValue < 0 || rirValue > 10)
  )
    errors.rir = 'Optional: a whole number from 0 to 10.';
  if (Object.keys(errors).length) return { errors };
  return { input: { loadKg, reps: repsValue, rpe: rpeValue, rir: rirValue } };
}
