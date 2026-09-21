import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { OptionalProfileFieldsDto } from './optional-profile-fields.dto';

export class CreateProfileDto extends OptionalProfileFieldsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  displayName!: string;
}
