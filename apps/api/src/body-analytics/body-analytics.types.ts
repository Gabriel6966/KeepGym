export const bodyMetrics = [
  'weightKg',
  'bodyFatPercent',
  'waistCm',
  'chestCm',
  'hipsCm',
] as const;
export type BodyMetric = (typeof bodyMetrics)[number];
export type BodyMetricUnit = 'kg' | 'percent' | 'cm';
export const bodyMetricUnits: Record<BodyMetric, BodyMetricUnit> = {
  weightKg: 'kg',
  bodyFatPercent: 'percent',
  waistCm: 'cm',
  chestCm: 'cm',
  hipsCm: 'cm',
};

export interface BodyAnalyticsRangeInput {
  from?: string;
  to?: string;
}
export interface BodyAnalyticsRange {
  from?: Date;
  to?: Date;
}
export interface BodyAnalyticsTimelineInput extends BodyAnalyticsRangeInput {
  metric: BodyMetric;
  page?: number;
  limit?: number;
}
export interface BodyAnalyticsTimelineQuery extends BodyAnalyticsRange {
  metric: BodyMetric;
  page: number;
  limit: number;
}

// NUMERIC is selected as text, retaining exact hundredths until presentation.
export interface BodyMetricRecord {
  measurementId: string;
  measuredAt: Date;
  value: string;
}
export interface BodyOverviewRecord extends BodyMetricRecord {
  metric: BodyMetric;
}
export interface BodyTimelineData {
  items: BodyMetricRecord[];
  total: string;
}

export interface PublicBodyMetricObservation {
  value: number;
  measuredAt: Date;
}
export interface PublicBodyMetricSummary {
  latest: PublicBodyMetricObservation | null;
  previous: PublicBodyMetricObservation | null;
  change: number | null;
}
export type PublicBodyAnalyticsOverview = Record<
  BodyMetric,
  PublicBodyMetricSummary
>;
export interface PublicBodyAnalyticsTimeline {
  metric: BodyMetric;
  unit: BodyMetricUnit;
  items: (PublicBodyMetricObservation & { measurementId: string })[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
