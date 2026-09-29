import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BodyAnalyticsPersistenceError } from './errors/body-analytics-persistence.error';
import { InvalidBodyAnalyticsQueryError } from './errors/invalid-body-analytics-query.error';
import { isBodyMetric } from './body-analytics.validation';
import {
  bodyMetrics,
  type BodyMetric,
  type BodyAnalyticsRange,
  type BodyAnalyticsTimelineQuery,
  type BodyMetricRecord,
  type BodyOverviewRecord,
  type BodyTimelineData,
} from './body-analytics.types';

// Identifiers are static SQL, not strings supplied by the HTTP client.
const metricColumns = {
  weightKg: Prisma.sql`b.weight_kg`,
  bodyFatPercent: Prisma.sql`b.body_fat_percent`,
  waistCm: Prisma.sql`b.waist_cm`,
  chestCm: Prisma.sql`b.chest_cm`,
  hipsCm: Prisma.sql`b.hips_cm`,
} satisfies Record<BodyMetric, Prisma.Sql>;

function scope(userId: string, range: BodyAnalyticsRange): Prisma.Sql {
  return Prisma.sql`b.user_id = ${userId}::uuid
    ${range.from ? Prisma.sql`AND b.measured_at >= ${range.from}` : Prisma.empty}
    ${range.to ? Prisma.sql`AND b.measured_at <= ${range.to}` : Prisma.empty}`;
}

@Injectable()
export class BodyAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getOverviewData(
    userId: string,
    range: BodyAnalyticsRange,
  ): Promise<BodyOverviewRecord[]> {
    // One statement/snapshot with five bounded index scans, not ten round trips
    // or full-history materialization. At most ten observations cross the wire.
    const queries = bodyMetrics.map(
      (metric) => Prisma.sql`(
      SELECT ${metric}::text AS metric, b.id AS "measurementId", b.measured_at AS "measuredAt",
        ${metricColumns[metric]}::text AS value
      FROM body_measurements b
      WHERE ${scope(userId, range)} AND ${metricColumns[metric]} IS NOT NULL
      ORDER BY b.measured_at DESC, b.id DESC LIMIT 2
    )`,
    );
    try {
      return await this.prisma.$queryRaw<BodyOverviewRecord[]>(
        Prisma.sql`${Prisma.join(queries, ' UNION ALL ')}`,
      );
    } catch {
      throw new BodyAnalyticsPersistenceError();
    }
  }

  async findTimeline(
    userId: string,
    query: BodyAnalyticsTimelineQuery,
  ): Promise<BodyTimelineData> {
    // Defense at the SQL boundary as well as DTO/service validation, including
    // inherited Object keys (e.g. constructor) and direct repository callers.
    if (!isBodyMetric(query.metric))
      throw new InvalidBodyAnalyticsQueryError(
        'metric must be a supported body measurement metric.',
      );
    const column = metricColumns[query.metric];
    const where = Prisma.sql`${scope(userId, query)} AND ${column} IS NOT NULL`;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const items = await tx.$queryRaw<BodyMetricRecord[]>(Prisma.sql`
          SELECT b.id AS "measurementId", b.measured_at AS "measuredAt", ${column}::text AS value
          FROM body_measurements b WHERE ${where}
          ORDER BY b.measured_at ASC, b.id ASC
          LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
          const counts = await tx.$queryRaw<{ total: string }[]>(Prisma.sql`
          SELECT COUNT(*)::text AS total FROM body_measurements b WHERE ${where}`);
          if (!counts[0]) throw new BodyAnalyticsPersistenceError();
          return { items, total: counts[0].total };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    } catch {
      throw new BodyAnalyticsPersistenceError();
    }
  }
}
