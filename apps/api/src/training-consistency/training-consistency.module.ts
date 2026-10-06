import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrainingConsistencyController } from './training-consistency.controller';
import { TrainingConsistencyService } from './training-consistency.service';
import { TrainingConsistencyRepository } from './training-consistency.repository';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [TrainingConsistencyController],
  providers: [TrainingConsistencyService, TrainingConsistencyRepository],
})
export class TrainingConsistencyModule {}
