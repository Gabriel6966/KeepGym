import { IsUUID } from 'class-validator';
export class StartWorkoutSessionDto {
  @IsUUID()
  workoutTemplateId!: string;
}
