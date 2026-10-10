import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class DashboardSummaryQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekStart!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone!: string;
}
