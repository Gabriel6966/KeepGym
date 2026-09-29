import { Injectable } from '@nestjs/common';
import { BodyAnalyticsRepository } from './body-analytics.repository';
import { calculateChange, roundMetric } from './body-analytics.math';
import {
  normalizeBodyAnalyticsRange,
  normalizeBodyAnalyticsTimeline,
  validateBodyAnalyticsUser,
} from './body-analytics.validation';
import { BodyAnalyticsPersistenceError } from './errors/body-analytics-persistence.error';
import {
  bodyMetricUnits,
  type BodyMetric,
  type BodyOverviewRecord,
  type BodyAnalyticsRangeInput,
  type BodyAnalyticsTimelineInput,
  type PublicBodyAnalyticsOverview,
  type PublicBodyAnalyticsTimeline,
  type PublicBodyMetricSummary,
} from './body-analytics.types';

function summary(
  rows: readonly BodyOverviewRecord[],
  metric: BodyMetric,
): PublicBodyMetricSummary {
  const [latest, previous] = rows
    .filter((row) => row.metric === metric)
    .sort(
      (a, b) =>
        b.measuredAt.getTime() - a.measuredAt.getTime() ||
        b.measurementId.localeCompare(a.measurementId),
    );
  return {
    latest: latest
      ? { value: roundMetric(latest.value), measuredAt: latest.measuredAt }
      : null,
    previous: previous
      ? { value: roundMetric(previous.value), measuredAt: previous.measuredAt }
      : null,
    change:
      latest && previous ? calculateChange(latest.value, previous.value) : null,
  };
}

@Injectable()
export class BodyAnalyticsService {
  constructor(private readonly repository: BodyAnalyticsRepository) {}
  async getOverview(
    userId: string,
    input: BodyAnalyticsRangeInput = {},
  ): Promise<PublicBodyAnalyticsOverview> {
    validateBodyAnalyticsUser(userId);
    const rows = await this.repository.getOverviewData(
      userId,
      normalizeBodyAnalyticsRange(input),
    );
    return {
      weightKg: summary(rows, 'weightKg'),
      bodyFatPercent: summary(rows, 'bodyFatPercent'),
      waistCm: summary(rows, 'waistCm'),
      chestCm: summary(rows, 'chestCm'),
      hipsCm: summary(rows, 'hipsCm'),
    };
  }
  async getTimeline(
    userId: string,
    input: BodyAnalyticsTimelineInput,
  ): Promise<PublicBodyAnalyticsTimeline> {
    validateBodyAnalyticsUser(userId);
    const query = normalizeBodyAnalyticsTimeline(input);
    const { items, total: count } = await this.repository.findTimeline(
      userId,
      query,
    );
    const total = Number(count);
    if (!/^\d+$/.test(count) || !Number.isSafeInteger(total))
      throw new BodyAnalyticsPersistenceError();
    return {
      metric: query.metric,
      unit: bodyMetricUnits[query.metric],
      items: items.map((row) => ({
        measurementId: row.measurementId,
        measuredAt: row.measuredAt,
        value: roundMetric(row.value),
      })),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
