import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { AnalyticsRangeQueryDto } from './analytics-range-query.dto';

function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}
export class ExerciseAnalyticsQueryDto extends AnalyticsRangeQueryDto {
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
