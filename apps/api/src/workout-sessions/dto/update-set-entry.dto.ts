import {
  IsInt,
  IsNumber,
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import { HalfStepValidator } from './half-step.validator';

export class UpdateSetEntryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  loadKg?: number;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  reps?: number;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(10)
  @Validate(HalfStepValidator)
  rpe?: number | null;

  @ValidateIf(
    (_object: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @IsInt()
  @Min(0)
  @Max(10)
  rir?: number | null;
}
