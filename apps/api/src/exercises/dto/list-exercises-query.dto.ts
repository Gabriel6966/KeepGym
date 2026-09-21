import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  Equipment,
  MovementPattern,
  MuscleGroup,
} from '../../generated/prisma/enums';

// Only a canonical positive decimal integer is converted. Arrays, whitespace,
// signs, exponents and fractional strings retain their type and fail validation.
function queryInteger({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}

export class ListExercisesQueryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  q?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(MuscleGroup)
  primaryMuscle?: MuscleGroup;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(Equipment)
  equipment?: Equipment;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(MovementPattern)
  movementPattern?: MovementPattern;

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
