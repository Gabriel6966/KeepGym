import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class TrainingCalendarDaysQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone!: string;
}
