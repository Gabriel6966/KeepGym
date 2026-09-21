import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class AddTemplateExerciseDto {
  @IsUUID()
  exerciseId!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  targetSets!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  targetRepsMin!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  targetRepsMax!: number;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(1800)
  restSeconds?: number;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
