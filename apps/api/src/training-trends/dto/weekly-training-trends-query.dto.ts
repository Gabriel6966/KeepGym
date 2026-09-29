import { IsNotEmpty, IsString, MaxLength, Validate } from 'class-validator';
import { HistoryTimestampValidator } from '../../history/dto/history-timestamp.validator';

export class WeeklyTrainingTrendsQueryDto {
  @Validate(HistoryTimestampValidator)
  from!: string;

  @Validate(HistoryTimestampValidator)
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone!: string;
}
