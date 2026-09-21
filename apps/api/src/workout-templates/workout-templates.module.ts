import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExercisesModule } from '../exercises/exercises.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkoutTemplatesController } from './workout-templates.controller';
import { WorkoutTemplatesRepository } from './workout-templates.repository';
import { WorkoutTemplatesService } from './workout-templates.service';

@Module({
  imports: [AuthModule, ExercisesModule, PrismaModule],
  controllers: [WorkoutTemplatesController],
  providers: [WorkoutTemplatesRepository, WorkoutTemplatesService],
})
export class WorkoutTemplatesModule {}
