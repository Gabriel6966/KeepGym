import { Transform } from 'class-transformer';
import { IsIn, IsInt, Max, Min, Validate, ValidateIf } from 'class-validator';
import { historyStatuses, type HistoryStatus } from '../history.types';
import { HistoryTimestampValidator } from './history-timestamp.validator';

function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}
// Shared query fields; the endpoint's default status is chosen in the service.
export class ExerciseHistoryQueryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(historyStatuses)
  status?: HistoryStatus;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Validate(HistoryTimestampValidator)
  from?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Validate(HistoryTimestampValidator)
  to?: string;

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
