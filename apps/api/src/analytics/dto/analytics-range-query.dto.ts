import { Validate, ValidateIf } from 'class-validator';
import { HistoryTimestampValidator } from '../../history/dto/history-timestamp.validator';

export class AnalyticsRangeQueryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Validate(HistoryTimestampValidator)
  from?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Validate(HistoryTimestampValidator)
  to?: string;
}
