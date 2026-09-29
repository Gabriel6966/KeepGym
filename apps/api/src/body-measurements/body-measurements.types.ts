import type { BodyMeasurement } from '../generated/prisma/client';

export type BodyMeasurementRecord = BodyMeasurement;

export interface MeasurementMetrics {
  weightKg?: number | null;
  bodyFatPercent?: number | null;
  waistCm?: number | null;
  chestCm?: number | null;
  hipsCm?: number | null;
}

// Create and PATCH accept the same fields; their resulting-state rules differ.
export interface BodyMeasurementInput extends MeasurementMetrics {
  measuredAt?: string;
  notes?: string | null;
}

export interface BodyMeasurementChanges extends MeasurementMetrics {
  measuredAt?: Date;
  notes?: string | null;
}

export interface BodyMeasurementQueryInput {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface BodyMeasurementQuery {
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export interface PublicBodyMeasurement {
  id: string;
  measuredAt: Date;
  weightKg: number | null;
  bodyFatPercent: number | null;
  waistCm: number | null;
  chestCm: number | null;
  hipsCm: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BodyMeasurementPage {
  items: PublicBodyMeasurement[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
