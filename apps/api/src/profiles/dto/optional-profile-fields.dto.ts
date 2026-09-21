import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateIf,
} from 'class-validator';
import {
  ExperienceLevel,
  TrainingGoal,
  UnitSystem,
} from '../../generated/prisma/enums';
import { IsBirthDate } from './is-birth-date.validator';

export class OptionalProfileFieldsDto {
  @IsOptional()
  @Validate(IsBirthDate)
  birthDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  heightCm?: number | null;

  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel | null;

  @IsOptional()
  @IsEnum(TrainingGoal)
  trainingGoal?: TrainingGoal | null;

  // Unlike nullable fields, an explicit null must fail validation.
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(UnitSystem)
  unitSystem?: UnitSystem;
}
