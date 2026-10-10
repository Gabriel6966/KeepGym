import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingCalendarController } from './training-calendar.controller';
import { TrainingCalendarService } from './training-calendar.service';
import { TrainingCalendarRepository } from './training-calendar.repository';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingCalendarController],
  providers: [TrainingCalendarService, TrainingCalendarRepository],
  exports: [TrainingCalendarService],
})
export class TrainingCalendarModule {}
