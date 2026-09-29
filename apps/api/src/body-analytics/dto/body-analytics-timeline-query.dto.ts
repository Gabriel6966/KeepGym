import { Transform } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { bodyMetrics, type BodyMetric } from '../body-analytics.types';
import { BodyAnalyticsRangeQueryDto } from './body-analytics-range-query.dto';

function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}
export class BodyAnalyticsTimelineQueryDto extends BodyAnalyticsRangeQueryDto {
  @IsIn(bodyMetrics)
  metric!: BodyMetric;

  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}
