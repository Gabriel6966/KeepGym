import type {
  BodyMeasurement,
  BodyMeasurementPage,
} from '../../src/features/body/body.types';
export const measurementId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export function measurementFixture(
  changes: Partial<BodyMeasurement> = {},
): BodyMeasurement {
  return {
    id: measurementId,
    measuredAt: '2026-10-01T18:30:00.123Z',
    weightKg: 80.5,
    bodyFatPercent: null,
    waistCm: 85,
    chestCm: null,
    hipsCm: null,
    notes: 'Historical morning observation',
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...changes,
  };
}
export function measurementPage(): BodyMeasurementPage {
  return {
    items: [measurementFixture()],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };
}
