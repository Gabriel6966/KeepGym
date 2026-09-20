import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(15, 128)
  password!: string;
}
