import { Prisma } from '../../src/generated/prisma/client';
import type { BodyMeasurementRecord } from '../../src/body-measurements/body-measurements.types';
import type { BodyAnalyticsRepository } from '../../src/body-analytics/body-analytics.repository';
import {
  bodyMetrics,
  type BodyAnalyticsRange,
  type BodyAnalyticsTimelineQuery,
  type BodyMetricRecord,
  type BodyOverviewRecord,
  type BodyTimelineData,
} from '../../src/body-analytics/body-analytics.types';
import { measurementFixture } from './in-memory-body-measurements.repository';

export class InMemoryBodyAnalyticsRepository implements Pick<
  BodyAnalyticsRepository,
  'getOverviewData' | 'findTimeline'
> {
  readonly records: BodyMeasurementRecord[] = [];
  private scoped(userId: string, range: BodyAnalyticsRange) {
    return this.records
      .filter(
        (row) =>
          row.userId === userId &&
          (!range.from || row.measuredAt >= range.from) &&
          (!range.to || row.measuredAt <= range.to),
      )
      .sort(
        (a, b) =>
          a.measuredAt.getTime() - b.measuredAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }
  async getOverviewData(
    userId: string,
    range: BodyAnalyticsRange,
  ): Promise<BodyOverviewRecord[]> {
    const rows = this.scoped(userId, range).reverse();
    return bodyMetrics.flatMap((metric) =>
      rows
        .filter((row) => row[metric] !== null)
        .slice(0, 2)
        .map((row) => ({
          metric,
          measurementId: row.id,
          measuredAt: row.measuredAt,
          value: row[metric]!.toString(),
        })),
    );
  }
  async findTimeline(
    userId: string,
    query: BodyAnalyticsTimelineQuery,
  ): Promise<BodyTimelineData> {
    const rows = this.scoped(userId, query).filter(
      (row) => row[query.metric] !== null,
    );
    const items: BodyMetricRecord[] = rows
      .slice((query.page - 1) * query.limit, query.page * query.limit)
      .map((row) => ({
        measurementId: row.id,
        measuredAt: row.measuredAt,
        value: row[query.metric]!.toString(),
      }));
    return { items, total: String(rows.length) };
  }
}

export function seedBodyAnalytics(
  repository: InMemoryBodyAnalyticsRepository,
  userId: string,
): BodyMeasurementRecord[] {
  const fixtures = [
    { date: '2026-08-01', weightKg: 85.5, waistCm: 90.25 },
    {
      date: '2026-09-01',
      weightKg: 83.25,
      bodyFatPercent: 16.5,
      waistCm: 87.75,
    },
    { date: '2026-09-10', chestCm: 103 },
    { date: '2026-09-20', weightKg: 82.4, chestCm: 102.3, hipsCm: 98.4 },
    { date: '2026-09-25', waistCm: 84.5 },
  ];
  const rows = fixtures.map((input) => {
    const row = {
      ...measurementFixture(userId),
      measuredAt: new Date(input.date + 'T00:00:00Z'),
    };
    for (const metric of bodyMetrics) {
      const value = input[metric];
      if (value !== undefined)
        row[metric] = new Prisma.Decimal(value.toString());
    }
    return row;
  });
  repository.records.push(...rows);
  return rows;
}
