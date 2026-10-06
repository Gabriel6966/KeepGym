import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class WeeklyConsistencyQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromWeekStart!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toWeekStart!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone!: string;
}
