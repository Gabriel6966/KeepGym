import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingDurationController } from './training-duration.controller';
import { TrainingDurationService } from './training-duration.service';
import { TrainingDurationRepository } from './training-duration.repository';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingDurationController],
  providers: [TrainingDurationService, TrainingDurationRepository],
})
export class TrainingDurationModule {}
