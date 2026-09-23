import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';
import { ExerciseHistoryQueryDto } from './exercise-history-query.dto';

export class ListWorkoutHistoryQueryDto extends ExerciseHistoryQueryDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  q?: string;
}
