import { Transform } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { WorkoutSessionStatus } from '../../generated/prisma/enums';

function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}
export class ListWorkoutSessionsQueryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(WorkoutSessionStatus)
  status?: WorkoutSessionStatus;

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
