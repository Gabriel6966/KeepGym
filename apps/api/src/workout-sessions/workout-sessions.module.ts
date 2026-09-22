import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkoutSessionsController } from './workout-sessions.controller';
import { WorkoutSessionsRepository } from './workout-sessions.repository';
import { WorkoutSessionsService } from './workout-sessions.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WorkoutSessionsController],
  providers: [WorkoutSessionsRepository, WorkoutSessionsService],
})
export class WorkoutSessionsModule {}
