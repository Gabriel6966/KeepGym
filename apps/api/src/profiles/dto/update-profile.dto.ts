import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';
import { OptionalProfileFieldsDto } from './optional-profile-fields.dto';

export class UpdateProfileDto extends OptionalProfileFieldsDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  displayName?: string;
}
