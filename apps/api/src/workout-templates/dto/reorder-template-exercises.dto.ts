import { ArrayUnique, IsArray, IsUUID } from 'class-validator';
export class ReorderTemplateExercisesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  templateExerciseIds!: string[];
}
