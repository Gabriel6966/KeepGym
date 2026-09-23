import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExerciseHistoryController } from './exercise-history.controller';
import { WorkoutHistoryController } from './workout-history.controller';
import { HistoryService } from './history.service';
import { HistoryRepository } from './history.repository';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WorkoutHistoryController, ExerciseHistoryController],
  providers: [HistoryService, HistoryRepository],
})
export class HistoryModule {}
