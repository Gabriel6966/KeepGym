import type { BodyMetric } from '../dashboard/dashboard.types';
import type { ResourcePage } from '../workout/workout.types';

export interface BodyMeasurement extends Record<BodyMetric, number | null> {
  id: string;
  measuredAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BodyMeasurementInput extends Partial<
  Record<BodyMetric, number | null>
> {
  measuredAt?: string;
  notes?: string | null;
}
export interface BodyMeasurementQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}
export type BodyMeasurementPage = ResourcePage<BodyMeasurement>;
export const bodyFields: Record<
  BodyMetric,
  { label: string; unit: string; maximum: number }
> = {
  weightKg: { label: 'Weight', unit: 'kg', maximum: 1000 },
  bodyFatPercent: { label: 'Body fat', unit: '%', maximum: 100 },
  waistCm: { label: 'Waist', unit: 'cm', maximum: 500 },
  chestCm: { label: 'Chest', unit: 'cm', maximum: 500 },
  hipsCm: { label: 'Hips', unit: 'cm', maximum: 500 },
};
